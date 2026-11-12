import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/projectCodec";
import type { CadDocument } from "../cad/document/schema";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { useCadStore } from "../state/useCadStore";
import { generateConfigurationPackage } from "../fabrication/configurationPackageClient";
import { downloadArrayBuffer } from "../persistence/exportProject";
import { applyFamilyVariant, beginFamily, cancelFamily, captureFamilyFrame, compareFamily, exportFamily, useProductFamily } from "../ui/commands/productFamilyCommand";
import { downloadFamilyPackage, prepareFamilyPackage } from "../ui/commands/configurationPackageCommand";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
vi.mock("../fabrication/configurationPackageClient", () => ({ generateConfigurationPackage: vi.fn() }));
vi.mock("../persistence/exportProject", async importOriginal => ({ ...await importOriginal<typeof import("../persistence/exportProject")>(), downloadArrayBuffer: vi.fn() }));
const worker = vi.mocked(previewModeling);
const packageWorker = vi.mocked(generateConfigurationPackage);
function native(document: CadDocument) { const result = rebuildDocument({ ...document, features: document.features.filter(feature => feature.type !== "fit") }); return { ...result, success: true, stepExportAvailable: true, errors: [], meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 100, solidCount: 1 } })) }; }
function setup() { cancelFamily(); const document = importProjectText(readFileSync("src/persistence/fixtures/schema-v20.pcaddoc", "utf8")); useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 120, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result: native(document) }, selection: { selectedIds: [] } }); worker.mockImplementation(async document => native(document)); beginFamily(); return { document, frame: captureFamilyFrame(useProductFamily.getState().frame!) }; }
beforeEach(() => { cancelFamily(); worker.mockReset(); packageWorker.mockReset(); vi.mocked(downloadArrayBuffer).mockReset(); }); afterEach(() => { cancelFamily(); vi.unstubAllGlobals(); useCadStore.setState(useCadStore.getInitialState()); });
it("compares without edits then applies an issued current native variant with one Undo", async () => {
  const { document, frame } = setup(); const rows = await compareFamily(frame, ["configuration-small", "configuration-large"], new AbortController().signal, () => {});
  expect(useCadStore.getState().history.present).toBe(document); expect(rows[1].document.parameters.width.expression).toBe("30mm"); expect(() => applyFamilyVariant({ ...rows[1] })).toThrow(/Compare/);
  applyFamilyVariant(rows[1]); expect(useCadStore.getState().history.present.parameters.width.expression).toBe("30mm"); expect(useCadStore.getState().history.past).toEqual([document]);
});
it("discards a late result after same-ID session replacement and rejects fallback variants", async () => {
  const { document, frame } = setup(); let resolve!: (result: ReturnType<typeof native>) => void; worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const job = compareFamily(frame, ["configuration-small"], new AbortController().signal, () => {}); useCadStore.setState({ documentSession: 121 }); resolve(native(document)); await expect(job).rejects.toThrow(/stale/);
  const again = setup(); worker.mockResolvedValueOnce(rebuildDocument({ ...again.document, features: again.document.features.filter(feature => feature.type !== "fit") }));
  const [row] = await compareFamily(again.frame, ["configuration-small"], new AbortController().signal, () => {}); expect(row.error).toMatch(/native/); expect(() => applyFamilyVariant(row)).toThrow(/Compare/);
});
it("refuses invalid scopes and canceled exports without mutating the project", async () => {
  const { document, frame } = setup(); await expect(compareFamily(frame, Array(9).fill("configuration-small"), new AbortController().signal, () => {})).rejects.toThrow(/1–8/);
  const rows = await compareFamily(frame, ["configuration-small"], new AbortController().signal, () => {}), controller = new AbortController(); controller.abort();
  await expect(exportFamily(rows, controller.signal, () => {})).rejects.toThrow(/canceled/); expect(useCadStore.getState().history.present).toBe(document);
});
it("recalls legacy unitless expressions without adopting current project unit defaults", async () => {
  const { document } = setup(); cancelFamily();
  const sketches = Object.fromEntries(Object.entries(document.sketches).map(([id, sketch]) => [id, { ...sketch, entities: Object.fromEntries(Object.entries(sketch.entities).map(([id, entity]) => [id, entity.type === "point" && entity.x.expression === "width" ? { ...entity, x: { ...entity.x, authoredUnit: "mm" } } : entity])) }]));
  const changed = { ...document, sketches, unitSettings: { length: "cm" as const, angle: "deg" as const }, configurations: document.configurations!.map(configuration => configuration.id === "configuration-small" ? { ...configuration, parameters: configuration.parameters.map(entry => ({ ...entry, expression: { expression: "30", unit: "mm" } })) } : configuration) };
  useCadStore.setState({ history: { past: [], present: changed, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result: native(changed) } }); beginFamily();
  const [row] = await compareFamily(captureFamilyFrame(useProductFamily.getState().frame!), ["configuration-small"], new AbortController().signal, () => {});
  expect(row.error).toBeUndefined();
  applyFamilyVariant(row); expect(evaluateParameters(useCadStore.getState().history.present.parameters).values.width).toMatchObject({ dimension: "scalar", value: 30 });
});

