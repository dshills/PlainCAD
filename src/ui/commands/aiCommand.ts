import { hiddenViewerBodies, useViewerState } from "../../state/viewerState";
import { interactionDraftBusy } from "./interactionDraftState";
import { create } from "zustand";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import type { CadDocument, SelectionRef } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import {
  assertNativeSolidPreview,
  assertNativeModelingPreview,
  useModelingDraft,
} from "./modelingDraftCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import type { buildAiPlan } from "../../ai/buildPlan";
import type { AiEditableFeature } from "../../ai/featureEditPlan";
import { documentAtFeature } from "../../cad/document/featureStage";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { assertNativeExtrudePreview, useExtrudeDraft } from "./extrudeCommand";
import { assertNativeHolePreview, useHoleDraft } from "./holeCommand";
export type AiStaged = ReturnType<typeof buildAiPlan> & {
  changes?: Array<{ name: string; before: string; after: string }>;
  editedFeature?: AiEditableFeature;
};

export const useAiDrawer = create<{
  open: boolean;
  namedPart?: { name: string; document: CadDocument; session: number };
}>(() => ({ open: false }));
export function beginPartDescription(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120)
    throw new Error("Part name must contain 1–120 characters.");
  const state = useCadStore.getState();
  if (state.fileBusy) return;
  useAiDrawer.setState({
    open: true,
    namedPart: {
      name: trimmed,
      document: state.history.present,
      session: state.documentSession,
    },
  });
}
export const toggleAiDrawer = () =>
  useAiDrawer.setState((state) => ({ open: !state.open, namedPart: undefined }));
export interface AiDraftFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  featureId?: string;
  selection?: readonly SelectionRef[];
  targetBodyIds?: readonly string[];
}
function competingAiTask() {
  return interactionDraftBusy() || useSketchCanvas.getState().active || operationDraftBusy() || useGuidedHole.getState().draft ||
    useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft;
}
export function currentAiFrame(frame: AiDraftFrame) {
  const state = useCadStore.getState();
  return (
    state.history.present === frame.document &&
    state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId &&
    (!frame.selection || (frame.selection.length === state.selection.selectedIds.length && frame.selection.every((item, index) => {
      const current = state.selection.selectedIds[index];
      return current?.id === item.id && current.kind === item.kind && current.documentId === item.documentId;
    }))) &&
    (!frame.targetBodyIds || !hiddenViewerBodies(frame.document, [...frame.targetBodyIds], frame.session, useViewerState.getState()).length) &&
    (!frame.featureId ||
      (state.selection.selectedIds[0]?.kind === "feature" &&
        state.selection.selectedIds[0].id === frame.featureId &&
        state.selection.selectedIds[0].documentId === frame.document.id)) &&
    !state.fileBusy &&
    !competingAiTask()
  );
}
export function assertAiFeatureOperation(
  staged: AiStaged,
  result: RebuildResult,
) {
  const feature = staged.editedFeature;
  if (!feature) return;
  if (feature.type === "hole")
    assertNativeHolePreview(result, staged.document.id, feature);
  else if (feature.type === "extrude")
    assertNativeExtrudePreview(result, staged.document.id, feature);
  else assertNativeModelingPreview(result, staged.document.id, feature);
}
export async function previewAiPlan(staged: AiStaged, signal: AbortSignal) {
  if (competingAiTask())
    throw new Error("Finish the competing task before previewing an AI modeling proposal.");
  let operationResult: RebuildResult | undefined;
  // Fail the edited operation before checking downstream features. The preview
  // client owns one worker at a time and disposes it between these requests.
  if (staged.editedFeature) {
    operationResult = await previewModeling(
      documentAtFeature(staged.document, staged.editedFeature.id, true),
      signal,
    );
    if (signal.aborted) throw new Error("Preview canceled.");
    assertAiFeatureOperation(staged, operationResult);
  }
  const result = await previewModeling(staged.document, signal);
  if (signal.aborted) throw new Error("Preview canceled.");
  if (competingAiTask())
    throw new Error("Another task started. Generate a fresh AI modeling preview.");
  return { result, operationResult };
}
export function assertAiGeometry(staged: AiStaged, result: RebuildResult) {
  assertNativeSolidPreview(result, staged.document.id);
  for (const id of staged.bodyIds)
    if (!result.meshes.some((mesh) => mesh.bodyId === id))
      throw new Error(
        "AI preview did not produce every requested component body.",
      );
  const meshes = result.meshes.filter((mesh) =>
    staged.bodyIds.includes(mesh.bodyId),
  );
  let volume = 0;
  for (const mesh of meshes) {
    const assertions = mesh.geometryAssertions;
    if (
      !assertions?.valid ||
      !Number.isFinite(assertions.volume) ||
      !(assertions.volume > 0)
    )
      throw new Error("AI preview is missing a valid native body volume.");
    volume += assertions.volume;
  }
  if (!Number.isFinite(volume))
    throw new Error("AI component volume exceeds the supported limits.");
  return { meshes, volume };
}
export function applyAiPlan(
  frame: AiDraftFrame,
  staged: AiStaged,
  result: RebuildResult,
  operationResult?: RebuildResult,
) {
  if (!currentAiFrame(frame))
    throw new Error(
      "Project or component changed. Generate a fresh AI preview.",
    );
  assertAiGeometry(staged, result);
  if (staged.editedFeature) {
    if (frame.featureId !== staged.editedFeature.id || !operationResult)
      throw new Error(
        "Wait for the selected feature and downstream native previews.",
      );
    assertAiFeatureOperation(staged, operationResult);
  }
  const state = useCadStore.getState();
  state.updateDocument((document) => {
    if (document !== frame.document)
      throw new Error("Project changed. Generate a fresh AI preview.");
    return staged.document;
  });
  if (useCadStore.getState().history.present === frame.document)
    throw new Error(
      useCadStore.getState().fileError || "AI component could not be applied.",
    );
  state.activateComponent(staged.componentId);
  const featureId = staged.featureIds.at(-1);
  if (featureId)
    state.select({
      kind: "feature",
      id: featureId,
      documentId: staged.document.id,
    });
}
