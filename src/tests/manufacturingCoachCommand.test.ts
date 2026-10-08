import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { COACH_PRESETS } from "../cad/inspection/manufacturingCoach";
import { applyCoachCorrection, beginCoach, cancelCoach, previewCoachCorrection, nativeMeshChanged, useManufacturingCoach } from "../ui/commands/manufacturingCoachCommand";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const worker = vi.mocked(previewModeling), settings = { ...COACH_PRESETS.fdm, minimumWall: 3 };
function native(document: CadDocument, volume = 1000) {
  const result = rebuildDocument({ ...document, features: document.features.filter(feature => feature.type !== "fit") });
  return { ...result, success: true, errors: [], meshes: [...result.meshes, { ...result.meshes[0], bodyId: "body:fitted-solid" }].map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: mesh.bodyId === "body:fitted-solid" ? volume : 1000, surfaceArea: 100, solidCount: 1 } })) };
}
function setup() {
  const document = importProjectText(readFileSync("src/persistence/fixtures/schema-v19.pcaddoc", "utf8"));
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 99, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result: native(document) }, selection: { selectedIds: [] } });
  worker.mockImplementation(async candidate => native(candidate, 2000)); beginCoach(); return { document, frame: useManufacturingCoach.getState().frame! };
}
beforeEach(() => { cancelCoach(); worker.mockReset(); });
afterEach(() => { cancelCoach(); useCadStore.setState(useCadStore.getInitialState()); });
it("gates one-step corrections on issued native proof and exact current settings", async () => {
  const { document, frame } = setup(); const preview = await previewCoachCorrection(frame, settings, "fitted-solid:wallThickness", new AbortController().signal);
  expect(() => applyCoachCorrection({ ...preview }, settings, preview.findingId)).toThrow(/Preview/);
  expect(() => applyCoachCorrection(preview, { ...settings, minimumWall: 4 }, preview.findingId)).toThrow(/Preview/);
  expect(useCadStore.getState().history.present).toBe(document); applyCoachCorrection(preview, settings, preview.findingId);
  expect(useCadStore.getState().history.past).toEqual([document]); expect(useCadStore.getState().history.present.features.at(-1)).toMatchObject({ wallThickness: { expression: "3mm" } });
});
it("rejects late canceled responses and unchanged geometry", async () => {
  const { document, frame } = setup(); worker.mockResolvedValueOnce(native(document));
  await expect(previewCoachCorrection(frame, settings, "fitted-solid:wallThickness", new AbortController().signal)).rejects.toThrow(/did not change/);
  let resolve!: (value: ReturnType<typeof native>) => void; worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const request = previewCoachCorrection(frame, settings, "fitted-solid:wallThickness", new AbortController().signal); cancelCoach(); resolve(native(document, 2000)); await expect(request).rejects.toThrow(/stale/);
  expect(useCadStore.getState().history.present).toBe(document);
});

it("recognizes equal-volume native shape changes without accepting unchanged output", () => {
  const { document } = setup(), mesh = native(document).meshes[0];
  expect(nativeMeshChanged(mesh, { ...mesh, bounds: { ...mesh.bounds, max: [21, 10, 5] } })).toBe(true);
  expect(nativeMeshChanged(mesh, { ...mesh, geometryAssertions: { ...mesh.geometryAssertions, surfaceArea: 200 } })).toBe(true);
  expect(nativeMeshChanged(mesh, mesh)).toBe(false);
  expect(() => nativeMeshChanged({ ...mesh, geometryAssertions: undefined }, mesh)).toThrow(/valid native/);
});

it("rejects loss of an affected native body before comparing other changes", async () => {
  const { document, frame } = setup(), result = native(document, 2000);
  worker.mockResolvedValueOnce({ ...result, meshes: result.meshes.filter(mesh => mesh.bodyId !== "body:fitted-solid") });
  await expect(previewCoachCorrection(frame, settings, "fitted-solid:wallThickness", new AbortController().signal)).rejects.toThrow(/lost an affected body/);
});