const packageFile = { filename: "large-fabrication.zip", bytes: new ArrayBuffer(36) };
it("packages the compared variant without applying it and permits one explicit download for the same drawing part", async () => {
  vi.stubGlobal("Worker", class {});
  const { document, frame } = setup();
  const [variant] = await compareFamily(frame, ["configuration-large"], new AbortController().signal, () => {});
  const [first, second] = variant.result!.meshes;
  packageWorker.mockResolvedValue(packageFile);
  const prepared = await prepareFamilyPackage(variant, second.bodyId, new AbortController().signal, () => {});
  expect(packageWorker.mock.calls[0].slice(0, 5)).toEqual([variant.document, variant.id, variant.result!.meshes, second.bodyId, frame.owner.session]);
  expect(packageWorker.mock.calls[0][0].parameters.width.expression).toBe("30mm");
  expect(useCadStore.getState().history).toMatchObject({ present: document, past: [] });
  expect(downloadArrayBuffer).not.toHaveBeenCalled();
  expect(() => downloadFamilyPackage({ ...prepared }, variant, second.bodyId)).toThrow(/current fabrication package/);
  expect(() => downloadFamilyPackage(prepared, variant, first.bodyId)).toThrow(/current fabrication package/);
  downloadFamilyPackage(prepared, variant, second.bodyId);
  expect(downloadArrayBuffer).toHaveBeenCalledExactlyOnceWith(packageFile.bytes, packageFile.filename, "application/zip");
  expect(() => downloadFamilyPackage(prepared, variant, second.bodyId)).toThrow(/current fabrication package/);
});

it("aborts pending fabrication on same-ID replacement and rejects already-prepared archives", async () => {
  vi.stubGlobal("Worker", class {});
  const { document, frame } = setup();
  const [variant] = await compareFamily(frame, ["configuration-large"], new AbortController().signal, () => {});
  const bodyId = variant.result!.meshes[0].bodyId;
  packageWorker.mockResolvedValueOnce(packageFile);
  const prepared = await prepareFamilyPackage(variant, bodyId, new AbortController().signal, () => {});
  let complete!: (file: typeof packageFile) => void;
  packageWorker.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = prepareFamilyPackage(variant, bodyId, new AbortController().signal, () => {});
  await vi.waitFor(() => expect(packageWorker).toHaveBeenCalledTimes(2));
  useCadStore.setState({ documentSession: frame.owner.session + 1, history: { past: [], present: { ...document }, future: [] } });
  expect(packageWorker.mock.calls[1][5].aborted).toBe(true);
  complete(packageFile);
  await expect(pending).rejects.toThrow(/changed during fabrication/);
  expect(() => downloadFamilyPackage(prepared, variant, bodyId)).toThrow(/current fabrication package/);
  expect(downloadArrayBuffer).not.toHaveBeenCalled();
});
