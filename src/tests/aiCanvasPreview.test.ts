import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { clearAiCanvasPreview, currentAiCanvasPreview, publishAiCanvasPreview, useAiCanvasPreview } from "../state/aiCanvasPreview";
import { useCadStore } from "../state/useCadStore";
import { AiProposalMeshes } from "../viewer/aiProposalMeshes";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
function mesh(bodyId = "old", size = 1): RenderMesh {
  return { id: bodyId, bodyId, positions: [0, 0, 0, size, 0, 0, 0, size, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [size, size, 0] }, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: size, surfaceArea: size, solidCount: 1 } };
}
function result(meshes = [mesh()]): RebuildResult {
  return { documentId: useCadStore.getState().history.present.id, success: true, meshes, bodies: [], errors: [], warnings: [], durationMs: 1 };
}
function proposal() {
  const state = useCadStore.getState();
  return { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, beforeResult: state.rebuild.result, result: result([mesh(), mesh("new", 2)]), bodyIds: ["new"] };
}
beforeEach(() => { useCadStore.setState(useCadStore.getInitialState(), true); useCadStore.setState({ rebuild: { status: "succeeded", result: result(), kernelReady: true } }); });
afterEach(() => { clearAiCanvasPreview(); useCadStore.setState(useCadStore.getInitialState(), true); });
it("publishes complete native geometry without changing the document, current result, selection or history", () => {
  const before = useCadStore.getState(), input = proposal();
  expect(publishAiCanvasPreview(input)).toBe(true);
  expect(currentAiCanvasPreview(before)?.result).toBe(input.result);
  expect(useCadStore.getState()).toBe(before);
  useAiCanvasPreview.getState().setMode("before");
  expect(useAiCanvasPreview.getState().mode).toBe("before");
  clearAiCanvasPreview();
  expect(useAiCanvasPreview.getState().preview).toBeUndefined();
});
it.each(["fallback", "invalid", "failed", "empty", "zero", "nan", "otherProject", "missingBody"])("rejects %s proposals", (kind) => {
  const input = proposal();
  if (kind === "missingBody") input.bodyIds = ["missing"];
  if (kind === "otherProject") input.result.documentId = "different";
  if (kind === "fallback") input.result.meshes[0].geometrySource = "fallback";
  if (kind === "invalid") input.result.meshes[0].geometryAssertions = undefined;
  if (kind === "failed") input.result.success = false;
  if (kind === "empty") input.result.meshes = [];
  if (kind === "zero") input.result.meshes[0].geometryAssertions!.volume = 0;
  if (kind === "nan") input.result.meshes[0].geometryAssertions!.volume = NaN;
  expect(publishAiCanvasPreview(input)).toBe(false);
  expect(useAiCanvasPreview.getState().preview).toBeUndefined();
});
it.each(["document", "session", "component", "selection", "result", "busy", "pending"])("releases an accepted proposal when %s changes; returning to old state does not restore it", (kind) => {
  const before = useCadStore.getState();
  expect(publishAiCanvasPreview(proposal())).toBe(true);
  if (kind === "document") useCadStore.setState({ history: { ...before.history, present: { ...before.history.present } } });
  if (kind === "session") useCadStore.setState({ documentSession: before.documentSession + 1 });
  if (kind === "component") useCadStore.setState({ activeComponentId: "another" });
  if (kind === "selection") useCadStore.setState({ selection: { selectedIds: [{ kind: "body", id: "old", documentId: before.history.present.id }] } });
  if (kind === "result") useCadStore.setState({ rebuild: { ...before.rebuild, result: result() } });
  if (kind === "busy") useCadStore.setState({ fileBusy: true });
  if (kind === "pending") useCadStore.setState({ rebuild: { ...before.rebuild, status: "queued" } });
  expect(useAiCanvasPreview.getState().preview).toBeUndefined();
  useCadStore.setState(before, true);
  expect(useAiCanvasPreview.getState().preview).toBeUndefined();
  expect(currentAiCanvasPreview(before)).toBeUndefined();
});
it("allows a captured undefined result only for an empty settled project", () => {
  const state = useCadStore.getState();
  useCadStore.setState({ history: { ...state.history, present: { ...state.history.present, features: [] } }, rebuild: { status: "idle", kernelReady: true } });
  expect(publishAiCanvasPreview(proposal())).toBe(true);
});
it("owns and disposes separate proposal buffers, reuses identical before/after buffers and retains unchanged parts", () => {
  const cache = new AiProposalMeshes(), input = proposal();
  cache.update(input, "model", "original", false, []);
  expect(cache.inspect().map((item) => item.bodyId)).toEqual(["old", "new"]);
  const old = cache.group.children[0] as THREE.Mesh, changed = cache.group.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const dispose = vi.spyOn(old.geometry, "dispose");
  expect(changed.material.emissive.getHexString()).toBe("126878");
  expect((old.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe("000000");
  cache.update(input, "render", "metal", false, []);
  expect(cache.group.children[0]).toBe(old);
  expect(cache.inspect()[1].positions).toEqual(Array.from(input.result.meshes[1].positions));
  expect(dispose).not.toHaveBeenCalled();
  cache.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  expect(cache.group.children).toHaveLength(0);
});
