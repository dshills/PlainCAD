import { BEFORE_LINKED_SOURCE_EDIT_EVENT, CANCEL_SKETCH_GESTURE_EVENT } from "../ui/commands/sketchCanvasEvents";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addComponent } from "../cad/document/components";
import { addCornerRectangle, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { planSketchProjection } from "../cad/sketch/sketchProjection";
import { useCadStore } from "../state/useCadStore";
import { useGeometryHighlight } from "../state/useGeometryHighlight";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useSketchOffset } from "../ui/commands/sketchOffsetState";
import { cancelSketchProjection } from "../ui/commands/sketchProjectionCommand";
import { linkedSketchContext, canNavigateLinkedSketchSource, showLinkedSketchSource, editLinkedSketchSource } from "../ui/commands/linkedSketchCommand";
import { SketchProjectionLinks } from "../ui/panels/SketchProjectionLinks";
function setup() {
  const source = addCornerRectangle(createSketchOnPlane("Source outline", "XY"), "30mm", "20mm");
  const feature = createExtrudeFeature({ name: "Source block", sketchId: source.id, profileId: detectProfiles(solveSketch(source, {})).profiles[0].id, operation: "newBody", distance: { expression: "8mm", unit: "mm" }, direction: "positive" });
  let document = upsertFeature(upsertSketch(createEmptyDocument(), source), feature);
  const cover = addComponent(document, "Cover");
  const target = { ...createSketchOnPlane("Cover outline", { type: "offset" as const, base: "XY", offset: { expression: "10mm", unit: "mm" } }), componentId: cover.component.id };
  document = upsertSketch(cover.document, target);
  const base = rebuildDocument(document), bodyId = base.meshes[0].bodyId;
  const proof = { ...base, meshes: base.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 4800, surfaceArea: 2000, solidCount: 1 } })), availableEdges: [{ featureId: feature.id, bodyId, role: "endCapPerimeter" as const }] };
  const plan = planSketchProjection(document, target.id, feature.id, "endCapPerimeter", false, proof);
  const result = { ...proof, solvedSketches: { ...proof.solvedSketches, [target.id]: solveSketch(plan.document.sketches[target.id], {}) } };
  useCadStore.setState({ history: { past: [], present: plan.document, future: [] }, documentSession: 13, activeComponentId: target.componentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result }, selection: { selectedIds: [] } });
  useSketchCanvas.setState({ active: { session: 13, documentId: document.id, sketchId: target.id }, selection: { document: plan.document, entityIds: [plan.projection.members[0].targetEntityId] } });
  return { document: plan.document, source, target, feature, link: plan.projection, result };
}
afterEach(() => {
  cleanup();
  useSketchOffset.setState({ frame: undefined });
  cancelSketchProjection(); useCadStore.setState(useCadStore.getInitialState()); useSketchCanvas.setState({ active: undefined, selection: undefined });
  useGeometryHighlight.setState({ highlight: undefined }); useWorkspaceState.setState(useWorkspaceState.getInitialState());
});
describe("linked sketch source navigation", () => {
  it("shows source provenance and highlights its source without closing the destination or editing history", async () => {
    const { document, target, feature, source } = setup();
    render(<SketchProjectionLinks />);
    expect(screen.getByLabelText("Linked geometry explanation")).toHaveTextContent(`Source block / ${source.name}`);
    fireEvent.click(screen.getByRole("button", { name: "Show source" }));
    expect(useSketchCanvas.getState().active?.sketchId).toBe(target.id);
    expect(useCadStore.getState().activeComponentId).toBe(target.componentId);
    await waitFor(() => expect(useCadStore.getState().selection.selectedIds[0]).toEqual({ kind: "feature", id: feature.id, documentId: document.id }));
    expect(useGeometryHighlight.getState().highlight?.bodyIds).toEqual([useCadStore.getState().rebuild.result!.bodies[0].id]);
    expect(useWorkspaceState.getState().activePanel).toBe("inspector");
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("never highlights fallback geometry from a failed rebuild while allowing source inspection", () => {
    const { result } = setup();
    useCadStore.setState({ rebuild: { status: "failed", kernelReady: true, result: { ...result, success: false, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "fallback" })) } } });
    expect(canNavigateLinkedSketchSource()).toBe(true);
    showLinkedSketchSource();
    expect(useGeometryHighlight.getState().highlight?.bodyIds).toEqual([]);
  });
  it("opens the actual source drawing while preserving completed geometry and undo history", () => {
    const { document, source } = setup();
    editLinkedSketchSource();
    expect(useSketchCanvas.getState().active?.sketchId).toBe(source.id);
    expect(useCadStore.getState().activeComponentId).toBe(document.rootComponentId);
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toHaveLength(0);
    expect(useSketchCanvas.getState().selection).toBeUndefined();
  });
  it("honors a mounted drawing veto without discarding the current sketch or selection", () => {
    const { target } = setup(), active = useSketchCanvas.getState().active, selection = useSketchCanvas.getState().selection;
    const veto = (event: Event) => event.preventDefault();
    window.addEventListener(BEFORE_LINKED_SOURCE_EDIT_EVENT, veto);
    try { expect(() => editLinkedSketchSource()).toThrow(/Finish or cancel/); }
    finally { window.removeEventListener(BEFORE_LINKED_SOURCE_EDIT_EVENT, veto); }
    expect(useSketchCanvas.getState().active).toBe(active);
    expect(useSketchCanvas.getState().active?.sketchId).toBe(target.id);
    expect(useSketchCanvas.getState().selection).toBe(selection);
  });
  it("rejects captured links after document/session replacement and after gesture cancellation changes session", () => {
    setup(); const replaced = linkedSketchContext()!;
    useCadStore.setState({ history: { past: [], present: { ...replaced.document }, future: [] } });
    expect(() => showLinkedSketchSource(replaced)).toThrow(/changed/);
    setup(); const context = linkedSketchContext()!;
    useCadStore.setState({ documentSession: 14 });
    expect(() => showLinkedSketchSource(context)).toThrow(/changed/);
    setup(); const current = linkedSketchContext()!;
    const replace = () => useCadStore.setState({ documentSession: 14 });
    window.addEventListener(CANCEL_SKETCH_GESTURE_EVENT, replace, { once: true });
    try { expect(() => editLinkedSketchSource(current)).toThrow(/changed/); }
    finally { window.removeEventListener(CANCEL_SKETCH_GESTURE_EVENT, replace); }
    expect(useSketchCanvas.getState().active).toBe(current.active);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("blocks source navigation while another sketch operation owns a draft", () => {
    setup(); const context = linkedSketchContext()!;
    // The shared ownership gate rejects the presence of a competing offset
    // before its frame details are consumed by any navigation helper.
    useSketchOffset.setState({ frame: { document: context.document, session: context.session, active: context.active, componentId: useCadStore.getState().activeComponentId, selectedIds: [] } });
    expect(canNavigateLinkedSketchSource()).toBe(false);
    expect(() => editLinkedSketchSource(context)).toThrow(/changed/);
    expect(useSketchCanvas.getState().active).toBe(context.active);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("disables unavailable sources and pending or foreign rebuilds without guessing a source", () => {
    setup();
    useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "queued" } });
    expect(canNavigateLinkedSketchSource()).toBe(false);
    setup(); useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...useCadStore.getState().rebuild.result!, documentId: "foreign" } } });
    expect(canNavigateLinkedSketchSource()).toBe(false);
    const { document, feature, link } = setup();
    useCadStore.setState({ history: { past: [], present: { ...document, features: document.features.filter((item) => item.id !== feature.id) }, future: [] } });
    expect(linkedSketchContext(link.id)).toBeDefined();
    expect(canNavigateLinkedSketchSource(link.id)).toBe(false);
  });
});
