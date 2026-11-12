import { currentAiCanvasPreview } from "../../state/aiCanvasPreview";
import { useAiFacePicking } from "../../state/aiFacePicking";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useFileJobs } from "../../persistence/fileJobs";
import { useExtrudeDraft } from "./extrudeCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useHoleDraft } from "./holeCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { useModelingDraft } from "./modelingDraftCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";

/** Keep the selection that triggered a lazy-loaded tool. */
export async function openShell(edit = false) {
  const before = useCadStore.getState();
  const { beginShell } = await import("./shellCommand");
  const after = useCadStore.getState();
  if (before.history.present !== after.history.present || before.documentSession !== after.documentSession ||
      before.selection !== after.selection || before.activeComponentId !== after.activeComponentId ||
      before.rebuild.result !== after.rebuild.result)
    throw new Error("The project or selection changed. Reopen Shell.");
  beginShell(edit);
}

export function shellTaskBusy(state: CadStore, own = false) {
  return Boolean(state.fileBusy || interactionDraftBusy(own ? "shell" : undefined) || operationDraftBusy() ||
    useTargetScopeCapture.getState().busy || useSketchCanvas.getState().active || useProjectWorkflow.getState().active ||
    useGuidedHole.getState().draft || useExtrudeDraft.getState().draft || useHoleDraft.getState().draft ||
    useModelingDraft.getState().draft || useFileJobs.getState().exportOpen || useAiFacePicking.getState().frame ||
    currentAiCanvasPreview(state));
}
