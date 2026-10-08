import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { interactionDraftBusy, useSketchRefinement } from "./interactionDraftState";
export { useSketchRefinement } from "./interactionDraftState";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { SketchRefinement } from "../../ai/sketchRefinement";
import { useCadStore } from "../../state/useCadStore";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { recordAiHistoryChange } from "./aiHistoryState";

export interface SketchRefinementFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  active: CanvasSession;
  selectedIds: string[];
}
function competingRefinementTask() {
  return Boolean(interactionDraftBusy("sketchRefinement") || operationDraftBusy() || useGuidedHole.getState().draft ||
    useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft ||
    useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active);
}
export function captureSketchRefinementFrame(): SketchRefinementFrame {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active;
  if (!active || state.fileBusy || competingRefinementTask())
    throw new Error("Finish the current operation and open a sketch to refine it.");
  const frame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId,
    active, selectedIds: selectedCanvasEntities()?.entityIds ?? [] };
  if (!currentSketchRefinementFrame(frame)) throw new Error("Open a current sketch in this component.");
  return frame;
}
export function currentSketchRefinementFrame(frame: SketchRefinementFrame) {
  const state = useCadStore.getState(), selection = selectedCanvasEntities()?.entityIds ?? [];
  return state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && useSketchCanvas.getState().active === frame.active &&
    frame.active.documentId === frame.document.id && frame.active.session === frame.session &&
    (frame.document.sketches[frame.active.sketchId]?.componentId ?? frame.document.rootComponentId) === frame.componentId &&
    JSON.stringify(selection) === JSON.stringify(frame.selectedIds) && !state.fileBusy && !competingRefinementTask();
}
export function assertSketchRefinementPreview(plan: SketchRefinement, result: RebuildResult) {
  if (result.documentId !== plan.document.id || !result.success)
    throw new Error(result.errors.map((e) => e.message).join(" ") || "Refinement rebuild failed.");
  const solved = result.solvedSketches?.[plan.sketchId];
  if (!solved || solved.errors.some((e) => e.severity === "error")) throw new Error("A successful current sketch solve is required before Apply.");
  if (plan.profileCount > 0 && !result.profiles?.[plan.sketchId]?.length) throw new Error("Preview lost the closed sketch profile.");
  if (result.meshes.length || plan.document.features.some((f) => !f.suppressed)) assertNativeSolidPreview(result, plan.document.id);
  const volume = result.meshes.reduce((sum, mesh) => sum + (mesh.geometryAssertions?.volume ?? 0), 0);
  if (!Number.isFinite(volume)) throw new Error("Native refinement volume exceeds supported limits.");
  return { native: result.meshes.length > 0, volume, solved };
}
// Only the awaited worker call can issue a proof for a specific staged plan.
// Document IDs are stable across edits and are insufficient to identify revisions.
const validatedPreviews = new WeakMap<RebuildResult, SketchRefinement>();
export async function previewSketchRefinement(plan: SketchRefinement, signal: AbortSignal) {
  if (competingRefinementTask())
    throw new Error("Finish the competing task before previewing sketch refinement.");
  const result = await previewModeling(plan.document, signal);
  if (signal.aborted) throw new Error("Refinement preview canceled.");
  if (competingRefinementTask())
    throw new Error("Another task started. Preview the sketch refinement again.");
  const geometry = assertSketchRefinementPreview(plan, result);
  validatedPreviews.set(result, plan);
  return { result, ...geometry };
}
export function applySketchRefinement(frame: SketchRefinementFrame, plan: SketchRefinement, result: RebuildResult) {
  if (!currentSketchRefinementFrame(frame) || useSketchRefinement.getState().frame !== frame) throw new Error("Project, sketch, selection or task changed. Generate a fresh refinement preview.");
  if (plan.base !== frame.document || plan.sketchId !== frame.active.sketchId || plan.document.id !== frame.document.id)
    throw new Error("Refinement belongs to another project or sketch revision. Generate a fresh preview.");
  if (validatedPreviews.get(result) !== plan)
    throw new Error("Refinement result does not match this proposal. Generate a fresh preview.");
  assertSketchRefinementPreview(plan, result);
  // Deliberately cancel transient pointer intent before publication, even if the
  // store rejects the edit; the reviewed immutable proposal must stay authoritative.
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  const state = useCadStore.getState();
  state.updateDocument((document) => document === frame.document ? plan.document : document);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Refinement could not be saved. Review project diagnostics.");
  recordAiHistoryChange(frame.document, frame.session, "Refine sketch");
  validatedPreviews.delete(result);
  useSketchCanvas.setState({ selection: undefined });
  useSketchRefinement.setState({ frame: undefined });
}
