import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { selectCommandEnablement } from "./commandRegistry";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { useFileJobs } from "../../persistence/fileJobs";

export function useCommandEnablement() {
  const exportDialogOpen = useFileJobs((state) => state.exportOpen);
  const canvasActive = useSketchCanvas((state) => state.active);
  const guidedHoleActive = useGuidedHole((state) => Boolean(state.draft));
  const extrudeActive = useExtrudeDraft((state) => Boolean(state.draft));
  const holeActive = useHoleDraft((state) => Boolean(state.draft));
  const modelingActive = useModelingDraft((state) => Boolean(state.draft));
  const workflowActive = useProjectWorkflow((state) => Boolean(state.active));
  const guidedHoleStartBlocked =
    extrudeActive || holeActive || modelingActive || workflowActive;
  const scopeBusy = useTargetScopeCapture((s) => s.busy);
  return useCadStore(
    useShallow((state) =>
      selectCommandEnablement(
        state,
        scopeBusy,
        Boolean(canvasActive),
        guidedHoleActive,
        guidedHoleStartBlocked,
        exportDialogOpen,
      ),
    ),
  );
}
