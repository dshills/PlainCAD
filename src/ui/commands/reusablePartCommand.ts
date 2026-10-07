import type { CadStore } from "../../state/useCadStore";
import { useCadStore } from "../../state/useCadStore";
import { importProjectFile } from "../../persistence/importProject";
import { appendProject, type AppendProjectOptions } from "../../persistence/appendProject";
import { beginFileJob, fileJobCurrent, finishFileJob, useFileJobs } from "../../persistence/fileJobs";
import { useReusablePart, type ReusablePartFrame } from "./reusablePartState";
import { operationDraftBusy } from "./operationDropCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useProjectDrop } from "./projectDropCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
export { useReusablePart } from "./reusablePartState";
function competingTask() {
  return Boolean(useExtrudeDraft.getState().draft || useHoleDraft.getState().draft || useModelingDraft.getState().draft || useGuidedHole.getState().draft || useTargetScopeCapture.getState().busy || operationDraftBusy() || interactionDraftBusy("reusablePart") || useSketchCanvas.getState().active || useProjectWorkflow.getState().active || useProjectDrop.getState().pending || useFileJobs.getState().exportOpen);
}
export function canInsertProject(state: CadStore) {
  return !state.fileBusy && !competingTask() && !useReusablePart.getState().frame;
}
export function reusablePartCurrent(frame: ReusablePartFrame, state = useCadStore.getState()) {
  return state.history.present === frame.document && state.documentSession === frame.session && !competingTask();
}
export function beginInsertProject() {
  const state = useCadStore.getState();
  if (!canInsertProject(state))
    return;
  useReusablePart.setState({ frame: { document: state.history.present, session: state.documentSession, reading: false } });
}
export function cancelInsertProject() {
  if (useReusablePart.getState().frame?.reading)
    useFileJobs.getState().cancel();
  useReusablePart.setState({ frame: undefined });
}
export async function readReusableProject(file: File) {
  const initial = useReusablePart.getState().frame;
  if (!initial || !reusablePartCurrent(initial) || initial.reading)
    return;
  const frame = { ...initial, source: undefined, filename: file.name, reading: true, error: undefined };
  useReusablePart.setState({ frame });
  const controller = beginFileJob("Validating reusable project…");
  try {
    const source = await importProjectFile(file, controller.signal, (message) => {
      if (fileJobCurrent(controller))
        useFileJobs.setState({ message });
    });
    if (!fileJobCurrent(controller) || useReusablePart.getState().frame !== frame)
      return;
    if (!reusablePartCurrent(frame))
      throw new Error("Project changed during validation. Select the source file again.");
    useReusablePart.setState({ frame: { ...frame, source, reading: false } });
  }
  catch (error) {
    if (fileJobCurrent(controller) && useReusablePart.getState().frame === frame)
      useReusablePart.setState({ frame: { ...frame, reading: false, error: error instanceof Error ? error.message : "Source project could not be read." } });
  }
  finally {
    finishFileJob(controller);
    if (useReusablePart.getState().frame === frame)
      useReusablePart.setState({ frame: { ...frame, reading: false, error: "Source validation was cancelled. Select the file again." } });
  }
}
export function applyInsertProject(options: AppendProjectOptions) {
  const frame = useReusablePart.getState().frame, state = useCadStore.getState();
  if (!frame?.source || frame.reading || state.fileBusy)
    return;
  try {
    if (!reusablePartCurrent(frame))
      throw new Error("Project changed after validation. Cancel insertion and reopen the source file.");
    const appended = appendProject(frame.document, frame.source, options);
    const componentId = appended.componentIds[0];
    if (!componentId || !Object.hasOwn(appended.document.components, componentId))
      throw new Error("The selected source scope contains no component to activate.");
    state.updateDocument((current) => {
      if (current !== frame.document)
        throw new Error("Project changed before insertion.");
      return appended.document;
    });
    if (useCadStore.getState().history.present === frame.document)
      throw new Error(useCadStore.getState().fileError ?? "Insertion could not be applied.");
    state.activateComponent(componentId);
    useReusablePart.setState({ frame: undefined });
  }
  catch (error) {
    useReusablePart.setState({ frame: { ...frame, error: error instanceof Error ? error.message : "Insertion failed." } });
  }
}
