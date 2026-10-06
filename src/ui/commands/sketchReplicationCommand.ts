import type { CadDocument } from "../../cad/document/schema";
import type { SketchReplicationMode, SketchReplicationPlan } from "../../cad/sketch/sketchReplication";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore } from "../../state/useCadStore";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { interactionDraftBusy, useSolidDimensionEdit, useSketchRefinement, useContextualConstraintDraft, useSketchTrimExtend, useFacePocket } from "./interactionDraftState";
import { operationDraftBusy, useOperationDrop } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useSketchReplication } from "./sketchReplicationState";
import { useSketchOffset } from "./sketchOffsetState";
import { useAiFeatureAddition } from "./aiFeatureAdditionState";
export { useSketchReplication } from "./sketchReplicationState";

export interface SketchReplicationFrame { document: CadDocument; session: number; componentId: string; active: CanvasSession; selectedIds: string[]; }
function competingDraft() {
  return Boolean(interactionDraftBusy("replication") || operationDraftBusy() || useGuidedHole.getState().draft || useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft || useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active);
}
export function currentSketchReplicationFrame(frame: SketchReplicationFrame) {
  const state = useCadStore.getState();
  return state.history.present === frame.document && state.documentSession === frame.session && state.activeComponentId === frame.componentId &&
    useSketchCanvas.getState().active === frame.active && frame.active.documentId === frame.document.id && frame.active.session === frame.session &&
    (frame.document.sketches[frame.active.sketchId]?.componentId ?? frame.document.rootComponentId) === frame.componentId &&
    JSON.stringify(selectedCanvasEntities()?.entityIds ?? []) === JSON.stringify(frame.selectedIds) && !state.fileBusy && !competingDraft();
}
export function canOpenSketchReplication() { return Boolean(selectedCanvasEntities() && !competingDraft() && !useSketchReplication.getState().frame); }
export function openSketchReplication(mode: SketchReplicationMode) {
  const state = useCadStore.getState(), selected = selectedCanvasEntities();
  if (!selected || !canOpenSketchReplication()) throw new Error("Finish the current operation and select sketch geometry to copy.");
  const frame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active: selected.active, selectedIds: selected.entityIds };
  if (!currentSketchReplicationFrame(frame)) throw new Error("Select geometry in the current sketch and component.");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchReplicationFrame(frame)) throw new Error("The sketch selection changed. Open a fresh copy task.");
  useSketchReplication.setState({ frame, mode });
}
export function cancelSketchReplication() { useSketchReplication.setState({ frame: undefined }); }
/** A competing owner closes the proposal immediately, even without a document edit. */
export function subscribeSketchReplicationEnvironment(onChange: () => void) {
  const stores = [useSolidDimensionEdit, useSketchRefinement, useContextualConstraintDraft, useSketchTrimExtend, useFacePocket,
    useSketchOffset, useAiFeatureAddition, useOperationDrop, useGuidedHole, useExtrudeDraft, useModelingDraft, useHoleDraft, useFileJobs, useProjectWorkflow];
  const unsubscribe = stores.map((store) => store.subscribe(onChange));
  return () => unsubscribe.forEach((stop) => stop());
}
const proofs = new WeakMap<RebuildResult, SketchReplicationPlan>();
function assertPreview(plan: SketchReplicationPlan, result: RebuildResult) {
  if (result.documentId !== plan.document.id || !result.success) throw new Error(result.errors.map((error) => error.message).join(" ") || "Replication preview rebuild failed.");
  const solved = result.solvedSketches?.[plan.sketchId];
  if (!solved || solved.errors.some((error) => error.severity === "error")) throw new Error("The copied sketch needs a successful current solve before Apply.");
  if ((result.profiles?.[plan.sketchId]?.length ?? 0) < plan.profileCount) throw new Error("Replication preview lost a closed region.");
  for (const id of plan.addedEntityIds) if (!plan.document.sketches[plan.sketchId].entities[id]) throw new Error("Replication proposal lost a copied entity. Generate a fresh preview.");
  if (result.meshes.length || plan.document.features.some((feature) => !feature.suppressed)) assertNativeSolidPreview(result, plan.document.id);
  const volume = result.meshes.reduce((sum, mesh) => sum + (mesh.geometryAssertions?.volume ?? 0), 0);
  if (!Number.isFinite(volume)) throw new Error("Replication volume exceeds supported limits.");
  return { solved, native: result.meshes.length > 0, volume };
}
export async function previewSketchReplication(frame: SketchReplicationFrame, plan: SketchReplicationPlan, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Replication preview canceled.");
  if (useSketchReplication.getState().frame !== frame || !currentSketchReplicationFrame(frame) || plan.base !== frame.document || plan.sketchId !== frame.active.sketchId || plan.mode !== useSketchReplication.getState().mode || JSON.stringify(plan.selectedIds) !== JSON.stringify(frame.selectedIds)) throw new Error("Project, selection or copy task changed. Start a fresh preview.");
  const result = await previewModeling(plan.document, signal);
  if (signal.aborted) throw new Error("Replication preview canceled.");
  if (useSketchReplication.getState().frame !== frame || !currentSketchReplicationFrame(frame)) throw new Error("Project or copy task changed. Preview the current sketch again.");
  const geometry = assertPreview(plan, result); proofs.set(result, plan);
  return { result, ...geometry };
}
export function applySketchReplication(frame: SketchReplicationFrame, plan: SketchReplicationPlan, result: RebuildResult) {
  if (!currentSketchReplicationFrame(frame) || useSketchReplication.getState().frame !== frame) throw new Error("Project, sketch, selection or task changed. Preview the current selection again.");
  if (plan.base !== frame.document || plan.document.id !== frame.document.id || plan.sketchId !== frame.active.sketchId || JSON.stringify(plan.selectedIds) !== JSON.stringify(frame.selectedIds) || plan.mode !== useSketchReplication.getState().mode || proofs.get(result) !== plan) throw new Error("Replication preview belongs to another proposal. Generate a fresh preview.");
  assertPreview(plan, result);
  // Discard pointer intent before publishing the reviewed immutable proposal.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchReplicationFrame(frame) || useSketchReplication.getState().frame !== frame) throw new Error("The copy task changed while canceling pointer intent. Start a fresh preview.");
  useCadStore.getState().updateDocument((document) => document === frame.document ? plan.document : document);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Copied geometry could not be saved. Review project diagnostics.");
  proofs.delete(result); useSketchCanvas.setState({ selection: undefined }); cancelSketchReplication();
}
