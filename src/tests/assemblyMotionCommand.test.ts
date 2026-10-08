import { runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { withJointMotion } from "../cad/document/assemblyJoints";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { applyAssemblyPreview, beginAssemblyMotion, canBeginAssemblyMotion, cancelComponentPlacement, previewAssemblyDocument, useComponentPlacement } from "../ui/commands/componentPlacementCommand";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const worker = vi.mocked(previewModeling);
function native(document: CadDocument) {
  const result = rebuildDocument({ ...document, assemblyJoints: [] });
  return { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 100, solidCount: 1 } })) };
}
function setup() {
  const document = importProjectText(readFileSync("src/persistence/fixtures/schema-v18.pcaddoc", "utf8"));
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 99, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result: native(document) }, selection: { selectedIds: [] } });
  worker.mockImplementation(async candidate => native(candidate));
  beginAssemblyMotion(); return { document, frame: useComponentPlacement.getState().frame! };
}
beforeEach(() => { cancelComponentPlacement(); worker.mockReset(); });
afterEach(() => { cancelComponentPlacement(); useCadStore.setState(useCadStore.getInitialState()); });
it("saves only a proven native assembly candidate in one undo step and rejects forged proofs", async () => {
  const { document, frame } = setup(), candidate = withJointMotion(document, "fixture-joint", 8);
  const proof = await previewAssemblyDocument(frame, candidate, new AbortController().signal);
  expect(useCadStore.getState().history.present).toBe(document);
  expect(() => applyAssemblyPreview({ ...proof })).toThrow(/current native/);
  applyAssemblyPreview(proof); expect(useCadStore.getState().history.present.assemblyJoints![0].value).toBe(8); expect(useCadStore.getState().history.past).toEqual([document]);
  useCadStore.getState().undo(); expect(useCadStore.getState().history.present).toBe(document);
});
it("rejects delayed previews when project currency changes even with the same document id", async () => {
  const { document, frame } = setup(); let resolve!: (value: ReturnType<typeof native>) => void;
  worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const request = previewAssemblyDocument(frame, withJointMotion(document, "fixture-joint", 8), new AbortController().signal);
  useCadStore.setState({ documentSession: 100 }); resolve(native(document)); await expect(request).rejects.toThrow(/stale/);
  expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toEqual([]);
});
it("matches command availability to current document and active-component preconditions", () => {
  setup(); cancelComponentPlacement(); expect(canBeginAssemblyMotion()).toBe(true);
  const result = useCadStore.getState().rebuild.result!;
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: { ...result, documentId: "old-project" } } }); expect(canBeginAssemblyMotion()).toBe(false);
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result }, activeComponentId: "lost-component" }); expect(canBeginAssemblyMotion()).toBe(false);
});

it("removes a broken joint through the shared command and preserves the authored pose when native rebuilding failed", async () => {
  const { document } = setup(); cancelComponentPlacement();
  useCadStore.setState({ activeComponentId: "second-component", rebuild: { status: "failed", kernelReady: true, result: { ...native(document), success: false } } });
  expect(selectCommandEnablement(useCadStore.getState()).removeJoint).toBe(true);
  await runCommand("assembly.removeJoint");
  expect(useCadStore.getState().history.present.assemblyJoints).toEqual([]);
  expect(useCadStore.getState().history.present.components["second-component"].placement).toEqual(document.components["second-component"].placement);
  expect(useCadStore.getState().history.past).toEqual([document]);
});
it("disables joint removal while another task owns the canvas or file operation", () => {
  setup(); cancelComponentPlacement(); useCadStore.setState({ activeComponentId: "second-component" });
  expect(selectCommandEnablement(useCadStore.getState(), false, true).removeJoint).toBe(false);
  expect(selectCommandEnablement(useCadStore.getState(), true).removeJoint).toBe(false);
  expect(selectCommandEnablement(useCadStore.getState(), false, false, false, true).removeJoint).toBe(false);
  useCadStore.setState({ fileBusy: true }); expect(selectCommandEnablement(useCadStore.getState()).removeJoint).toBe(false);
});
