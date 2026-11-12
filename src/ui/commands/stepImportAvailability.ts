import { useFileJobs } from "../../persistence/fileJobs";
import { currentAiCanvasPreview } from "../../state/aiCanvasPreview";
import { useAiFacePicking } from "../../state/aiFacePicking";
import type { CadStore } from "../../state/useCadStore";
import { useExtrudeDraft } from "./extrudeCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useHoleDraft } from "./holeCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { useModelingDraft } from "./modelingDraftCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useProjectDrop } from "./projectDropCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { stepImportNativeReady, stepImportSourceMatches, useStepImport, type StepImportFrame, type StepImportPreview } from "./stepImportState";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";

const issued = new WeakSet<StepImportPreview>();

function competingTask(state: CadStore) {
  return interactionDraftBusy("stepImport") || operationDraftBusy() ||
    Boolean(useSketchCanvas.getState().active || useProjectWorkflow.getState().active ||
      useProjectDrop.getState().pending || useExtrudeDraft.getState().draft ||
      useHoleDraft.getState().draft || useModelingDraft.getState().draft ||
      useGuidedHole.getState().draft || useTargetScopeCapture.getState().busy ||
      useFileJobs.getState().exportOpen || useAiFacePicking.getState().frame ||
      currentAiCanvasPreview(state));
}

export function canOpenStepImport(state: CadStore) {
  return typeof Worker !== "undefined" && !state.fileBusy && !useStepImport.getState().frame &&
    stepImportNativeReady(state) && !competingTask(state);
}

export function stepImportFrameCurrent(frame: StepImportFrame, state: CadStore, ownsFileJob = false) {
  return useStepImport.getState().frame === frame && stepImportSourceMatches(frame, state) &&
    (!state.fileBusy || (frame.busy && ownsFileJob)) && !competingTask(state);
}

export function canApplyStepImport(state: CadStore) {
  const frame = useStepImport.getState().frame;
  return Boolean(frame?.preview && !frame.busy && issued.has(frame.preview) && stepImportFrameCurrent(frame, state));
}

/** Only the native completion path issues a preview; never a JSON command. */
export function issueStepImportPreview(preview: StepImportPreview) { issued.add(preview); }
export function consumeStepImportPreview(preview: StepImportPreview) { issued.delete(preview); }
