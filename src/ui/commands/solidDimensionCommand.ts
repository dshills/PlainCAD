import { useSolidDimensionEdit } from "./interactionDraftState";
export { useSolidDimensionEdit } from "./interactionDraftState";
import { useViewerState } from "../../state/viewerState";
import type { SolidDimension } from "../../cad/inspection/solidDimensions";
import { solidDimensions } from "../../cad/inspection/solidDimensions";
import { buildSolidDimensionEdit, type SolidDimensionField, type SolidDimensionTarget } from "../../cad/inspection/solidDimensionEdit";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { documentAtFeature } from "../../cad/document/featureStage";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { assertNativeSolidPreview, assertNativeModelingPreview, useModelingDraft } from "./modelingDraftCommand";
import { assertNativeExtrudePreview, useExtrudeDraft } from "./extrudeCommand";
import { assertNativeHolePreview, useHoleDraft } from "./holeCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useFileJobs } from "../../persistence/fileJobs";

export interface SolidDimensionEditFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  result: RebuildResult;
  dimension: SolidDimension;
  field: SolidDimensionField;
}
export function solidDimensionEditingAvailable(state: CadStore = useCadStore.getState()) {
  return !state.fileBusy && state.rebuild.kernelReady && state.rebuild.status === "succeeded" &&
    !useSolidDimensionEdit.getState().frame && !useSketchCanvas.getState().active &&
    !operationDraftBusy() && !useGuidedHole.getState().draft && !useExtrudeDraft.getState().draft &&
    !useHoleDraft.getState().draft && !useModelingDraft.getState().draft && !useProjectWorkflow.getState().active && !useFileJobs.getState().exportOpen;
}
export function beginSolidDimensionEdit(dimension: SolidDimension | undefined) {
  const state = useCadStore.getState();
  if (!dimension || !solidDimensionEditingAvailable(state) || !state.rebuild.result) throw new Error("Finish the current task and wait for a successful native rebuild.");
  const available = solidDimensions(state.history.present, state.rebuild.result,
    { kind: "feature", id: dimension.featureId, documentId: state.history.present.id }, state.activeComponentId, useViewerState.getState().hiddenBodyIds);
  const current = available.find((item) => item.id === dimension.id && item.expression === dimension.expression);
  if (!current) throw new Error("Dimension is no longer available on current native geometry.");
  useSolidDimensionEdit.setState({ frame: { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, result: state.rebuild.result, dimension: current, field: current.field } });
}
export function currentSolidDimensionFrame(frame: SolidDimensionEditFrame) {
  const state = useCadStore.getState();
  return useSolidDimensionEdit.getState().frame === frame && state.history.present === frame.document &&
    state.documentSession === frame.session && state.activeComponentId === frame.componentId && !state.fileBusy &&
    state.rebuild.status === "succeeded" && state.rebuild.result === frame.result &&
    !useSketchCanvas.getState().active && !operationDraftBusy() &&
    !useGuidedHole.getState().draft && !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft && !useModelingDraft.getState().draft;
}
export function cancelSolidDimensionEdit() { useSolidDimensionEdit.setState({ frame: undefined }); }
export interface SolidDimensionPreview { document: CadDocument; result: RebuildResult; frame: SolidDimensionEditFrame; target: SolidDimensionTarget; expression: string }
const issuedPreviews = new WeakSet<SolidDimensionPreview>();
export async function previewSolidDimensionEdit(frame: SolidDimensionEditFrame, target: SolidDimensionTarget, expression: string, signal: AbortSignal): Promise<SolidDimensionPreview> {
  if (!currentSolidDimensionFrame(frame)) throw new Error("Project changed. Reopen the driving dimension.");
  const document = buildSolidDimensionEdit(frame.document, frame.dimension.featureId, frame.field, target, expression);
  const feature = document.features.find((item) => item.id === frame.dimension.featureId)!;
  const operation = await previewModeling(documentAtFeature(document, feature.id, true), signal);
  if (feature.type === "extrude") assertNativeExtrudePreview(operation, document.id, feature);
  else if (feature.type === "hole") assertNativeHolePreview(operation, document.id, feature);
  else assertNativeModelingPreview(operation, document.id, feature);
  const result = await previewModeling(document, signal);
  assertNativeSolidPreview(result, document.id);
  if (signal.aborted || !currentSolidDimensionFrame(frame)) throw new Error("Preview became stale. Reopen the driving dimension.");
  const preview = { document, result, frame, target, expression };
  issuedPreviews.add(preview);
  return preview;
}
export function applySolidDimensionEdit(preview: SolidDimensionPreview) {
  if (!issuedPreviews.has(preview)) throw new Error("Dimension preview was not issued by the native worker. Preview this dimension again.");
  if (!currentSolidDimensionFrame(preview.frame)) throw new Error("Project changed. Preview this dimension again.");
  assertNativeSolidPreview(preview.result, preview.document.id);
  useCadStore.getState().updateDocument((document) => document === preview.frame.document ? preview.document : document);
  if (useCadStore.getState().history.present === preview.frame.document) throw new Error("Dimension could not be saved. Review the project diagnostics.");
  issuedPreviews.delete(preview);
  cancelSolidDimensionEdit();
}
