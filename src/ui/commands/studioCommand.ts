import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useViewerState, STUDIO_BACKDROP_IDS, STUDIO_MATERIAL_IDS, type StudioBackdrop, type StudioMaterial } from "../../state/viewerState";
import { STANDARD_VIEWS, type StandardView } from "../../cad/inspection/cameraViews";
import { runCommand } from "./commandRegistry";
import { captureCamera, restoreCamera } from "../../viewer/cameraController";

export interface StudioCommandContext {
  session: number;
  documentId: string;
  material?: StudioMaterial;
  backdrop?: StudioBackdrop;
  composition?: StandardView;
}

/** The registry loads this module lazily; a late import cannot style a new file. */
export async function setStudioAppearance(input: StudioCommandContext | undefined, captured: CadStore): Promise<boolean> {
  if (!input) return false;
  const state = useCadStore.getState(), view = useViewerState.getState();
  if (state.history.present !== captured.history.present || state.documentSession !== captured.documentSession ||
      state.rebuild.result !== captured.rebuild.result || state.fileBusy || input.session !== state.documentSession ||
      input.documentId !== state.history.present.id || view.session !== input.session || view.presentationMode !== "render") return false;
  if (input.material !== undefined && !STUDIO_MATERIAL_IDS.includes(input.material)) return false;
  if (input.backdrop !== undefined && !STUDIO_BACKDROP_IDS.includes(input.backdrop)) return false;
  if (input.composition !== undefined && !STANDARD_VIEWS.includes(input.composition)) return false;
  let previousCamera: ReturnType<typeof captureCamera>;
  const rollbackCamera = () => {
    const current = useCadStore.getState();
    if (previousCamera && current.history.present === state.history.present && current.documentSession === input.session) {
      try { restoreCamera(previousCamera); } catch { /* The unavailable camera is diagnosed below. */ }
    }
  };
  if (input.composition !== undefined) {
    // Reuse the workbench's standard orientation and fitting commands so CAD
    // coordinates and current visible bounds remain consistent everywhere.
    try {
      previousCamera = captureCamera();
      if (!previousCamera) throw new Error("Camera is unavailable.");
      await runCommand(`view.${input.composition}`);
      const after = useCadStore.getState(), nextView = useViewerState.getState();
      if (after.history.present !== state.history.present || after.documentSession !== input.session ||
          after.rebuild.result !== state.rebuild.result || after.fileBusy || nextView.session !== input.session || nextView.presentationMode !== "render") {
        rollbackCamera();
        return false;
      }
      await runCommand("view.fit");
      const fitted = useCadStore.getState(), fittedView = useViewerState.getState();
      if (fitted.history.present !== state.history.present || fitted.documentSession !== input.session ||
          fitted.rebuild.result !== state.rebuild.result || fitted.fileBusy || fittedView.session !== input.session ||
          fittedView.presentationMode !== "render") {
        rollbackCamera();
        return false;
      }
    } catch {
      rollbackCamera();
      const after = useCadStore.getState();
      if (after.history.present === state.history.present && after.documentSession === input.session)
        after.setFileError("Studio camera could not be composed. Try fitting the model or choose another view.");
      return false;
    }
  }
  view.setStudioAppearance(input.session, { material: input.material, backdrop: input.backdrop });
  return true;
}
