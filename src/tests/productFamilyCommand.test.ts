import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/projectCodec";
import type { CadDocument } from "../cad/document/schema";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { useCadStore } from "../state/useCadStore";
import { applyFamilyVariant, beginFamily, cancelFamily, captureFamilyFrame, compareFamily, exportFamily, useProductFamily } from "../ui/commands/productFamilyCommand";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const worker = vi.mocked(previewModeling);
function native(document: CadDocument) { const result = rebuildDocument({ ...document, features: document.features.filter(feature => feature.type !== "fit") }); return { ...result, success: true, errors: [], meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 100, solidCount: 1 } })) }; }
function setup() { cancelFamily(); const document = importProjectText(readFileSync("src/persistence/fixtures/schema-v20.pcaddoc", "utf8")); useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 120, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result: native(document) }, selection: { selectedIds: [] } }); worker.mockImplementation(async document => native(document)); beginFamily(); return { document, frame: captureFamilyFrame(useProductFamily.getState().frame!) }; }
beforeEach(() => { cancelFamily(); worker.mockReset(); }); afterEach(() => { cancelFamily(); useCadStore.setState(useCadStore.getInitialState()); });
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
