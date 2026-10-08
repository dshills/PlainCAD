import { useCadStore, type CadStore } from "../../state/useCadStore";
import { interactionDraftBusy, type InteractionDraftOwner } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { currentAiCanvasPreview } from "../../state/aiCanvasPreview";
/** Availability shared by explicit native comparison and drawing tasks. */
export function nativeTaskReady(state: CadStore = useCadStore.getState(), owner?: InteractionDraftOwner) {
  return Boolean(!state.fileBusy && state.rebuild.kernelReady && state.rebuild.status === "succeeded" && state.rebuild.result?.success && state.rebuild.result.documentId === state.history.present.id && state.rebuild.result.meshes.length && state.rebuild.result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid) && !interactionDraftBusy(owner) && !useSketchCanvas.getState().active && !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft && !useModelingDraft.getState().draft && !useGuidedHole.getState().draft && !useProjectWorkflow.getState().active && !operationDraftBusy() && !useTargetScopeCapture.getState().busy && !useFileJobs.getState().exportOpen && !currentAiCanvasPreview(state));
}
