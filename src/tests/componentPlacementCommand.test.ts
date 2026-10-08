import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument, ComponentPlacement } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { useComponentPlacement, beginComponentPlacement, isCurrentComponentPlacement, previewComponentPlacement, applyComponentPlacement, cancelComponentPlacement, canBeginComponentPlacement } from "../ui/commands/componentPlacementCommand";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const preview = vi.mocked(previewModeling), placement: ComponentPlacement = { translation: [10, 20, 30], rotation: [0, 0, Math.PI / 2] };
function native(document: CadDocument) {
  const result = rebuildDocument(document);
  return { ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 24000, surfaceArea: 10000, solidCount: 1 } })) };
}
function setup() {
  const document = createBoxTemplate(), result = native(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 45, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result }, selection: { selectedIds: [] } });
  preview.mockImplementation(async (document) => native(document));
  beginComponentPlacement(); return { document, frame: useComponentPlacement.getState().frame! };
}
beforeEach(() => { cancelComponentPlacement(); preview.mockReset(); });
afterEach(() => { cancelComponentPlacement(); useCadStore.setState(useCadStore.getInitialState()); });
describe("native component placement workflow", () => {
  it("previews immutably and saves one undo step only for the exact proven placement", async () => {
    const { document, frame } = setup();
    const proof = await previewComponentPlacement(frame, placement, new AbortController().signal);
    expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(0);
    expect(() => applyComponentPlacement({ ...proof }, placement)).toThrow("latest valid");
    expect(() => applyComponentPlacement(proof, { ...placement, translation: [11, 20, 30] })).toThrow("latest valid");
    applyComponentPlacement(proof, placement);
    expect(useCadStore.getState().history.present.components[frame.componentId].placement).toEqual(placement);
    expect(useCadStore.getState().history.past).toEqual([document]); expect(useComponentPlacement.getState().frame).toBeUndefined();
    useCadStore.getState().undo(); expect(useCadStore.getState().history.present).toBe(document);
  });
  it("rejects native body/volume changes and fallback geometry", async () => {
    const { frame } = setup();
    const result = native(frame.document);
    preview.mockResolvedValueOnce({ ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometryAssertions: { ...mesh.geometryAssertions, volume: 23000 } })) });
    await expect(previewComponentPlacement(frame, placement, new AbortController().signal)).rejects.toThrow("volume");
    preview.mockResolvedValueOnce({ ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, bodyId: "different-body" })) });
    await expect(previewComponentPlacement(frame, placement, new AbortController().signal)).rejects.toThrow("identity");
    preview.mockResolvedValueOnce(rebuildDocument(frame.document));
    await expect(previewComponentPlacement(frame, placement, new AbortController().signal)).rejects.toThrow("native solid");
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("rejects delayed results after document/session/active-component changes", async () => {
    const { document, frame } = setup();
    let deliver!: (value: ReturnType<typeof native>) => void;
    preview.mockImplementationOnce(() => new Promise((resolve) => { deliver = resolve; }));
    const pending = previewComponentPlacement(frame, placement, new AbortController().signal);
    useCadStore.setState({ documentSession: 46 }); deliver(native(document));
    await expect(pending).rejects.toThrow("stale"); expect(isCurrentComponentPlacement(frame)).toBe(false); expect(useCadStore.getState().history.present).toBe(document);
  });
  it("rechecks state after gesture cancellation and reports store refusal", async () => {
    const { document, frame } = setup(), proof = await previewComponentPlacement(frame, placement, new AbortController().signal);
    const replace = () => useCadStore.setState({ documentSession: 46 });
    window.addEventListener("plaincad:cancel-sketch-gesture", replace, { once: true });
    try { expect(() => applyComponentPlacement(proof, placement)).toThrow("changed while applying"); }
    finally { window.removeEventListener("plaincad:cancel-sketch-gesture", replace); }
    useCadStore.setState({ documentSession: 45 });
    const ignored = vi.spyOn(useCadStore.getState(), "updateDocument").mockImplementation(() => {});
    try { expect(() => applyComponentPlacement(proof, placement)).toThrow("could not be saved"); }
    finally { ignored.mockRestore(); }
    expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("cancels without history and requires an active native solid", async () => {
    const { document, frame } = setup(); cancelComponentPlacement();
    expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(0);
    useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: rebuildDocument(document) } });
    expect(canBeginComponentPlacement()).toBe(false); expect(() => beginComponentPlacement()).toThrow("native solid");
    await expect(previewComponentPlacement(frame, placement, new AbortController().signal)).rejects.toThrow("changed");
  });
});
