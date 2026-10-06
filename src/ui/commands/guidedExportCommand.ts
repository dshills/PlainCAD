import { operationDraftBusy } from "./operationDropCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import { createId } from "../../cad/document/ids";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { openFabrication, useFileJobs } from "../../persistence/fileJobs";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";

export interface GuidedExportTask {
  id: string;
  document: CadDocument;
  session: number;
}
export const useGuidedExport = create<{ task?: GuidedExportTask }>(() => ({}));
export function saveOrExportBlocked(
  canvasActive: boolean,
  guidedHoleActive: boolean,
  modelingTaskActive: boolean,
  dialogOpen: boolean,
  scopeCaptureBusy: boolean,
) {
  return (
    canvasActive ||
    guidedHoleActive ||
    modelingTaskActive ||
    dialogOpen ||
    scopeCaptureBusy
  );
}
function currentSaveOrExportBlocked() {
  return saveOrExportBlocked(
    Boolean(useSketchCanvas.getState().active),
    Boolean(useGuidedHole.getState().draft),
    Boolean(
      useProjectWorkflow.getState().active ||
      useExtrudeDraft.getState().draft ||
      useHoleDraft.getState().draft ||
      useModelingDraft.getState().draft || operationDraftBusy(),
    ),
    useFileJobs.getState().exportOpen,
    useTargetScopeCapture.getState().busy,
  );
}

export function canBeginSaveOrExport(
  state: CadStore = useCadStore.getState(),
  blocked = currentSaveOrExportBlocked(),
) {
  return !state.fileBusy && !blocked;
}
export function beginSaveOrExport() {
  const state = useCadStore.getState();
  if (!canBeginSaveOrExport(state)) return;
  openFabrication();
  if (!useFileJobs.getState().exportOpen) return;
  state.setFileError(undefined);
  useGuidedExport.setState({
    task: {
      id: createId("export"),
      document: state.history.present,
      session: state.documentSession,
    },
  });
}
export function guidedExportCurrent(
  task: GuidedExportTask,
  state: CadStore = useCadStore.getState(),
) {
  return (
    useGuidedExport.getState().task === task &&
    state.history.present === task.document &&
    state.documentSession === task.session
  );
}
// Quick STL warnings and the guided entry share the existing file-job dialog.
// Clearing its open flag ends the transient guided task too.
const unsubscribeFileDialog = useFileJobs.subscribe((state, previous) => {
  if (previous.exportOpen && !state.exportOpen)
    useGuidedExport.setState({ task: undefined });
});

if (import.meta.hot) import.meta.hot.dispose(unsubscribeFileDialog);
