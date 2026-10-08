import { create } from "zustand";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import { useCadStore } from "../../state/useCadStore";
import { useAiDrawer } from "./aiCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { currentSketchRefinementFrame, useSketchRefinement, type SketchRefinementFrame } from "./sketchRefinementCommand";
import { useSolidDimensionEdit, useContextualConstraintDraft, useSketchTrimExtend, useFacePocket, useFeaturePattern } from "./interactionDraftState";
import { useComponentPlacement } from "./componentPlacementState";
import { usePartLibrary } from "./partLibraryState";
import { useStepExport } from "./stepExportState";
import { useInspectionState } from "../../state/inspectionState";
import { useSketchProjection } from "./sketchProjectionState";
import { useReusablePart } from "./reusablePartState";
import { useSketchReplication } from "./sketchReplicationState";
import { useAiFeatureAddition } from "./aiFeatureAdditionState";
import { useSketchOffset } from "./sketchOffsetState";
import { useOperationDrop } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";

interface SketchCanvasProposal { frame: SketchRefinementFrame; solved: ResolvedSketch; mode: "before" | "after" }
/** Solved proposal geometry is runtime presentation data, never project data. */
export const useAiSketchCanvasPreview = create<{ proposal?: SketchCanvasProposal }>(() => ({}));
export function currentAiSketchCanvasPreview(proposal: SketchCanvasProposal) {
  return useAiDrawer.getState().open && currentSketchRefinementFrame(proposal.frame) &&
    useSketchRefinement.getState().frame === proposal.frame;
}
export function publishAiSketchCanvasPreview(frame: SketchRefinementFrame, solved: ResolvedSketch) {
  const proposal: SketchCanvasProposal = { frame, solved, mode: "after" };
  if (solved.id !== frame.active.sketchId || solved.errors.some(error => error.severity === "error") || !currentAiSketchCanvasPreview(proposal)) return false;
  useAiSketchCanvasPreview.setState({ proposal });
  return true;
}
export function canReviewAiSketchCanvasPreview(frame: SketchRefinementFrame, solved: ResolvedSketch) {
  const proposal = useAiSketchCanvasPreview.getState().proposal;
  return Boolean(proposal && proposal.frame === frame && proposal.solved === solved && currentAiSketchCanvasPreview(proposal));
}
export function clearAiSketchCanvasPreview(frame?: SketchRefinementFrame) {
  if (!frame || useAiSketchCanvasPreview.getState().proposal?.frame === frame)
    useAiSketchCanvasPreview.setState({ proposal: undefined });
}
export function setAiSketchCanvasMode(mode: "before" | "after") {
  const proposal = useAiSketchCanvasPreview.getState().proposal;
  if (proposal && currentAiSketchCanvasPreview(proposal)) useAiSketchCanvasPreview.setState({ proposal: { ...proposal, mode } });
  else clearAiSketchCanvasPreview();
}
function discardStaleProposal() {
  const proposal = useAiSketchCanvasPreview.getState().proposal;
  if (proposal && !currentAiSketchCanvasPreview(proposal)) clearAiSketchCanvasPreview(proposal.frame);
}
// Release development subscriptions when Vite replaces this module.
const subscriptions = [useCadStore, useSketchCanvas, useAiDrawer, useSketchRefinement,
  useSolidDimensionEdit, useContextualConstraintDraft, useSketchTrimExtend, useFacePocket, useFeaturePattern,
  useComponentPlacement, usePartLibrary, useStepExport, useInspectionState, useSketchProjection, useReusablePart,
  useSketchReplication, useAiFeatureAddition, useSketchOffset, useOperationDrop, useGuidedHole, useExtrudeDraft,
  useModelingDraft, useHoleDraft, useFileJobs, useProjectWorkflow].map((store) => store.subscribe(discardStaleProposal));
if (import.meta.hot) import.meta.hot.dispose(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  clearAiSketchCanvasPreview();
});
