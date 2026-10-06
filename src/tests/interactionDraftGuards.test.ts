import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { buildSketchTrimExtend } from "../cad/sketch/trimExtend";
import { buildContextualConstraint } from "../cad/sketch/contextualConstraints";
import { buildSketchRefinement } from "../ai/sketchRefinement";
import { solidDimensions } from "../cad/inspection/solidDimensions";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { interactionDraftBusy, useContextualConstraintDraft, useFacePocket, useSketchRefinement, useSketchTrimExtend, useSolidDimensionEdit } from "../ui/commands/interactionDraftState";
import { captureContextualConstraintFrame, applyContextualConstraint, previewContextualConstraint } from "../ui/commands/contextualConstraintCommand";
import { captureSketchRefinementFrame, applySketchRefinement, previewSketchRefinement } from "../ui/commands/sketchRefinementCommand";
import { openSketchTrimExtend, applySketchTrimExtend, previewSketchTrimExtend } from "../ui/commands/sketchTrimExtendCommand";
import { beginFacePocket, canBeginFacePocket, chooseFacePocketFace, drawOnPocketFace, facePocketFaces } from "../ui/commands/facePocketCommand";
import { useFacePocketIntent } from "../ui/commands/facePocketIntentState";
import { useFileJobs } from "../persistence/fileJobs";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { beginSolidDimensionEdit, currentSolidDimensionFrame, solidDimensionEditingAvailable } from "../ui/commands/solidDimensionCommand";
import { currentAiFrame } from "../ui/commands/aiCommand";
import { beginExtrudeCreation, beginExtrudeEditing, useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { beginModelingCreation, beginModelingEditing, useModelingDraft } from "../ui/commands/modelingDraftCommand";
import { beginHoleCreation, beginHoleEditing, useHoleDraft } from "../ui/commands/holeCommand";
import { beginGuidedHole, useGuidedHole } from "../ui/commands/guidedHoleCommand";

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
function resetDrafts() {
  useContextualConstraintDraft.setState({ frame: undefined }); useFacePocket.setState({ frame: undefined });
  useSketchRefinement.setState({ frame: undefined }); useSketchTrimExtend.setState({ frame: undefined, pick: undefined });
  useSolidDimensionEdit.setState({ frame: undefined });
}
beforeEach(() => {
  resetDrafts(); useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useExtrudeDraft.setState({ draft: undefined }); useModelingDraft.setState({ draft: undefined });
  useHoleDraft.setState({ draft: undefined }); useGuidedHole.setState({ draft: undefined });
  useFacePocketIntent.setState({ source: undefined });
  useFileJobs.setState({ exportOpen: false }); useProjectWorkflow.setState({ active: undefined });
  mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
});
function canvasFixture() {
  let sketch = createXySketch(); let lineId = "";
  for (const [i, coordinates] of [[0, 0, 30, 3], [10, -10, 10, 10], [20, -10, 20, 10]].entries()) {
    const a = addPoint(sketch, `${coordinates[0]}mm`, `${coordinates[1]}mm`), b = addPoint(a.sketch, `${coordinates[2]}mm`, `${coordinates[3]}mm`), line = addLine(b.sketch, a.pointId, b.pointId);
    sketch = line.sketch; if (!i) lineId = line.lineId;
  }
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: { document: state.history.present, entityIds: [lineId] } });
  const constraint = captureContextualConstraintFrame(); resetDrafts();
  const refinement = captureSketchRefinementFrame(); resetDrafts();
  openSketchTrimExtend("trim"); const trim = useSketchTrimExtend.getState().frame!; resetDrafts();
  return { state, sketch, lineId, constraint, refinement, trim };
}
function nativeFixture() {
  const document = createBoxTemplate(), result = rebuildDocument(document);
  // Simulated responses prove transaction guards; browser tests prove native BRep.
  for (const mesh of result.meshes) { mesh.geometrySource = "opencascade"; mesh.geometryAssertions = { valid: true, solidCount: 1, volume: 1000, surfaceArea: 600 }; }
  useCadStore.setState({ ...useCadStore.getInitialState(), history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, rebuild: { status: "succeeded", kernelReady: true, result }, rebuildNow: vi.fn() }, true);
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  const state = useCadStore.getState();
  const dimension = solidDimensions(document, result, { kind: "feature", id: document.features[0].id, documentId: document.id }, document.rootComponentId)[0];
  return { state, dimension };
}
it("each owner excludes itself while competing owners remain mutually exclusive", () => {
  const frames = canvasFixture();
  useSketchTrimExtend.setState({ frame: frames.trim });
  expect(interactionDraftBusy("trimExtend")).toBe(false); expect(interactionDraftBusy()).toBe(true);
  expect(() => captureContextualConstraintFrame()).toThrow("Finish the current operation");
  expect(() => captureSketchRefinementFrame()).toThrow("Finish the current operation");
  resetDrafts(); useContextualConstraintDraft.setState({ frame: frames.constraint });
  expect(interactionDraftBusy("constraint")).toBe(false);
  expect(() => openSketchTrimExtend("trim")).toThrow("Finish the current operation");
  expect(() => captureSketchRefinementFrame()).toThrow("Finish the current operation");
  resetDrafts(); useSketchRefinement.setState({ frame: frames.refinement });
  expect(interactionDraftBusy("sketchRefinement")).toBe(false);
  expect(() => openSketchTrimExtend("extend")).toThrow("Finish the current operation");
  expect(() => captureContextualConstraintFrame()).toThrow("Finish the current operation");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("direct sketch previews and Apply reject a competing owner without publishing geometry", async () => {
  const frames = canvasFixture();
  const trimPlan = buildSketchTrimExtend(frames.state.history.present, frames.sketch.id, frames.lineId, "trim", { x: 15, y: 1.5 });
  const constraintPlan = buildContextualConstraint(frames.state.history.present, frames.sketch.id, [frames.lineId], "horizontal");
  const refinementPlan = buildSketchRefinement(frames.state.history.present, frames.sketch.id, [frames.lineId], "make selected lines horizontal");
  useSketchTrimExtend.setState({ frame: frames.trim });
  const trim = await previewSketchTrimExtend(trimPlan, new AbortController().signal); resetDrafts();
  const constraint = await previewContextualConstraint(constraintPlan, new AbortController().signal);
  const refinement = await previewSketchRefinement(refinementPlan, new AbortController().signal);
  useSketchRefinement.setState({ frame: frames.refinement });
  await expect(previewSketchTrimExtend(trimPlan, new AbortController().signal)).rejects.toThrow("competing task");
  await expect(previewContextualConstraint(constraintPlan, new AbortController().signal)).rejects.toThrow("competing task");
  expect(() => applySketchTrimExtend(frames.trim, trimPlan, trim.result)).toThrow("changed");
  expect(() => applyContextualConstraint(frames.constraint, constraintPlan, constraint.result)).toThrow("changed");
  resetDrafts(); useContextualConstraintDraft.setState({ frame: frames.constraint });
  await expect(previewSketchRefinement(refinementPlan, new AbortController().signal)).rejects.toThrow("competing task");
  expect(() => applySketchRefinement(frames.refinement, refinementPlan, refinement.result)).toThrow("changed");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("face picking blocks direct solid/AI/sketch tasks and becomes stale under a competing edit", () => {
  const canvas = canvasFixture(); nativeFixture();
  beginFacePocket(); const face = useFacePocket.getState().frame!;
  expect(interactionDraftBusy("facePocket")).toBe(false);
  expect(solidDimensionEditingAvailable()).toBe(false);
  expect(currentAiFrame({ document: face.document, session: face.session, componentId: face.componentId })).toBe(false);
  useSketchRefinement.setState({ frame: canvas.refinement });
  expect(() => chooseFacePocketFace("any-face")).toThrow("changed");
  expect(() => drawOnPocketFace()).toThrow("changed");
  expect(useCadStore.getState().history.past).toHaveLength(0);
  resetDrafts();
  useSketchCanvas.setState({ active: canvas.trim.active, selection: undefined });
  useFacePocket.setState({ frame: face });
  expect(() => captureSketchRefinementFrame()).toThrow("Finish the current operation");
  expect(() => openSketchTrimExtend("trim")).toThrow("Finish the current operation");
});
it("direct solid dimension editing blocks face picking and rejects a subsequently injected competing frame", () => {
  const canvas = canvasFixture(); const { dimension } = nativeFixture();
  beginSolidDimensionEdit(dimension); const frame = useSolidDimensionEdit.getState().frame!;
  expect(interactionDraftBusy("solidDimension")).toBe(false); expect(currentSolidDimensionFrame(frame)).toBe(true);
  expect(canBeginFacePocket()).toBe(false); expect(() => beginFacePocket()).toThrow("Choose an active component");
  useSketchTrimExtend.setState({ frame: canvas.trim });
  expect(currentSolidDimensionFrame(frame)).toBe(false);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("direct standard modeling creation/editing cannot bypass a face picker or inline task", () => {
  nativeFixture(); beginFacePocket(); const frame = useFacePocket.getState().frame!;
  const revolve = { id: "guard-revolve", type: "revolve" as const, name: "Guard revolve", sketchId: Object.keys(frame.document.sketches)[0], profileId: "profile", axis: { type: "origin" as const, axis: "Y" as const }, operation: "newBody" as const, angle: { expression: "360deg", unit: "deg" } };
  expect(() => beginExtrudeCreation(revolve.sketchId)).toThrow("Finish the current edit");
  expect(() => beginExtrudeEditing()).toThrow("Finish the current edit");
  expect(() => beginModelingCreation(revolve)).toThrow("Finish the current edit");
  expect(() => beginModelingEditing()).toThrow("Finish the current edit");
  expect(() => beginHoleCreation()).toThrow("Finish the current edit");
  expect(() => beginHoleEditing()).toThrow("Finish the current edit");
  beginGuidedHole(); expect(useGuidedHole.getState().draft).toBeUndefined();
  expect(useExtrudeDraft.getState().draft).toBeUndefined(); expect(useModelingDraft.getState().draft).toBeUndefined();
  expect(useHoleDraft.getState().draft).toBeUndefined(); expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("retains the undoable authored face sketch but clears intent and reports an explicit canvas-start failure", () => {
  nativeFixture(); beginFacePocket(); chooseFacePocketFace(facePocketFaces()[0].id);
  useCadStore.setState({ select: () => { throw new Error("Selection unavailable"); } });
  expect(() => drawOnPocketFace()).toThrow("Open that sketch again or Undo");
  expect(useFacePocketIntent.getState().source).toBeUndefined();
  expect(useFacePocket.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(useCadStore.getState().fileError).toContain("Selection unavailable");
});
it("canceled contextual and refinement tasks cannot consume old worker-issued proofs", async () => {
  const frames = canvasFixture();
  useContextualConstraintDraft.setState({ frame: frames.constraint });
  const constraintPlan = buildContextualConstraint(frames.state.history.present, frames.sketch.id, [frames.lineId], "horizontal");
  const constraint = await previewContextualConstraint(constraintPlan, new AbortController().signal);
  useContextualConstraintDraft.setState({ frame: undefined });
  expect(() => applyContextualConstraint(frames.constraint, constraintPlan, constraint.result)).toThrow("task changed");
  useSketchRefinement.setState({ frame: frames.refinement });
  const refinementPlan = buildSketchRefinement(frames.state.history.present, frames.sketch.id, [frames.lineId], "make selected lines horizontal");
  const refinement = await previewSketchRefinement(refinementPlan, new AbortController().signal);
  useSketchRefinement.setState({ frame: undefined });
  expect(() => applySketchRefinement(frames.refinement, refinementPlan, refinement.result)).toThrow("task changed");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it.each(["export", "project"] as const)("direct sketch tasks reject an open %s workflow", async (kind) => {
  const frames = canvasFixture();
  if (kind === "export") useFileJobs.setState({ exportOpen: true });
  else useProjectWorkflow.setState({ active: { kind: "sketch", documentId: frames.state.history.present.id, session: frames.state.documentSession, componentId: frames.state.activeComponentId } });
  try {
    expect(() => openSketchTrimExtend("trim")).toThrow("Finish the current operation");
    expect(() => captureContextualConstraintFrame()).toThrow("Finish the current operation");
    expect(() => captureSketchRefinementFrame()).toThrow("Finish the current operation");
    const plan = buildSketchTrimExtend(frames.state.history.present, frames.sketch.id, frames.lineId, "trim", { x: 15, y: 1.5 });
    await expect(previewSketchTrimExtend(plan, new AbortController().signal)).rejects.toThrow("competing task");
    expect(mocks.preview).not.toHaveBeenCalled(); expect(useCadStore.getState().history.past).toHaveLength(0);
  } finally {
    useFileJobs.setState({ exportOpen: false }); useProjectWorkflow.setState({ active: undefined });
  }
});
