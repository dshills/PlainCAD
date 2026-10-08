import { useComponentPlacement } from "./componentPlacementState";
import { create } from "zustand";
import { useInspectionState } from "../../state/inspectionState";
import { useSketchProjection } from "./sketchProjectionState";
import { useReusablePart } from "./reusablePartState";
import type { SolidDimensionEditFrame } from "./solidDimensionCommand";
import type { SketchRefinementFrame } from "./sketchRefinementCommand";
import type { ContextualConstraintFrame } from "./contextualConstraintCommand";
import type { SketchTrimExtendFrame } from "./sketchTrimExtendCommand";
import type { FacePocketFrame } from "./facePocketCommand";
import type { FeaturePatternFrame } from "./featurePatternCommand";
import type { CanvasPoint } from "../../cad/sketch/canvasGeometry";
import type { TrimExtendMode } from "../../cad/sketch/trimExtend";
import { useSketchReplication } from "./sketchReplicationState";
import { useAiFeatureAddition } from "./aiFeatureAdditionState";
import { useSketchOffset } from "./sketchOffsetState";

/** Runtime-only edit ownership; leaf stores prevent command-module initialization cycles. */
export const useSolidDimensionEdit = create<{ frame?: SolidDimensionEditFrame }>(() => ({}));
export const useSketchRefinement = create<{ frame?: SketchRefinementFrame }>(() => ({}));
export const useContextualConstraintDraft = create<{ frame?: ContextualConstraintFrame }>(() => ({}));
export const useSketchTrimExtend = create<{ frame?: SketchTrimExtendFrame; mode: TrimExtendMode; pick?: CanvasPoint }>(() => ({ mode: "trim" }));
export const useFacePocket = create<{ frame?: FacePocketFrame }>(() => ({}));
export const useFeaturePattern = create<{ frame?: FeaturePatternFrame }>(() => ({}));

export type InteractionDraftOwner = "solidDimension" | "sketchRefinement" | "constraint" | "trimExtend" | "facePocket" | "replication" | "featureAddition" | "offset" | "reusablePart" | "pattern" | "projection" | "componentPlacement";
/** Each draft can inspect competing owners without counting its own frame. */
export function interactionDraftBusy(owner?: InteractionDraftOwner) {
  return Boolean(
    (owner !== "componentPlacement" && useComponentPlacement.getState().frame) ||
    (owner !== "projection" && useSketchProjection.getState().frame) ||
    (owner !== "pattern" && useFeaturePattern.getState().frame) ||
    useInspectionState.getState().picking ||
    (owner !== "reusablePart" && useReusablePart.getState().frame) ||
    (owner !== "solidDimension" && useSolidDimensionEdit.getState().frame) ||
    (owner !== "sketchRefinement" && useSketchRefinement.getState().frame) ||
    (owner !== "constraint" && useContextualConstraintDraft.getState().frame) ||
    (owner !== "trimExtend" && useSketchTrimExtend.getState().frame) ||
    (owner !== "facePocket" && useFacePocket.getState().frame) ||
    (owner !== "replication" && useSketchReplication.getState().frame) ||
    (owner !== "offset" && useSketchOffset.getState().frame) ||
    (owner !== "featureAddition" && useAiFeatureAddition.getState().frame),
  );
}
