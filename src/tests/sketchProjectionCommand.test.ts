import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { planSketchProjection } from "../cad/sketch/sketchProjection";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import type { CadDocument } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useSketchProjection, openSketchProjection, loadSketchProjectionSources, previewSketchProjection, applySketchProjection, cancelSketchProjection, breakCurrentSketchProjection, removeCurrentSketchProjection } from "../ui/commands/sketchProjectionCommand";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const preview = vi.mocked(previewModeling);
function setup() {
  const sketch = addCornerRectangle(createSketchOnPlane("Base", "XY"), "30mm", "20mm");
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({ name: "Source block", sketchId: sketch.id, profileId: profile.id, operation: "newBody", distance: { expression: "8mm", unit: "mm" }, direction: "positive" });
  let document = upsertFeature(upsertSketch(createEmptyDocument(), sketch), feature);
  const target = createSketchOnPlane("Cover outline", { type: "offset", base: "XY", offset: { expression: "10mm", unit: "mm" } });
  document = upsertSketch(document, target);
  const native = (doc: CadDocument) => {
    // Unit mock supplies prevalidated native protocol data; browser acceptance
    // exercises real projection survival. Coordinates were materialized by the planner.
    const unlinked = { ...doc, sketches: Object.fromEntries(Object.entries(doc.sketches).map(([id, sketch]) => [id, { ...sketch, projections: undefined }])) };
    const result = rebuildDocument(unlinked), body = result.meshes[0];
    return { ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 4800, surfaceArea: 2000, solidCount: 1 } })), availableEdges: [{ featureId: feature.id, bodyId: body.bodyId, role: "endCapPerimeter" as const }], availableFaces: [] };
  };
  const result = native(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 77, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result }, selection: { selectedIds: [] } });
  useSketchCanvas.setState({ active: { session: 77, documentId: document.id, sketchId: target.id }, selection: undefined });
  preview.mockImplementation(async (doc) => native(doc));
  return { document, target, feature, result, native };
}
beforeEach(() => { cancelSketchProjection(); preview.mockReset(); });
afterEach(() => {
  cancelSketchProjection();
  useCadStore.setState(useCadStore.getInitialState());
  useSketchCanvas.setState(useSketchCanvas.getInitialState());
});
describe("linked sketch projection tasks", () => {
  it("checks sources before the destination and applies only a proven exact preview in one history step", async () => {
    const { document, target } = setup();
    openSketchProjection();
    const frame = useSketchProjection.getState().frame!;
    const sources = await loadSketchProjectionSources(frame, new AbortController().signal);
    expect(preview.mock.calls[0][0].sketches[target.id]).toBeUndefined();
    expect(sources.choices[0].label).toContain("Source block · End cap");
    const chosen = sources.choices[0], plan = planSketchProjection(document, target.id, chosen.featureId, chosen.role, false, sources.proof);
    expect(() => applySketchProjection(frame, plan, sources.proof)).toThrow(/old projection/);
    const proof = await previewSketchProjection(frame, plan, new AbortController().signal);
    expect(useCadStore.getState().history.present).toBe(document);
    applySketchProjection(frame, plan, proof.result);
    expect(useCadStore.getState().history.past).toEqual([document]);
    expect(useCadStore.getState().history.present.sketches[target.id].projections).toHaveLength(1);
    expect(useSketchProjection.getState().frame).toBeUndefined();
  });
  it("rejects delayed proof after selection change without adding geometry or undo history", async () => {
    const { document, target, feature, result, native } = setup();
    openSketchProjection();
    const frame = useSketchProjection.getState().frame!, plan = planSketchProjection(document, target.id, feature.id, "endCapPerimeter", false, result);
    let deliver!: (result: ReturnType<typeof native>) => void;
    const deferred = new Promise<ReturnType<typeof native>>((resolve) => { deliver = resolve; });
    preview.mockImplementationOnce(() => deferred);
    const pending = previewSketchProjection(frame, plan, new AbortController().signal);
    await vi.waitFor(() => expect(preview).toHaveBeenCalled());
    useSketchCanvas.setState({ active: { session: 77, documentId: document.id, sketchId: feature.sketchId } });
    deliver(native(plan.document));
    await expect(pending).rejects.toThrow(/stale/);
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("rejects foreign results and rechecks the captured session after canceling gestures before Break link", () => {
    const { document, target, feature, result, native } = setup();
    const plan = planSketchProjection(document, target.id, feature.id, "endCapPerimeter", false, result);
    const currentResult = native(plan.document);
    useCadStore.setState({ history: { past: [], present: plan.document, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result: { ...currentResult, documentId: "another-project" } } });
    expect(() => breakCurrentSketchProjection(plan.projection.id)).toThrow(/current successful/);
    useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: currentResult } });
    const changeSession = vi.fn(() => useCadStore.setState({ documentSession: 78 }));
    window.addEventListener("plaincad:cancel-sketch-gesture", changeSession, { once: true });
    try {
      expect(() => breakCurrentSketchProjection(plan.projection.id)).toThrow(/changed/);
      expect(changeSession).toHaveBeenCalledOnce();
    } finally { window.removeEventListener("plaincad:cancel-sketch-gesture", changeSession); }
    expect(useCadStore.getState().history.present).toBe(plan.document);
    expect(useCadStore.getState().history.past).toHaveLength(0);
    expect(useCadStore.getState().history.present.sketches[target.id].projections).toHaveLength(1);
  });

  it("rejects removal after a session change during gesture cancellation", () => {
    const { document, target, feature, result } = setup();
    const plan = planSketchProjection(document, target.id, feature.id, "endCapPerimeter", false, result);
    useCadStore.setState({ history: { past: [], present: plan.document, future: [] } });
    const changeSession = vi.fn(() => useCadStore.setState({ documentSession: 78 }));
    window.addEventListener("plaincad:cancel-sketch-gesture", changeSession, { once: true });
    try {
      expect(() => removeCurrentSketchProjection(plan.projection.id)).toThrow(/changed/);
      expect(changeSession).toHaveBeenCalledOnce();
    } finally { window.removeEventListener("plaincad:cancel-sketch-gesture", changeSession); }
    expect(useCadStore.getState().history.present).toBe(plan.document);
    expect(useCadStore.getState().history.past).toHaveLength(0);
    expect(useCadStore.getState().history.present.sketches[target.id].projections).toHaveLength(1);
  });

  it("reports a rejected Break link or Remove without claiming completion or clearing selection", () => {
    const { document, target, feature, result, native } = setup();
    const plan = planSketchProjection(document, target.id, feature.id, "endCapPerimeter", false, result);
    useCadStore.setState({ history: { past: [], present: plan.document, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result: native(plan.document) } });
    const ignored = vi.spyOn(useCadStore.getState(), "updateDocument").mockImplementation(() => {});
    try {
      expect(() => breakCurrentSketchProjection(plan.projection.id)).toThrow("could not be broken");
      expect(() => removeCurrentSketchProjection(plan.projection.id)).toThrow("could not be removed");
      expect(useCadStore.getState().history.present).toBe(plan.document);
      expect(useCadStore.getState().history.past).toHaveLength(0);
    } finally { ignored.mockRestore(); }
  });

});
