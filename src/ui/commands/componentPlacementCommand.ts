import type { CadDocument, ComponentPlacement } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { placedProjectionConsumerBodies } from "../../cad/features/placedProjectionDependencies";
import { bodyComponentId } from "../../cad/document/components";
import { IDENTITY_PLACEMENT, validComponentPlacement, withComponentPlacement } from "../../cad/document/componentPlacement";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useComponentPlacement } from "./componentPlacementState";
import { interactionDraftBusy } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { useFileJobs } from "../../persistence/fileJobs";
export { useComponentPlacement } from "./componentPlacementState";
export interface ComponentPlacementFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  result: RebuildResult;
  bodyIds: string[];
  placement: ComponentPlacement;
}
function idle(state: CadStore, own = false) {
  return !state.fileBusy && !useTargetScopeCapture.getState().busy && state.rebuild.kernelReady && !interactionDraftBusy(own ? "componentPlacement" : undefined) &&
    !useSketchCanvas.getState().active && !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft &&
    !useModelingDraft.getState().draft && !useGuidedHole.getState().draft && !operationDraftBusy() &&
    !useProjectWorkflow.getState().active && !useFileJobs.getState().exportOpen;
}
export function canBeginComponentPlacement(state = useCadStore.getState()) {
  const document = state.history.present, result = state.rebuild.result;
  if (!idle(state) || !document.components[state.activeComponentId] || state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== document.id) return false;
  return result.meshes.some((mesh) => bodyComponentId(document, mesh.bodyId) === state.activeComponentId && mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid);
}
export function beginComponentPlacement(componentId = useCadStore.getState().activeComponentId) {
  const state = useCadStore.getState();
  if (componentId !== state.activeComponentId || !canBeginComponentPlacement(state)) throw new Error("Activate a component containing a current native solid and finish other tasks before Move / Rotate.");
  const document = state.history.present, result = state.rebuild.result!;
  assertNativeSolidPreview(result, document.id);
  const placement = document.components[componentId].placement ?? IDENTITY_PLACEMENT;
  useComponentPlacement.setState({ frame: { document, result, session: state.documentSession, componentId,
    bodyIds: result.meshes.filter((mesh) => bodyComponentId(document, mesh.bodyId) === componentId).map((mesh) => mesh.bodyId),
    placement: { translation: [...placement.translation], rotation: [...placement.rotation] },
  } });
}
export function isCurrentComponentPlacement(frame: ComponentPlacementFrame) {
  const state = useCadStore.getState();
  return useComponentPlacement.getState().frame === frame && state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && state.rebuild.status === "succeeded" && state.rebuild.result === frame.result && idle(state, true);
}
export function cancelComponentPlacement() { useComponentPlacement.setState({ frame: undefined }); }
export function stageComponentPlacement(frame: ComponentPlacementFrame, placement: ComponentPlacement) {
  if (!isCurrentComponentPlacement(frame)) throw new Error("Project, component or native result changed. Reopen Move / Rotate.");
  if (!validComponentPlacement(placement)) throw new Error("Enter finite positions within ±100,000,000 mm and rotations within ±360 degrees.");
  return withComponentPlacement(frame.document, frame.componentId, placement);
}
export interface ComponentPlacementPreview { frame: ComponentPlacementFrame; document: CadDocument; result: RebuildResult; placement: ComponentPlacement }
const proven = new WeakSet<ComponentPlacementPreview>();
function assertPlacementGeometry(frame: ComponentPlacementFrame, result: RebuildResult) {
  assertNativeSolidPreview(result, frame.document.id);
  const consumers = placedProjectionConsumerBodies(frame.document, frame.componentId);
  if (result.meshes.length !== frame.result.meshes.length || frame.result.meshes.some((before) => {
    const after = result.meshes.find((mesh) => mesh.bodyId === before.bodyId), a = after?.geometryAssertions, b = before.geometryAssertions;
    return !a || !b || !Number.isFinite(a.volume) || !Number.isFinite(b.volume) || a.solidCount !== b.solidCount || (!consumers.has(before.bodyId) && Math.abs(a.volume - b.volume) > Math.max(1e-8, Math.abs(b.volume) * 1e-9));
  })) throw new Error("Placement changed body identity, solid count or an independent solid volume. Review native diagnostics before applying.");
}
export async function previewComponentPlacement(frame: ComponentPlacementFrame, placement: ComponentPlacement, signal: AbortSignal): Promise<ComponentPlacementPreview> {
  const document = stageComponentPlacement(frame, placement);
  const capture: ComponentPlacement = { translation: [...placement.translation], rotation: [...placement.rotation] };
  const result = await previewModeling(document, signal);
  if (signal.aborted || !isCurrentComponentPlacement(frame)) throw new Error("Move / Rotate preview was canceled or became stale.");
  assertPlacementGeometry(frame, result);
  const preview = { frame, document, result, placement: capture };
  proven.add(preview); return preview;
}
export function applyComponentPlacement(preview: ComponentPlacementPreview, placement: ComponentPlacement) {
  if (!proven.has(preview) || !isCurrentComponentPlacement(preview.frame) || JSON.stringify(preview.placement) !== JSON.stringify(placement)) throw new Error("Wait for the latest valid native placement preview before Apply.");
  assertPlacementGeometry(preview.frame, preview.result);
  if (preview.document === preview.frame.document) { proven.delete(preview); cancelComponentPlacement(); return; }
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!isCurrentComponentPlacement(preview.frame)) throw new Error("Project or component changed while applying. Preview a current placement again.");
  useCadStore.getState().updateDocument((current) => current === preview.frame.document ? preview.document : current);
  if (useCadStore.getState().history.present === preview.frame.document) throw new Error("Component placement could not be saved. Review project diagnostics.");
  proven.delete(preview); cancelComponentPlacement();
}
