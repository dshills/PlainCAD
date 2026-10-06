import type { CadDocument } from "../../cad/document/schema";
import type { SketchOffsetPlan } from "../../cad/sketch/sketchOffset";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore } from "../../state/useCadStore";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useSketchOffset } from "./sketchOffsetState";
export { useSketchOffset } from "./sketchOffsetState";
export interface SketchOffsetFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  active: CanvasSession;
  selectedIds: string[];
}
function competingTask() {
  return Boolean(interactionDraftBusy("offset") || operationDraftBusy() || useGuidedHole.getState().draft ||
    useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft ||
    useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active);
}
export function currentSketchOffsetFrame(frame: SketchOffsetFrame) {
  const state = useCadStore.getState();
  return state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && useSketchCanvas.getState().active === frame.active &&
    frame.active.documentId === frame.document.id && frame.active.session === frame.session &&
    (frame.document.sketches[frame.active.sketchId]?.componentId ?? frame.document.rootComponentId) === frame.componentId &&
    JSON.stringify(selectedCanvasEntities()?.entityIds ?? []) === JSON.stringify(frame.selectedIds) &&
    !state.fileBusy && !competingTask();
}
export function canOpenSketchOffset() {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active;
  if (!active || useSketchOffset.getState().frame) return false;
  const frame: SketchOffsetFrame = { document: state.history.present, session: state.documentSession,
    componentId: state.activeComponentId, active, selectedIds: selectedCanvasEntities()?.entityIds ?? [] };
  return currentSketchOffsetFrame(frame);
}
export function openSketchOffset() {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active;
  if (!active || useSketchOffset.getState().frame) throw new Error("Open a current sketch and finish the current operation before offsetting an outline.");
  const frame: SketchOffsetFrame = { document: state.history.present, session: state.documentSession,
    componentId: state.activeComponentId, active, selectedIds: selectedCanvasEntities()?.entityIds ?? [] };
  if (!currentSketchOffsetFrame(frame)) throw new Error("Finish the current operation and open a current sketch in this component.");
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchOffsetFrame(frame)) throw new Error("The sketch selection changed. Start outline offset again.");
  useSketchOffset.setState({ frame });
}
export function cancelSketchOffset() { useSketchOffset.setState({ frame: undefined }); }
const previews = new WeakMap<RebuildResult, SketchOffsetPlan>();
function assertPreview(plan: SketchOffsetPlan, result: RebuildResult) {
  const sketch = plan.document.sketches[plan.sketchId];
  if (!sketch || !plan.copiedEntityIds.length || new Set(plan.copiedEntityIds).size !== plan.copiedEntityIds.length || plan.copiedEntityIds.some((id) => !sketch.entities[id]))
    throw new Error("The copied contour contains missing or duplicate geometry. Generate a fresh outline offset.");
  const copiedCurves = plan.copiedEntityIds.filter((id) => sketch.entities[id].type !== "point");
  if (!copiedCurves.length) throw new Error("The copied contour has no curves. Generate a fresh outline offset.");
  if (!result.success || result.documentId !== plan.document.id)
    throw new Error(result.errors.map((error) => error.message).join(" ") || "Outline offset preview rebuild failed.");
  const solved = result.solvedSketches?.[plan.sketchId];
  if (!solved || solved.errors.some((error) => error.severity === "error") || !result.profiles?.[plan.sketchId]?.length)
    throw new Error("The copied outline needs a successful solve and closed profile before Apply.");
  const profile = result.profiles[plan.sketchId].find((item) => [item.outerLoop, ...item.innerLoops].some((loop) =>
    copiedCurves.every((id) => loop.entityIds.includes(id))));
  if (!profile) throw new Error("The copied contour was lost or fragmented in the preview. Generate a fresh outline offset.");
  if (plan.document.features.some((feature) => !feature.suppressed)) assertNativeSolidPreview(result, plan.document.id);
  return solved;
}
export async function previewSketchOffset(frame: SketchOffsetFrame, plan: SketchOffsetPlan, signal: AbortSignal) {
  if (useSketchOffset.getState().frame !== frame || !currentSketchOffsetFrame(frame) || plan.base !== frame.document || plan.sketchId !== frame.active.sketchId)
    throw new Error("Project, selection or outline draft changed. Start a fresh outline offset.");
  const result = await previewModeling(plan.document, signal);
  if (signal.aborted) throw new Error("Outline offset preview canceled.");
  if (useSketchOffset.getState().frame !== frame || !currentSketchOffsetFrame(frame))
    throw new Error("Project or outline task changed. Preview the current sketch again.");
  const solved = assertPreview(plan, result);
  previews.set(result, plan);
  return { result, solved };
}
export function applySketchOffset(frame: SketchOffsetFrame, plan: SketchOffsetPlan, result: RebuildResult) {
  if (useSketchOffset.getState().frame !== frame || !currentSketchOffsetFrame(frame))
    throw new Error("Project, sketch or selection changed. Start a fresh outline offset.");
  if (plan.base !== frame.document || plan.sketchId !== frame.active.sketchId || plan.document.id !== frame.document.id || previews.get(result) !== plan)
    throw new Error("Native/solve proof does not match this copied outline. Generate a fresh preview.");
  assertPreview(plan, result);
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchOffsetFrame(frame)) throw new Error("The sketch changed while canceling pointer intent. Start a fresh outline offset.");
  useCadStore.getState().updateDocument((document) => document === frame.document ? plan.document : document);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Outline offset could not be saved. Review project diagnostics.");
  previews.delete(result);
  useSketchCanvas.setState({ selection: undefined });
  cancelSketchOffset();
}
