import { useComponentPlacement } from "./componentPlacementState";
import { usePartLibrary } from "./partLibraryState";
import { useStepExport } from "./stepExportState";
import { useInspectionState } from "../../state/inspectionState";
import { useSketchProjection } from "./sketchProjectionState";
import { useReusablePart } from "./reusablePartState";
import { useFacePocket } from "./facePocketCommand";
import { useFeaturePattern } from "./interactionDraftState";
import { useSketchReplication } from "./sketchReplicationState";
import { useSketchOffset } from "./sketchOffsetState";
import { useAiFeatureAddition } from "./aiFeatureAdditionState";
import { useSketchTrimExtend } from "./sketchTrimExtendCommand";
import { useContextualConstraintDraft } from "./contextualConstraintCommand";
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
  useComponentPlacement(state => state.frame);
  usePartLibrary(state => state.frame);
  useStepExport(state => state.frame);
  useFeaturePattern((state) => state.frame);
  useInspectionState((state) => state.picking);
  useSketchProjection((state) => state.frame);
  useReusablePart((state) => state.frame);
  useSketchCanvas((state) => state.selection);
  useSketchReplication((state) => state.frame);
  useSketchOffset((state) => state.frame);
  useAiFeatureAddition((state) => state.frame);
  useFacePocket((state) => state.frame);
  useSketchTrimExtend((state) => state.frame);
  useContextualConstraintDraft((state) => state.frame);
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
