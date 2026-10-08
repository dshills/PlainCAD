import { useFittedPart } from "./fittedPartState";
export { useFittedPart } from "./fittedPartState";
import type { CadDocument, FittedPartFeature } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { createId } from "../../cad/document/ids";
import { upsertFeature } from "../../cad/document/CadDocument";
import { featureComponentId } from "../../cad/document/components";
import { positionedDocument, withComponentPlacement, IDENTITY_PLACEMENT } from "../../cad/document/componentPlacement";
import { bindDocumentExpressions } from "../../cad/parameters/expressionBindings";
import { validateDocument } from "../../cad/document/validate";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { interactionDraftBusy } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { currentAiCanvasPreview } from "../../state/aiCanvasPreview";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
export interface FitFrame { document: CadDocument; session: number; activeComponentId: string; componentId: string; featureId: string; sourceBodyId: string; result: RebuildResult; capturedResult?: RebuildResult; feature?: FittedPartFeature }
function idle(state: CadStore, own = false) {
  return !state.fileBusy && !useTargetScopeCapture.getState().busy && !operationDraftBusy() && !interactionDraftBusy(own ? "fit" : undefined) && !useSketchCanvas.getState().active &&
    !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft && !useModelingDraft.getState().draft &&
    !useProjectWorkflow.getState().active && !useGuidedHole.getState().draft && !useFileJobs.getState().exportOpen && !currentAiCanvasPreview(state);
}
export function selectedFit(state = useCadStore.getState()): FittedPartFeature | undefined {
  const selection = state.selection.selectedIds[0], document = state.history.present;
  if (selection?.documentId !== document.id) return;
  return document.features.find((feature): feature is FittedPartFeature => feature.type === "fit" && !feature.suppressed &&
    (selection.kind === "feature" ? feature.id === selection.id : selection.kind === "body" && `body:${feature.id}` === selection.id));
}
export function canBuildFit(state = useCadStore.getState(), edit = false) {
  const document = state.history.present, result = state.rebuild.result;
  if (!idle(state) || !state.rebuild.kernelReady) return false;
  // Broken references remain repairable using another source in a new native preview.
  if (edit) return Boolean(selectedFit(state));
  return state.rebuild.status === "succeeded" && result?.success && result.documentId === document.id &&
    Object.keys(document.components).length < MODEL_RESOURCE_LIMITS.maxComponents && Boolean(result.meshes.length && result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid));
}
export function beginFit(edit = false) {
  const state = useCadStore.getState();
  if (!canBuildFit(state, edit)) throw new Error("Finish other tasks and select a native part, or select a fitted feature to repair it.");
  const feature = edit ? selectedFit(state) : undefined, selection = state.selection.selectedIds[0];
  const result = state.rebuild.result ?? { documentId: state.history.present.id, success: false, meshes: [], errors: [], warnings: [] } as unknown as RebuildResult;
  const sourceBodyId = feature?.sourceBodyId ?? (selection?.kind === "body" && result.meshes.some(mesh => mesh.bodyId === selection.id) ? selection.id : result.meshes[0]?.bodyId ?? "");
  useFittedPart.setState({ frame: { document: state.history.present, session: state.documentSession, activeComponentId: state.activeComponentId,
    componentId: feature ? featureComponentId(state.history.present, feature) : createId("component"), featureId: feature?.id ?? createId("feature"), sourceBodyId, result, capturedResult: state.rebuild.result, feature } });
}
export function currentFit(frame: FitFrame) {
  const state = useCadStore.getState();
  return useFittedPart.getState().frame === frame && state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.activeComponentId && idle(state, true) && state.rebuild.result === frame.capturedResult;
}
export function cancelFit() { useFittedPart.setState({ frame: undefined }); }
export interface FitInput { name: string; sourceBodyId: string; style: FittedPartFeature["style"]; clearance: string; wallThickness: string; follow: boolean }
export function stageFit(frame: FitFrame, input: FitInput) {
  if (!currentFit(frame)) throw new Error("Project changed. Reopen Build a fitted part.");
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Enter a fitted part name of 1–120 characters.");
  let document = frame.document;
  if (!frame.feature) document = { ...document, components: { ...document.components, [frame.componentId]: { id: frame.componentId, name } } };
  else if (frame.feature.followSourcePlacement && !input.follow && frame.result.success) {
    const placement = positionedDocument(document, frame.result).components[frame.componentId].placement ?? IDENTITY_PLACEMENT;
    document = withComponentPlacement(document, frame.componentId, placement);
  }
  if (frame.feature && document.components[frame.componentId].name === frame.feature.name) document = { ...document, components: { ...document.components, [frame.componentId]: { ...document.components[frame.componentId], name } } };
  const expression = (field: "clearance" | "wallThickness") => frame.feature?.[field].expression === input[field].trim() ? frame.feature[field] : { expression: input[field].trim(), unit: "mm", authoredUnit: frame.document.unitSettings.length };
  const feature: FittedPartFeature = { ...frame.feature, id: frame.featureId, componentId: frame.componentId, name, type: "fit", operation: "newBody", sourceBodyId: input.sourceBodyId, style: input.style, clearance: expression("clearance"), wallThickness: expression("wallThickness"), followSourcePlacement: input.follow };
  document = bindDocumentExpressions(upsertFeature(document, feature), frame.document);
  const issues = validateDocument(document);
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(" "));
  return document;
}
export interface FitPreview { frame: FitFrame; input: FitInput; document: CadDocument; result: RebuildResult }
const proven = new WeakSet<FitPreview>();
export async function previewFit(frame: FitFrame, input: FitInput, signal: AbortSignal): Promise<FitPreview> {
  const document = stageFit(frame, input), result = await previewModeling(document, signal);
  if (signal.aborted || !currentFit(frame)) throw new Error("Fitted preview was canceled or became stale.");
  assertNativeSolidPreview(result, document.id);
  if (!result.meshes.some(mesh => mesh.bodyId === `body:${frame.featureId}` && mesh.geometryAssertions?.solidCount === 1)) throw new Error("Fitted part did not produce its own native solid.");
  const preview = { frame, input: { ...input }, document, result }; proven.add(preview); return preview;
}
export function applyFit(preview: FitPreview, input: FitInput) {
  if (!proven.has(preview) || !currentFit(preview.frame) || JSON.stringify(preview.input) !== JSON.stringify(input)) throw new Error("Wait for the latest valid fitted preview before applying.");
  assertNativeSolidPreview(preview.result, preview.document.id);
  useCadStore.getState().updateDocument(current => current === preview.frame.document ? preview.document : current);
  if (useCadStore.getState().history.present === preview.frame.document) throw new Error("Fitted part could not be saved. Review project diagnostics.");
  proven.delete(preview); cancelFit();
  useCadStore.getState().activateComponent(preview.frame.componentId);
  useCadStore.getState().select({ kind: "feature", id: preview.frame.featureId, documentId: preview.document.id });
}
