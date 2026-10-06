import { useSolidDimensionEdit } from "./solidDimensionCommand";
import { useSketchSolidHandoff } from "./sketchSolidHandoffCommand";
import { useSketchRefinement } from "./sketchRefinementCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useOperationDrop } from "./operationDropCommand";
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

export function useCommandEnablement() {
  // These transient stores trigger recomputation; the selector reads their current snapshots.
  useSketchSolidHandoff((state) => state.selectedTargetId);
  useSketchSolidHandoff((state) => state.source);
  useSketchRefinement((state) => state.frame);
  useSolidDimensionEdit((state) => state.frame);
  const fileDialogOpen = useFileJobs((state) => state.exportOpen);
  const operationFrame = useOperationDrop((state) => state.frame);
  const canvasActive = useSketchCanvas((state) => state.active);
  const guidedHoleActive = useGuidedHole((state) => Boolean(state.draft));
  const extrudeDraft = useExtrudeDraft((state) => state.draft);
  const extrudeActive = Boolean(extrudeDraft);
  const holeActive = useHoleDraft((state) => Boolean(state.draft));
  const modelingDraft = useModelingDraft((state) => state.draft);
  const modelingActive = Boolean(modelingDraft);
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
        fileDialogOpen,
        Boolean(
          operationFrame ||
          extrudeDraft?.targetSnapshot ||
          modelingDraft?.targetSnapshot,
        ),
        Boolean(operationFrame),
      ),
    ),
  );
}
