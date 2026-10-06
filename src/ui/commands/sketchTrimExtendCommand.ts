import type { CadDocument } from "../../cad/document/schema";
import type { CanvasPoint } from "../../cad/sketch/canvasGeometry";
import type { SketchTrimExtendPlan, TrimExtendMode } from "../../cad/sketch/trimExtend";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore } from "../../state/useCadStore";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { interactionDraftBusy, useSketchTrimExtend } from "./interactionDraftState";
export { useSketchTrimExtend } from "./interactionDraftState";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";

export interface SketchTrimExtendFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  active: CanvasSession;
  lineId?: string;
}
function competingTrimTask() {
  return Boolean(interactionDraftBusy("trimExtend") || operationDraftBusy() || useGuidedHole.getState().draft ||
    useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft ||
    useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active);
}
export function currentSketchTrimExtendFrame(frame: SketchTrimExtendFrame) {
  const state = useCadStore.getState();
  return state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && useSketchCanvas.getState().active === frame.active &&
    frame.active.documentId === frame.document.id && frame.active.session === frame.session &&
    (frame.document.sketches[frame.active.sketchId]?.componentId ?? frame.document.rootComponentId) === frame.componentId &&
    !state.fileBusy && !competingTrimTask();
}
export function openSketchTrimExtend(mode: TrimExtendMode) {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active;
  if (!active) throw new Error("Open a sketch before trimming or extending.");
  const selection = selectedCanvasEntities()?.entityIds ?? [];
  const frame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active,
    lineId: selection.length === 1 ? selection[0] : undefined };
  if (!currentSketchTrimExtendFrame(frame)) throw new Error("Finish the current operation and open a current sketch in this component.");
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  useSketchTrimExtend.setState({ frame, mode, pick: undefined });
}
export function setSketchTrimExtendPick(pick: CanvasPoint) {
  const frame = useSketchTrimExtend.getState().frame;
  if (!frame || !currentSketchTrimExtendFrame(frame)) throw new Error("Project changed. Open Trim or Extend again.");
  if (!Number.isFinite(pick.x) || !Number.isFinite(pick.y) || Math.max(Math.abs(pick.x), Math.abs(pick.y)) > 1e8)
    throw new Error("Pick coordinates must be finite and within 100,000,000 mm.");
  useSketchTrimExtend.setState({ pick });
}
export function cancelSketchTrimExtend() {
  useSketchTrimExtend.setState({ frame: undefined, pick: undefined });
}
const previews = new WeakMap<RebuildResult, SketchTrimExtendPlan>();
function assertPreview(plan: SketchTrimExtendPlan, result: RebuildResult) {
  if (!result.success || result.documentId !== plan.document.id)
    throw new Error(result.errors.map((error) => error.message).join(" ") || "Trim/extend preview rebuild failed.");
  const solved = result.solvedSketches?.[plan.sketchId];
  if (!solved || solved.errors.some((error) => error.severity === "error")) throw new Error("The edited sketch needs a successful current solve before Apply.");
  if (plan.document.features.some((feature) => !feature.suppressed)) assertNativeSolidPreview(result, plan.document.id);
  return solved;
}
export async function previewSketchTrimExtend(plan: SketchTrimExtendPlan, signal: AbortSignal) {
  if (competingTrimTask()) throw new Error("Finish the competing task before previewing Trim or Extend.");
  const result = await previewModeling(plan.document, signal);
  if (signal.aborted) throw new Error("Trim/extend preview canceled.");
  if (competingTrimTask()) throw new Error("Another task started. Preview Trim or Extend again.");
  const solved = assertPreview(plan, result);
  previews.set(result, plan);
  return { result, solved };
}
export function applySketchTrimExtend(frame: SketchTrimExtendFrame, plan: SketchTrimExtendPlan, result: RebuildResult) {
  if (!currentSketchTrimExtendFrame(frame) || useSketchTrimExtend.getState().frame !== frame)
    throw new Error("Project or sketch changed. Open a fresh trim/extend preview.");
  if (plan.base !== frame.document || plan.sketchId !== frame.active.sketchId || plan.document.id !== frame.document.id || previews.get(result) !== plan)
    throw new Error("Preview does not match this trim/extend proposal. Generate a fresh preview.");
  assertPreview(plan, result);
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  useCadStore.getState().updateDocument((document) => document === frame.document ? plan.document : document);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Trim/extend could not be saved. Review project diagnostics.");
  previews.delete(result);
  useSketchCanvas.setState({ selection: undefined });
  cancelSketchTrimExtend();
}
