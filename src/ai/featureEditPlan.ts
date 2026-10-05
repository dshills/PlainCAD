import type {
  CadDocument,
  ExpressionRef,
  ExtrudeFeature,
  RevolveFeature,
  HoleFeature,
} from "../cad/document/schema";
import { featureComponentId } from "../cad/document/components";
import { upsertFeature } from "../cad/document/CadDocument";
import {
  evaluateExpressionRef,
  evaluateParameters,
} from "../cad/parameters/expressionEvaluator";
import { bindDocumentExpressions } from "../cad/parameters/expressionBindings";
import { validateDocument } from "../cad/document/validate";
import {
  validateAiPlan,
  validateAiEditContext,
  type AiEditContext,
} from "./plan";
import { aiComponentOutputs } from "./editPlan";

export type AiEditableFeature = ExtrudeFeature | RevolveFeature | HoleFeature;
function featureFields(
  document: CadDocument,
  componentId: string,
  featureId: string,
) {
  const feature = document.features.find((f) => f.id === featureId);
  if (
    !feature ||
    feature.suppressed ||
    featureComponentId(document, feature) !== componentId ||
    (feature.type !== "hole" &&
      feature.type !== "extrude" &&
      feature.type !== "revolve")
  )
    throw new Error(
      "Select an unsuppressed Hole, distance Extrude, or Revolve in the active component.",
    );
  const fields: Record<string, ExpressionRef> = {};
  if (feature.type === "extrude") {
    if (feature.termination && feature.termination.type !== "distance")
      throw new Error(
        "AI feature editing supports distance extrusions; use Edit Feature for other terminations.",
      );
    fields.distance = feature.termination?.distance ?? feature.distance;
  } else if (feature.type === "revolve") fields.angle = feature.angle;
  else {
    fields.diameter = feature.diameter;
    if (feature.depth !== "throughAll") fields.depth = feature.depth;
  }
  return { feature, fields };
}
export function aiFeatureEditContext(
  base: CadDocument,
  componentId: string,
  featureId: string,
): AiEditContext {
  const document = bindDocumentExpressions(base),
    { feature, fields } = featureFields(document, componentId, featureId);
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length)
    throw new Error("Repair project parameters before AI editing.");
  return validateAiEditContext({
    componentName: document.components[componentId]?.name ?? "Component",
    feature: { type: feature.type, name: feature.name },
    parameters: Object.entries(fields).map(([name, ref]) => {
      const evaluated = evaluateExpressionRef(ref, {
        parameters: evaluation.values,
      });
      const dimension = name === "angle" ? "angle" : "length";
      if (
        evaluated.error ||
        evaluated.quantity?.dimension !== dimension ||
        !Number.isFinite(evaluated.quantity.value)
      )
        throw new Error(`Repair ${feature.name} ${name} before AI editing.`);
      return {
        id: `${feature.id}:${name}`,
        name,
        expression: ref.expression,
        value:
          dimension === "angle"
            ? (evaluated.quantity.value * 180) / Math.PI
            : evaluated.quantity.value,
        unit: dimension === "angle" ? "deg" : "mm",
      };
    }),
  });
}
export function buildAiFeatureEdit(
  base: CadDocument,
  componentId: string,
  featureId: string,
  input: unknown,
) {
  const plan = validateAiPlan(input),
    context = aiFeatureEditContext(base, componentId, featureId);
  const { feature, fields } = featureFields(base, componentId, featureId);
  if (plan.steps.length)
    throw new Error(
      "Selected-feature editing accepts dimension changes only; sketch, axis and target references are preserved.",
    );
  const changes: Array<{ name: string; before: string; after: string }> = [];
  const refs = { ...fields };
  for (const p of plan.parameters) {
    const allowed = context.parameters.find((field) => field.name === p.name);
    if (!allowed || p.unit !== allowed.unit)
      throw new Error(`AI cannot edit selected-feature field ${p.name}.`);
    if (p.value <= 0 || (p.name === "angle" && p.value > 360))
      throw new Error(
        `Feature ${p.name} must be positive${p.name === "angle" ? " and at most 360deg" : ""}.`,
      );
    if (
      Math.abs(p.value - allowed.value) <=
      1e-10 * Math.max(1, Math.abs(allowed.value))
    )
      continue;
    refs[p.name] = { expression: `${p.value}${p.unit}`, unit: p.unit };
    changes.push({
      name: p.name,
      before: fields[p.name].expression,
      after: refs[p.name].expression,
    });
  }
  if (!changes.length)
    throw new Error(
      "AI proposed no feature dimension changes. Describe a different size or angle.",
    );
  const editedFeature: AiEditableFeature =
    feature.type === "hole"
      ? {
          ...feature,
          diameter: refs.diameter,
          depth: feature.depth === "throughAll" ? "throughAll" : refs.depth,
        }
      : feature.type === "revolve"
        ? { ...feature, angle: refs.angle }
        : {
            ...feature,
            distance: refs.distance,
            ...(feature.termination?.type === "distance"
              ? {
                  termination: {
                    ...feature.termination,
                    distance: refs.distance,
                  },
                }
              : {}),
          };
  const document = bindDocumentExpressions(
      upsertFeature(base, editedFeature),
      base,
    ),
    issues = validateDocument(document);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(" "));
  return {
    ...aiComponentOutputs(document, componentId),
    featureIds: [featureId],
    changes,
    editedFeature: document.features.find(
      (f) => f.id === featureId,
    ) as AiEditableFeature,
  };
}
