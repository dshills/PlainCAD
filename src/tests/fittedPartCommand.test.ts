import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { applyFit, beginFit, canBuildFit, cancelFit, previewFit, useFittedPart, type FitInput } from "../ui/commands/fittedPartCommand";
import { useTargetScopeCapture } from "../ui/commands/targetScopeCaptureCommand";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const worker = vi.mocked(previewModeling);
function native(document: CadDocument) {
  const result = rebuildDocument({ ...document, features: document.features.filter(feature => feature.type !== "fit"), assemblyJoints: [] });
  return { ...result, success: true, errors: [], meshes: [...result.meshes, ...document.features.filter(feature => feature.type === "fit").map(feature => ({ ...result.meshes[0], bodyId: `body:${feature.id}` }))].map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 100, solidCount: 1 } })) };
}
function setup() {
  const document = importProjectText(readFileSync("src/persistence/fixtures/schema-v18.pcaddoc", "utf8")); delete document.assemblyJoints;
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 99, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result: native(document) }, selection: { selectedIds: [] } });
  worker.mockImplementation(async candidate => native(candidate)); beginFit();
  const input: FitInput = { name: "Enclosure", sourceBodyId: "body:first-solid", style: "enclosure", clearance: "2mm", wallThickness: "2mm", follow: true };
  return { document, frame: useFittedPart.getState().frame!, input };
}
beforeEach(() => { cancelFit(); worker.mockReset(); useTargetScopeCapture.setState({ busy: false }); });
afterEach(() => { cancelFit(); useCadStore.setState(useCadStore.getInitialState()); });
it("applies only issued current geometry once, preserves the source, and creates one undo step", async () => {
  const { document, frame, input } = setup();
  const proof = await previewFit(frame, input, new AbortController().signal);
  expect(useCadStore.getState().history.present).toBe(document);
  expect(() => applyFit({ ...proof }, input)).toThrow(/latest valid/);
  expect(() => applyFit(proof, { ...input, clearance: "3mm" })).toThrow(/latest valid/);
  applyFit(proof, input);
  expect(useCadStore.getState().history.present.features.slice(0, 2)).toEqual(document.features);
  expect(useCadStore.getState().history.past).toEqual([document]);
  expect(() => applyFit(proof, input)).toThrow(/latest valid/);
  useCadStore.getState().undo(); expect(useCadStore.getState().history.present).toBe(document);
});
it("rejects stale same-id sessions and canceled late responses", async () => {
  const { document, frame, input } = setup(); let resolve!: (value: ReturnType<typeof native>) => void;
  worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const request = previewFit(frame, input, new AbortController().signal);
  useCadStore.setState({ documentSession: 100 }); resolve(native(document)); await expect(request).rejects.toThrow(/stale/);
  expect(useCadStore.getState().history.present).toBe(document);
});
it("shared availability blocks scope capture and competing task ownership", () => {
  setup(); expect(canBuildFit()).toBe(false); cancelFit(); expect(canBuildFit()).toBe(true);
  expect(selectCommandEnablement(useCadStore.getState(), true).createFit).toBe(false);
  useTargetScopeCapture.setState({ busy: true }); expect(canBuildFit()).toBe(false);
});
