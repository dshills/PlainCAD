import type { CadDocument, ExpressionRef } from "../cad/document/schema";
import {
  featureComponentId,
  sketchComponentId,
} from "../cad/document/components";
import { upsertParameter } from "../cad/document/CadDocument";
import {
  bindDocumentExpressions,
  mapDocumentExpressions,
  parameterTokens,
} from "../cad/parameters/expressionBindings";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import {
  planFeatureGraph,
  stableBodyIdForFeature,
} from "../cad/features/featureGraph";
import { targetBodyIds } from "../cad/document/bodyScopes";
import { validateDocument } from "../cad/document/validate";
import {
  AI_LIMITS,
  validateAiPlan,
  validateAiEditContext,
  type AiEditContext,
} from "./plan";

/** Expose only independent length/angle parameters used exclusively by this component.
 * Follow parameter dependencies so a shared indirect driver cannot escape the scope.
 * Full native preview still validates dependent face references in other components. */
export function aiEditContext(
  base: CadDocument,
  componentId: string,
): AiEditContext {
  const document = bindDocumentExpressions(base);
  const evaluated = evaluateParameters(document.parameters);
  if (evaluated.errors.length)
    throw new Error("Repair project parameters before AI editing.");
  const owners = new Map<string, Set<string>>();
  const byId = new Map(
    Object.values(document.parameters).map((p) => [p.id, p]),
  );
  const dependencies = (
    expression: Pick<ExpressionRef, "expression" | "parameterRefs">,
  ) =>
    parameterTokens(expression.expression).flatMap((t) => {
      const id =
        expression.parameterRefs?.[t.value] ?? document.parameters[t.value]?.id;
      return id ? [id] : [];
    });
  mapDocumentExpressions(document, (expression, source, id) => {
    if (source === "parameter") return expression;
    const feature =
      source === "feature"
        ? document.features.find((f) => f.id === id)
        : undefined;
    if (source !== "sketch" && !feature)
      throw new Error("AI edit context has a missing feature owner.");
    const component =
      source === "sketch"
        ? sketchComponentId(document, id)
        : featureComponentId(document, feature!);
    const pending = dependencies(expression),
      visited = new Set<string>();
    while (pending.length) {
      const parameterId = pending.pop()!;
      if (visited.has(parameterId)) continue;
      visited.add(parameterId);
      const used = owners.get(parameterId) ?? new Set<string>();
      used.add(component);
      owners.set(parameterId, used);
      const parameter = byId.get(parameterId);
      if (parameter) pending.push(...dependencies(parameter));
    }
    return expression;
  });
  const parameters = Object.values(document.parameters).flatMap((p) => {
    const users = owners.get(p.id),
      value = evaluated.values[p.name];
    if (
      p.locked ||
      users?.size !== 1 ||
      !users.has(componentId) ||
      dependencies(p).length ||
      !value ||
      (value.dimension !== "length" && value.dimension !== "angle")
    )
      return [];
    return [
      {
        id: p.id,
        name: p.name,
        expression: p.expression,
        value:
          value.dimension === "angle"
            ? (value.value * 180) / Math.PI
            : value.value,
        unit: value.dimension === "angle" ? ("deg" as const) : ("mm" as const),
      },
    ];
  });
  if (parameters.length > AI_LIMITS.parameters)
    throw new Error(
      `AI editing supports at most ${AI_LIMITS.parameters} independent component parameters.`,
    );
  return validateAiEditContext({
    componentName: document.components[componentId]?.name ?? "Component",
    parameters,
  });
}

export function buildAiParameterEdit(
  base: CadDocument,
  componentId: string,
  input: unknown,
) {
  const plan = validateAiPlan(input),
    context = aiEditContext(base, componentId);
  if (plan.steps.length)
    throw new Error(
      "AI editing accepts parameter changes only; feature replacement is unsupported.",
    );
  if (!plan.parameters.length) throw new Error(plan.summary);
  let document = base;
  const changes: Array<{ name: string; before: string; after: string }> = [];
  for (const change of plan.parameters) {
    const allowed = context.parameters.find((p) => p.name === change.name);
    if (!allowed || allowed.unit !== change.unit)
      throw new Error(
        `AI cannot edit ${change.name}: it is locked, shared, derived, missing, or has incompatible units.`,
      );
    if (
      Math.abs(allowed.value - change.value) <=
      1e-10 * Math.max(1, Math.abs(allowed.value))
    )
      continue;
    const parameter = base.parameters[allowed.name];
    const expression = `${change.value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 })}${change.unit}`;
    document = upsertParameter(document, {
      ...parameter,
      expression,
      value: change.value,
      unit: change.unit,
    });
    changes.push({
      name: allowed.name,
      before: allowed.expression,
      after: expression,
    });
  }
  if (!changes.length)
    throw new Error(
      "AI proposed no parameter changes. Describe a different dimension.",
    );
  document = bindDocumentExpressions(document, base);
  const issues = validateDocument(document),
    evaluation = evaluateParameters(document.parameters);
  if (issues.length || evaluation.errors.length)
    throw new Error(
      [...issues, ...evaluation.errors].map((e) => e.message).join(" "),
    );
  const live = new Set<string>();
  const featureIds: string[] = [];
  for (const feature of planFeatureGraph(document).orderedFeatures) {
    if (
      feature.suppressed ||
      featureComponentId(document, feature) !== componentId
    )
      continue;
    featureIds.push(feature.id);
    if (feature.type !== "extrude" && feature.type !== "revolve") continue;
    if (feature.operation === "newBody")
      live.add(stableBodyIdForFeature(feature.id));
    else if (feature.operation === "join")
      targetBodyIds(feature)
        .slice(1)
        .forEach((id) => live.delete(id));
  }
  if (!live.size)
    throw new Error("Choose a component with modeled bodies to edit.");
  return { document, componentId, featureIds, bodyIds: [...live], changes };
}
