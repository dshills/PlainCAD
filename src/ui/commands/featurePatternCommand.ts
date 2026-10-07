import type { CadDocument, ExpressionRef, FeaturePatternFeature, FeaturePatternSettings } from "../../cad/document/schema";
import type { CadStore } from "../../state/useCadStore";
import { useCadStore } from "../../state/useCadStore";
import { interactionDraftBusy, useFeaturePattern } from "./interactionDraftState";
export { useFeaturePattern } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft, assertNativeSolidPreview } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { createId } from "../../cad/document/ids";
import { upsertFeature } from "../../cad/document/CadDocument";
import { targetBodyIds } from "../../cad/document/bodyScopes";
import { featureComponentId } from "../../cad/document/components";
import { documentAtFeature } from "../../cad/document/featureStage";
import { isPatternSource, patternSource, featurePatternTransforms } from "../../cad/features/featurePattern";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { sketchPlaneTransform } from "../../cad/sketch/planes";
import { validateDocument } from "../../cad/document/validate";
import { bindDocumentExpressions } from "../../cad/parameters/expressionBindings";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import type { RebuildResult } from "../../cad/worker/workerProtocol";

export interface FeaturePatternFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  featureId: string;
  sourceFeatureId: string;
  feature?: FeaturePatternFeature;
}
function idle(state: CadStore, own = false) {
  return !state.fileBusy && !useTargetScopeCapture.getState().busy && state.rebuild.kernelReady && !interactionDraftBusy(own ? "pattern" : undefined) &&
    !useSketchCanvas.getState().active && !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft &&
    !useModelingDraft.getState().draft && !useGuidedHole.getState().draft && !operationDraftBusy() &&
    !useProjectWorkflow.getState().active && !useFileJobs.getState().exportOpen;
}
export function selectedPattern(state: CadStore) {
  const selection = state.selection.selectedIds[0], document = state.history.present;
  if (!idle(state) || selection?.documentId !== document.id || selection.kind !== "feature") return;
  const feature = document.features.find(item => item.id === selection.id);
  return feature?.type === "pattern" && !feature.suppressed && featureComponentId(document, feature) === state.activeComponentId ? feature : undefined;
}
export function selectedPatternSource(state: CadStore) {
  const selection = state.selection.selectedIds[0], document = state.history.present, result = state.rebuild.result;
  if (!idle(state) || state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== document.id ||
    selection?.kind !== "feature" || selection.documentId !== document.id) return;
  const source = document.features.find(item => item.id === selection.id);
  if (!isPatternSource(source) || featureComponentId(document, source) !== state.activeComponentId || !targetBodyIds(source).length) return;
  if (targetBodyIds(source).some(id => !result.meshes.some(mesh => mesh.bodyId === id && mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid))) return;
  return source;
}
export function beginFeaturePattern() {
  const state = useCadStore.getState(), source = selectedPatternSource(state);
  if (!source) throw new Error("Select a single-center Hole or distance Cut Extrude after a successful native rebuild.");
  useFeaturePattern.setState({ frame: { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, featureId: createId("feature"), sourceFeatureId: source.id } });
}
export function beginFeaturePatternEditing() {
  const state = useCadStore.getState(), feature = selectedPattern(state);
  if (!feature) throw new Error("Select a current pattern to edit.");
  useFeaturePattern.setState({ frame: { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, featureId: feature.id, sourceFeatureId: feature.sourceFeatureId, feature } });
}
export function currentPatternFrame(frame: FeaturePatternFrame) {
  const state = useCadStore.getState();
  return useFeaturePattern.getState().frame === frame && state.history.present === frame.document &&
    state.documentSession === frame.session && state.activeComponentId === frame.componentId && idle(state, true);
}
export function cancelFeaturePattern() { useFeaturePattern.setState({ frame: undefined }); }
export interface FeaturePatternInput {
  name: string; sourceFeatureId: string; type: "linear" | "circular";
  count: string; spacing: string; direction: "X" | "Y"; angle: string; centerX: string; centerY: string;
}
export function stageFeaturePattern(frame: FeaturePatternFrame, input: FeaturePatternInput) {
  if (!currentPatternFrame(frame)) throw new Error("Project or component changed. Reopen Pattern.");
  const context = frame.feature ? documentAtFeature(frame.document, frame.feature.id) : frame.document,
    source = patternSource(context, input.sourceFeatureId);
  if (featureComponentId(context, source) !== frame.componentId) throw new Error("Pattern source must belong to the active component.");
  const old = frame.feature?.pattern;
  const ref = (field: "count" | "spacing" | "angle" | "centerX" | "centerY", unit: string, authoredUnit: string): ExpressionRef => {
    const retained = old && field in old ? (old as unknown as Record<string, ExpressionRef>)[field] : undefined;
    return retained?.expression.trim() === input[field].trim() ? retained : { expression: input[field].trim(), unit, authoredUnit };
  };
  const count = ref("count", "", ""), units = frame.document.unitSettings;
  const pattern: FeaturePatternSettings = input.type === "linear"
    ? { type: "linear", count, spacing: ref("spacing", "mm", units.length), direction: input.direction }
    : { type: "circular", count, angle: ref("angle", "deg", units.angle), centerX: ref("centerX", "mm", units.length), centerY: ref("centerY", "mm", units.length) };
  // Numeric/unit/count bounds do not require native geometry; the worker resolves the actual source plane.
  featurePatternTransforms(pattern, sketchPlaneTransform("XY"), evaluateParameters(context.parameters).values);
  const feature: FeaturePatternFeature = { ...frame.feature, id: frame.featureId, name: input.name.trim() || "Feature pattern", componentId: frame.componentId, type: "pattern", sourceFeatureId: source.id, targetBodyIds: [...targetBodyIds(source)], pattern };
  const document = bindDocumentExpressions(upsertFeature(frame.document, feature), frame.document), invalid = validateDocument(document);
  if (invalid.length) throw new Error(invalid.map(issue => issue.message).join(" "));
  return { document, feature: document.features.find(item => item.id === feature.id) as FeaturePatternFeature };
}
export interface FeaturePatternPreview { frame: FeaturePatternFrame; input: FeaturePatternInput; document: CadDocument; result: RebuildResult; operation: RebuildResult; feature: FeaturePatternFeature }
const previews = new WeakSet<FeaturePatternPreview>();
export async function previewFeaturePattern(frame: FeaturePatternFrame, input: FeaturePatternInput, signal: AbortSignal): Promise<FeaturePatternPreview> {
  const staged = stageFeaturePattern(frame, input), prefix = documentAtFeature(staged.document, frame.featureId, true);
  const operation = await previewModeling(prefix, signal);
  assertNativeSolidPreview(operation, staged.document.id);
  if (staged.feature.targetBodyIds.some(id => !operation.meshes.some(mesh => mesh.bodyId === id && mesh.kernelOperation === "cut")))
    throw new Error("Pattern did not cut every target body.");
  const result = frame.feature ? await previewModeling(staged.document, signal) : operation;
  assertNativeSolidPreview(result, staged.document.id);
  if (signal.aborted || !currentPatternFrame(frame)) throw new Error("Pattern preview became stale. Reopen Pattern.");
  const preview = { ...staged, frame, input: { ...input }, result, operation };
  previews.add(preview);
  return preview;
}
export function applyFeaturePattern(preview: FeaturePatternPreview, input: FeaturePatternInput) {
  if (!previews.has(preview) || !currentPatternFrame(preview.frame) || JSON.stringify(preview.input) !== JSON.stringify(input))
    throw new Error("Wait for the latest valid native Pattern preview before Apply.");
  assertNativeSolidPreview(preview.result, preview.document.id);
  useCadStore.getState().updateDocument(document => document === preview.frame.document ? preview.document : document);
  if (useCadStore.getState().history.present === preview.frame.document) throw new Error("Pattern could not be saved. Review project diagnostics.");
  previews.delete(preview);
  useCadStore.getState().select({ kind: "feature", id: preview.feature.id, documentId: preview.document.id });
  cancelFeaturePattern();
}
