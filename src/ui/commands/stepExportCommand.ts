import { useCadStore, type CadStore } from "../../state/useCadStore";
import { fileJobCurrent, useFileJobs } from "../../persistence/fileJobs";
import { interactionDraftBusy } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { stepExportRuntime, useStepExport, type StepExportFrame } from "./stepExportState";
export { useStepExport } from "./stepExportState";
function nativeCurrent(state: CadStore): boolean {
  const result = state.rebuild.result;
  return state.rebuild.status === "succeeded" && state.rebuild.kernelReady && Boolean(result?.success && result.documentId === state.history.present.id && result.stepExportAvailable && result.meshes.length && result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid && mesh.geometryAssertions.volume > 0 && mesh.geometryAssertions.solidCount > 0));
}
function competingTask() {
  return Boolean(interactionDraftBusy("stepExport") || useSketchCanvas.getState().active || useProjectWorkflow.getState().active || useExtrudeDraft.getState().draft || useHoleDraft.getState().draft || useModelingDraft.getState().draft || useGuidedHole.getState().draft || useTargetScopeCapture.getState().busy || operationDraftBusy() || useFileJobs.getState().exportOpen);
}
export function canOpenStepExport(state = useCadStore.getState()) {
  return !state.fileBusy && !useStepExport.getState().frame && !competingTask() && nativeCurrent(state) && typeof Worker !== "undefined";
}
export function stepExportCurrent(frame: StepExportFrame, state = useCadStore.getState()) {
  return state.history.present === frame.document && state.documentSession === frame.session && state.rebuild.result === frame.result && nativeCurrent(state) && (!state.fileBusy || frame.busy && Boolean(stepExportRuntime.controller && fileJobCurrent(stepExportRuntime.controller))) && !competingTask();
}
export function openStepExport() {
  const state = useCadStore.getState();
  if (!canOpenStepExport(state)) { state.setFileError(state.rebuild.result?.stepExportDiagnostic ?? "STEP export requires current successful native solids and browser worker support. Finish other tasks and rebuild first."); return; }
  useStepExport.setState({ frame: { document: state.history.present, session: state.documentSession, result: state.rebuild.result!, bodyIds: state.rebuild.result!.meshes.map(mesh => mesh.bodyId), busy: false } });
}
export function cancelStepExport() {
  if (stepExportRuntime.controller && fileJobCurrent(stepExportRuntime.controller)) useFileJobs.getState().cancel();
  stepExportRuntime.controller?.abort(); stepExportRuntime.controller = undefined;
  useStepExport.setState({ frame: undefined });
}
export function setStepExportBodies(bodyIds: string[]) {
  const frame = useStepExport.getState().frame;
  if (!frame || frame.busy || !stepExportCurrent(frame)) return;
  useStepExport.setState({ frame: { ...frame, bodyIds, prepared: undefined, error: undefined } });
}
