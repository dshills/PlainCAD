import type { CadDocument, SelectionRef } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { SketchPlaneChoice } from "../cad/sketch/planePicking";
import { bodyComponentId, featureComponentId, sketchComponentId } from "../cad/document/components";
import { aiEditContext } from "./editPlan";
import { aiFeatureEditContext } from "./featureEditPlan";
import { aiClarificationTargets } from "./clarificationTargets";
import type { AiEditContext, AiPlan } from "./plan";
import type { AiScope } from "./contextualIntent";

export interface SelectionAiTarget {
  kind: "create" | "body" | "feature" | "face" | "sketch" | "component" | "unsupported";
  label: string;
  scope: AiScope;
  bodyIds: string[];
  featureId?: string;
  sketchId?: string;
  faceId?: string;
  context?: AiEditContext;
  diagnostic?: string;
}

/** Resolve authored/current native identities; never guess a nearby face or body. */
export function selectionAiTarget(document: CadDocument, componentId: string, selections: readonly SelectionRef[], result?: RebuildResult, faces: readonly SketchPlaneChoice[] = [], hiddenBodyIds: readonly string[] = []): SelectionAiTarget {
  const selected = selections[0];
  const nativeBody = (id: string) => {
    if (hiddenBodyIds.includes(id)) return undefined;
    const mesh = result?.success && result.documentId === document.id ? result.meshes.find(item => item.bodyId === id) : undefined;
    const proof = mesh?.geometryAssertions;
    return mesh?.geometrySource === "opencascade" && proof?.valid && Number.isFinite(proof.volume) && proof.volume > 0 &&
      Number.isInteger(proof.solidCount) && proof.solidCount > 0 && bodyComponentId(document, id) === componentId ? mesh : undefined;
  };
  const unsupported = (diagnostic: string): SelectionAiTarget => ({ kind: "unsupported", label: "Choose a target", scope: "edit", bodyIds: [], diagnostic });
  if (!selected) return { kind: "create", label: "New part", scope: "create", bodyIds: [] };
  if (selections.length !== 1 || selected.documentId !== document.id) return unsupported("Choose one current part, feature, face or sketch.");
  if (selected.kind === "sketch" || selected.kind === "sketchEntity") {
    const sketch = selected.kind === "sketch" ? document.sketches[selected.id] : Object.values(document.sketches).find((item) => Object.hasOwn(item.entities, selected.id));
    if (!sketch || sketchComponentId(document, sketch.id) !== componentId) return unsupported("Choose a sketch in the active component.");
    return { kind: "sketch", label: sketch.name, scope: "edit", sketchId: sketch.id, bodyIds: [] };
  }
  if (selected.kind === "face") {
    const face = faces.find((item) => item.id === selected.id);
    if (!face?.bodyId || typeof face.reference === "string" || !nativeBody(face.bodyId)) return unsupported("Choose a current supported planar face. Curved, split or lost faces are unavailable.");
    return { kind: "face", label: face.label, scope: "edit", faceId: face.id, bodyIds: [face.bodyId] };
  }
  try {
    if (selected.kind === "feature") {
      const feature = document.features.find((item) => item.id === selected.id);
      if (!feature || featureComponentId(document, feature) !== componentId) return unsupported("Choose a feature in the active component.");
      const context = aiFeatureEditContext(document, componentId, feature.id);
      const bodyIds = [...new Set(aiClarificationTargets(document, componentId, "feature", context.parameters, result, feature.id).flatMap((item) => item.bodyIds))];
      return { kind: "feature", label: feature.name, scope: "feature", featureId: feature.id, context, bodyIds };
    }
    const context = aiEditContext(document, componentId);
    if (selected.kind === "body") {
      const mesh = nativeBody(selected.id);
      if (!mesh) return unsupported("Rebuild and choose a current native part in the active component.");
      const targets = aiClarificationTargets(document, componentId, "edit", context.parameters, result);
      // A body click must not silently edit another body's shared driver.
      const allowed = new Set(targets.filter((item) => item.bodyIds.length === 1 && item.bodyIds[0] === selected.id).map((item) => item.dimension.id));
      const scoped = { ...context, parameters: context.parameters.filter((item) => allowed.has(item.id)) };
      return { kind: "body", label: result?.bodies.find((item) => item.id === selected.id)?.name ?? "Selected part", scope: "edit", bodyIds: [selected.id], context: scoped,
        ...(!scoped.parameters.length ? { diagnostic: "This part has no independent editable dimensions. Select a feature, or choose a face to add holes or a pocket." } : {}) };
    }
    if (selected.kind === "parameter") {
      const parameter = context.parameters.find((item) => item.id === selected.id);
      if (!parameter) return unsupported("This parameter is shared, locked, derived or outside the active component.");
      const bodyIds = aiClarificationTargets(document, componentId, "edit", [parameter], result).flatMap((item) => item.bodyIds);
      return { kind: "component", label: parameter.name, scope: "edit", context: { ...context, parameters: [parameter] }, bodyIds };
    }
  } catch (error) { return unsupported(error instanceof Error ? error.message : "This selection cannot be edited with AI."); }
  return unsupported("Choose a part or supported feature for dimensions, or a planar face for holes, pockets and edge treatments.");
}

export function assertSelectionAiPlan(target: SelectionAiTarget, plan: AiPlan) {
  if (target.diagnostic) throw new Error(target.diagnostic);
  if (target.kind === "create") return;
  if (target.kind !== "body" && target.kind !== "component" && target.kind !== "feature")
    throw new Error("Use the selected sketch or face workflow, or choose a modeling scope explicitly.");
  const allowed = new Set(target.context?.parameters.map((item) => item.name));
  if (plan.steps.length || plan.parameters.some((item) => !allowed.has(item.name))) throw new Error("The proposal changes dimensions outside the selected target. Choose a broader scope explicitly or revise the request.");
}
