import type { CadDocument } from "../../cad/document/schema";
import type { ContextualConstraintPlan } from "../../cad/sketch/contextualConstraints";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore } from "../../state/useCadStore";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { interactionDraftBusy, useContextualConstraintDraft } from "./interactionDraftState";
export { useContextualConstraintDraft } from "./interactionDraftState";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";

export interface ContextualConstraintFrame { document: CadDocument; session: number; componentId: string; active: CanvasSession; selectedIds: string[]; }
export function contextualConstraintBusy() { return Boolean(useContextualConstraintDraft.getState().frame); }
function competingDraft() { return Boolean(interactionDraftBusy("constraint") || operationDraftBusy() || useGuidedHole.getState().draft ||
  useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft ||
  useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active); }
export function currentContextualConstraintFrame(frame: ContextualConstraintFrame) {
  const state = useCadStore.getState();
  return state.history.present === frame.document && state.documentSession === frame.session && state.activeComponentId === frame.componentId &&
    useSketchCanvas.getState().active === frame.active && frame.active.documentId === frame.document.id && frame.active.session === frame.session &&
    (frame.document.sketches[frame.active.sketchId]?.componentId ?? frame.document.rootComponentId) === frame.componentId &&
    JSON.stringify(selectedCanvasEntities()?.entityIds ?? []) === JSON.stringify(frame.selectedIds) && !state.fileBusy && !competingDraft();
}
export function captureContextualConstraintFrame(): ContextualConstraintFrame {
  const state = useCadStore.getState(), selection = selectedCanvasEntities();
  if (!selection || state.fileBusy || competingDraft()) throw new Error("Finish the current operation and select current sketch geometry.");
  const frame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active: selection.active, selectedIds: selection.entityIds };
  if (!currentContextualConstraintFrame(frame)) throw new Error("Select geometry in the current sketch and component.");
  return frame;
}
const proofs = new WeakMap<RebuildResult, ContextualConstraintPlan>();
function assertPreview(plan: ContextualConstraintPlan, result: RebuildResult) {
  if (result.documentId !== plan.document.id) throw new Error("Constraint preview belongs to another document. Preview the current selection again.");
  if (!result.success) throw new Error(result.errors.map((error) => error.message).join(" ") || "Constraint preview rebuild failed.");
  const solved = result.solvedSketches?.[plan.sketchId];
  if (!solved || solved.errors.some((error) => error.severity === "error")) throw new Error("A successful current sketch solve is required before Apply.");
  if ((result.profiles?.[plan.sketchId]?.length ?? 0) < plan.profileCount) throw new Error("Constraint preview lost a closed region.");
  if (result.meshes.length || plan.document.features.some((feature) => !feature.suppressed)) assertNativeSolidPreview(result, plan.document.id);
  const volume = result.meshes.reduce((sum, mesh) => sum + (mesh.geometryAssertions?.volume ?? 0), 0);
  if (!Number.isFinite(volume)) throw new Error("Constraint preview volume exceeds supported limits.");
  return { solved, native: result.meshes.length > 0, volume };
}
export async function previewContextualConstraint(plan: ContextualConstraintPlan, signal: AbortSignal) {
  if (competingDraft()) throw new Error("Finish the competing task before previewing a sketch constraint.");
  const result = await previewModeling(plan.document, signal);
  if (signal.aborted) throw new Error("Constraint preview canceled.");
  if (competingDraft()) throw new Error("Another task started. Preview the constraint again.");
  const geometry = assertPreview(plan, result); proofs.set(result, plan);
  return { result, ...geometry };
}
export function applyContextualConstraint(frame: ContextualConstraintFrame, plan: ContextualConstraintPlan, result: RebuildResult) {
  if (!currentContextualConstraintFrame(frame) || useContextualConstraintDraft.getState().frame !== frame) throw new Error("Project, sketch, selection or task changed. Preview the current selection again.");
  if (plan.base !== frame.document || plan.sketchId !== frame.active.sketchId || JSON.stringify(plan.selectedIds) !== JSON.stringify(frame.selectedIds) || proofs.get(result) !== plan) throw new Error("Constraint preview belongs to another proposal. Preview the current selection again.");
  assertPreview(plan, result);
  // Discard unfinished pointer intent before publication: the reviewed immutable
  // proposal must remain authoritative even if saving is rejected.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  useCadStore.getState().updateDocument((document) => document === frame.document ? plan.document : document);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Constraint could not be saved. Review project diagnostics.");
  proofs.delete(result); useSketchCanvas.setState({ selection: undefined }); useContextualConstraintDraft.setState({ frame: undefined });
}
