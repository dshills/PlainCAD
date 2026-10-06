import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { documentAtFeature } from "../../cad/document/featureStage";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { aiFeatureAddContext, type buildAiFeatureAddition } from "../../ai/featureAddPlan";
import type { SketchPlaneChoice } from "../../cad/sketch/planePicking";
import { useCadStore } from "../../state/useCadStore";
import { facePocketFaces } from "./facePocketCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { operationDropTargets, operationDraftBusy } from "./operationDropCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useExtrudeDraft, assertNativeExtrudePreview } from "./extrudeCommand";
import { useHoleDraft, assertNativeHolePreview } from "./holeCommand";
import { useModelingDraft, assertNativeModelingPreview, assertNativeSolidPreview } from "./modelingDraftCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useAiFeatureAddition } from "./aiFeatureAdditionState";
export { useAiFeatureAddition } from "./aiFeatureAdditionState";
export type AiFeatureAdditionPlan = ReturnType<typeof buildAiFeatureAddition>;
export interface AiFeatureAdditionFrame {
  document: CadDocument; result: RebuildResult; session: number; componentId: string;
  choice: SketchPlaneChoice; selection: string;
}
function competing() {
  return Boolean(interactionDraftBusy("featureAddition") || operationDraftBusy() || useSketchCanvas.getState().active || useGuidedHole.getState().draft || useExtrudeDraft.getState().draft || useHoleDraft.getState().draft || useModelingDraft.getState().draft || useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active);
}
export function currentAiFeatureAddition(frame: AiFeatureAdditionFrame) {
  const state = useCadStore.getState();
  return state.history.present === frame.document && state.documentSession === frame.session && state.activeComponentId === frame.componentId && state.rebuild.status === "succeeded" && state.rebuild.result === frame.result &&
    JSON.stringify(state.selection.selectedIds) === frame.selection && !state.fileBusy && !competing() && facePocketFaces(state).some((choice) => choice.id === frame.choice.id);
}
export function captureAiFeatureAddition(faceId: string): AiFeatureAdditionFrame {
  const state = useCadStore.getState(), choice = facePocketFaces(state).find((item) => item.id === faceId);
  if (!choice || competing() || useAiFeatureAddition.getState().frame || !state.rebuild.result) throw new Error("Finish the current task and choose a current supported native face.");
  const frame = { document: state.history.present, result: state.rebuild.result, session: state.documentSession, componentId: state.activeComponentId, choice, selection: JSON.stringify(state.selection.selectedIds) };
  if (!currentAiFeatureAddition(frame)) throw new Error("The selected face changed. Choose it again.");
  return frame;
}
export function featureAdditionContext(frame: AiFeatureAdditionFrame) {
  if (!currentAiFeatureAddition(frame)) throw new Error("The part or target changed. Choose the face again.");
  const edges = operationDropTargets("fillet").filter((target) => target.kind === "edge" && target.bodyId === frame.choice.bodyId).flatMap((target) => target.kind === "edge" ? [{ id: target.id, label: target.label, ownerId: target.ownerId, role: target.role, ...(target.sourceEntityId ? { sourceEntityId: target.sourceEntityId } : {}) }] : []);
  return aiFeatureAddContext(frame.document, frame.componentId, frame.choice, frame.result, edges);
}
const proofs = new WeakMap<RebuildResult, AiFeatureAdditionPlan>();
export async function previewAiFeatureAddition(frame: AiFeatureAdditionFrame, plan: AiFeatureAdditionPlan, signal: AbortSignal) {
  if (!currentAiFeatureAddition(frame) || useAiFeatureAddition.getState().frame !== frame || plan.base !== frame.document || plan.componentId !== frame.componentId || plan.bodyId !== frame.choice.bodyId) throw new Error("The feature proposal belongs to a stale target. Generate it again.");
  let result: RebuildResult | undefined;
  for (const feature of plan.features) {
    if (feature.type === "extrude" && feature.operation !== "cut") throw new Error("AI additions support only inward pocket cuts, holes and cap treatments.");
    // Stage checks catch no-op cuts and edges consumed by preceding additions.
    result = await previewModeling(documentAtFeature(plan.document, feature.id, true), signal);
    if (signal.aborted || !currentAiFeatureAddition(frame) || useAiFeatureAddition.getState().frame !== frame) throw new Error("Feature preview canceled or target changed.");
    if (feature.type === "hole") assertNativeHolePreview(result, plan.document.id, feature);
    else if (feature.type === "extrude") assertNativeExtrudePreview(result, plan.document.id, feature);
    else if (feature.type === "fillet" || feature.type === "chamfer") assertNativeModelingPreview(result, plan.document.id, feature);
    else throw new Error("Unsupported added feature.");
  }
  // Combined validation also covers downstream features beyond the additions.
  result = await previewModeling(plan.document, signal);
  if (signal.aborted || !currentAiFeatureAddition(frame) || useAiFeatureAddition.getState().frame !== frame) throw new Error("Feature preview canceled or target changed.");
  assertNativeSolidPreview(result, plan.document.id);
  const mesh = result.meshes.find((item) => item.bodyId === plan.bodyId);
  if (!mesh || mesh.geometryAssertions?.solidCount !== 1) throw new Error("The feature plan must retain one valid target solid.");
  const before = frame.result.meshes.find((item) => item.bodyId === plan.bodyId)?.geometryAssertions?.volume;
  if (!before || !(mesh.geometryAssertions.volume < before - 1e-7)) throw new Error("The feature plan must measurably change the selected body's native volume.");
  proofs.set(result, plan);
  return { result, volume: mesh.geometryAssertions.volume, before };
}
export function applyAiFeatureAddition(frame: AiFeatureAdditionFrame, plan: AiFeatureAdditionPlan, result: RebuildResult) {
  if (!currentAiFeatureAddition(frame) || useAiFeatureAddition.getState().frame !== frame || plan.base !== frame.document || proofs.get(result) !== plan) throw new Error("The part, task or preview changed. Generate a fresh feature preview.");
  assertNativeSolidPreview(result, plan.document.id);
  try {
    useCadStore.getState().updateDocument((document) => document === frame.document ? plan.document : document);
    if (useCadStore.getState().history.present === frame.document) throw new Error("Feature plan could not be applied. Review project diagnostics.");
  } finally { proofs.delete(result); cancelAiFeatureAddition(); }
}
export function cancelAiFeatureAddition() { useAiFeatureAddition.setState({ frame: undefined }); }
