import { create } from "zustand";
import { createEmptyDocument } from "../../cad/document/CadDocument";
import type { CadDocument } from "../../cad/document/schema";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { downloadProject } from "../../persistence/exportProject";
import { saveRecovery } from "../../persistence/autosave";
import { importProjectFile } from "../../persistence/importProject";
import {
  beginFileJob,
  fileJobCurrent,
  finishFileJob,
  useFileJobs,
} from "../../persistence/fileJobs";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";

interface PendingProjectDrop {
  document: CadDocument;
  previous: CadDocument;
  session: number;
  filename: string;
}
export const useProjectDrop = create<{
  pending?: PendingProjectDrop;
  saving: boolean;
}>(() => ({ saving: false }));

function activeModelingTask() {
  return Boolean(
    useSketchCanvas.getState().active ||
    useExtrudeDraft.getState().draft ||
    useHoleDraft.getState().draft ||
    useModelingDraft.getState().draft ||
    useProjectWorkflow.getState().active,
  );
}
export function projectDropBlockedReason(): string | undefined {
  if (useCadStore.getState().fileBusy)
    return "Wait for the current file operation before opening a dropped project.";
  if (useProjectDrop.getState().pending)
    return "Finish the current project replacement first.";
  if (activeModelingTask())
    return "Finish or cancel the current modeling task before opening a dropped project.";
}

export function isCurrentProjectDrop(
  pending: PendingProjectDrop,
  state: CadStore = useCadStore.getState(),
) {
  return (
    state.history.present === pending.previous &&
    state.documentSession === pending.session &&
    !state.fileBusy &&
    !activeModelingTask()
  );
}

export async function prepareProjectDrop(file: File) {
  const state = useCadStore.getState();
  const blocked = projectDropBlockedReason();
  if (blocked) {
    state.setFileError(blocked);
    return;
  }
  if (!/\.(pcaddoc|json)$/i.test(file.name)) {
    state.setFileError(
      "Drop one .pcaddoc or .json project file. Other file formats cannot be opened.",
    );
    return;
  }
  const previous = state.history.present,
    session = state.documentSession;
  const controller = beginFileJob("Validating dropped project…");
  state.setFileError(undefined);
  try {
    const document = await importProjectFile(
      file,
      controller.signal,
      (message) => {
        if (fileJobCurrent(controller)) useFileJobs.setState({ message });
      },
    );
    if (!fileJobCurrent(controller)) return;
    const current = useCadStore.getState();
    if (
      current.history.present !== previous ||
      current.documentSession !== session ||
      activeModelingTask()
    )
      throw new Error(
        "Project changed while validating the dropped file. Drop it again.",
      );
    // Protect every nonempty project, including unsaved template/recovery documents.
    const comparable = (document: CadDocument) => {
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        rootComponentId: _root,
        components,
        ...data
      } = document;
      return {
        ...data,
        components: Object.values(components).map(
          ({ id: _componentId, ...component }) => component,
        ),
      };
    };
    const hasWork =
      current.history.past.length > 0 ||
      JSON.stringify(comparable(previous)) !==
        JSON.stringify(comparable(createEmptyDocument()));
    if (hasWork)
      useProjectDrop.setState({
        pending: { document, previous, session, filename: file.name },
      });
    else current.setDocument(document);
  } catch (error) {
    if (fileJobCurrent(controller))
      state.setFileError(
        error instanceof Error
          ? error.message
          : "Dropped project could not be opened.",
      );
  } finally {
    finishFileJob(controller);
  }
}

export function cancelProjectDrop() {
  if (useProjectDrop.getState().saving) return;
  useProjectDrop.setState({ pending: undefined });
}

export function replaceWithDroppedProject() {
  const pending = useProjectDrop.getState().pending;
  if (!pending) return;
  if (!isCurrentProjectDrop(pending)) {
    useCadStore
      .getState()
      .setFileError(
        "Project changed after the dropped file was validated. Keep the current project and drop the file again.",
      );
    return;
  }
  useCadStore.getState().setDocument(pending.document);
  useProjectDrop.setState({ pending: undefined });
}

/** A portable-copy download must start successfully before replacement is allowed. */
export async function saveAndReplaceDroppedProject() {
  const pending = useProjectDrop.getState().pending;
  if (!pending || useProjectDrop.getState().saving) return;
  const state = useCadStore.getState();
  if (!isCurrentProjectDrop(pending)) {
    state.setFileError(
      "Project changed after validation. Keep it and drop the file again.",
    );
    return;
  }
  let controller: AbortController | undefined;
  try {
    useProjectDrop.setState({ saving: true });
    controller = beginFileJob("Saving current project before replacement…");
    state.setFileError(undefined);
    await downloadProject(pending.previous);
    await saveRecovery(pending.previous, true);
    if (!fileJobCurrent(controller)) {
      state.setFileError(
        "Saving was interrupted. The current project has not been replaced.",
      );
      return;
    }
    finishFileJob(controller);
    controller = undefined;
    if (
      useProjectDrop.getState().pending !== pending ||
      !isCurrentProjectDrop(pending)
    )
      throw new Error(
        "Project changed while saving. Keep the current project and drop the file again.",
      );
    replaceWithDroppedProject();
  } catch (error) {
    state.setFileError(
      error instanceof Error
        ? error.message
        : "The current project could not be saved. It has not been replaced.",
    );
  } finally {
    if (controller) finishFileJob(controller);
    useProjectDrop.setState({ saving: false });
  }
}
