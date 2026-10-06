import type { CadDocument, ExpressionRef, Feature } from "../document/schema";
import { upsertFeature, upsertParameter } from "../document/CadDocument";
import { validateDocument } from "../document/validate";
import { buildDependencyGraph, dependencyKey } from "../document/dependencyGraph";
import { bindDocumentExpressions, parameterTokens } from "../parameters/expressionBindings";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";

export type SolidDimensionField = "distance" | "angle" | "diameter" | "depth" | "radius";
export type SolidDimensionTarget = { kind: "feature" } | { kind: "parameter"; id: string };
export function solidDimensionRef(feature: Feature, field: SolidDimensionField): ExpressionRef {
  if (feature.type === "extrude" && field === "distance" && (!feature.termination || feature.termination.type === "distance")) return feature.termination?.distance ?? feature.distance;
  if (feature.type === "revolve" && field === "angle") return feature.angle;
  if (feature.type === "fillet" && field === "radius") return feature.radius;
  if (feature.type === "chamfer" && field === "distance") return feature.distance;
  if (feature.type === "hole" && field === "diameter") return feature.diameter;
  if (feature.type === "hole" && field === "depth" && feature.depth !== "throughAll") return feature.depth;
  throw new Error("This feature does not have an editable driving field.");
}
export function solidDimensionParameters(document: CadDocument, ref: ExpressionRef) {
  const bound = bindDocumentExpressions(document);
  return [...new Set(parameterTokens(ref.expression).map((token) => ref.parameterRefs?.[token.value] ?? bound.parameters[token.value]?.id))]
    .flatMap((id) => {
      const parameter = Object.values(bound.parameters).find((p) => p.id === id);
      return parameter ? [{ parameter, reason: parameter.locked ? "Locked parameter" : parameterTokens(parameter.expression).length ? "Derived parameter: edit its source in Parameters" : undefined }] : [];
    });
}
export function solidDimensionImpact(document: CadDocument, kind: "parameter" | "feature", id: string) {
  const graph = buildDependencyGraph(document), visited = new Set<string>(), pending = [dependencyKey(kind, id)];
  while (pending.length) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const edge of graph.outputs.get(key) ?? []) pending.push(edge.to);
  }
  return [...graph.nodes.values()].filter((node) => visited.has(node.key) && !node.missing && !node.suppressed).map((node) => `${node.kind}: ${node.label}`);
}
export function buildSolidDimensionEdit(document: CadDocument, featureId: string, field: SolidDimensionField, target: SolidDimensionTarget, expression: string) {
  const feature = document.features.find((f) => f.id === featureId);
  if (!feature || feature.suppressed) throw new Error("Feature no longer exists or is suppressed.");
  const original = solidDimensionRef(feature, field);
  expression = expression.trim();
  if (!expression || expression.length > 1000) throw new Error("Enter a dimension expression of at most 1,000 characters.");
  let staged: CadDocument;
  if (target.kind === "parameter") {
    const choice = solidDimensionParameters(document, original).find((item) => item.parameter.id === target.id);
    if (!choice || choice.reason) throw new Error(choice?.reason ?? "Choose a referenced parameter.");
    if (choice.parameter.expression === expression) throw new Error("Enter a changed value before previewing.");
    staged = upsertParameter(document, { ...choice.parameter, expression, parameterRefs: undefined });
  } else {
    if (original.expression === expression) throw new Error("Enter a changed value before previewing.");
    const ref = { ...original, expression, parameterRefs: undefined };
    let updated: Feature;
    if (feature.type === "extrude") updated = { ...feature, distance: ref, ...(feature.termination?.type === "distance" ? { termination: { ...feature.termination, distance: ref } } : {}) };
    else if (feature.type === "revolve") updated = { ...feature, angle: ref };
    else if (feature.type === "fillet") updated = { ...feature, radius: ref };
    else if (feature.type === "chamfer") updated = { ...feature, distance: ref };
    else updated = field === "diameter" ? { ...feature, diameter: ref } : { ...feature, depth: ref };
    staged = upsertFeature(document, updated);
  }
  staged = bindDocumentExpressions(staged, document);
  const invalid = validateDocument(staged);
  if (invalid.length) throw new Error(invalid.map((issue) => issue.message).join(" "));
  const parameters = evaluateParameters(staged.parameters);
  if (parameters.errors.length) throw new Error(parameters.errors.map((issue) => issue.message).join(" "));
  const edited = staged.features.find((f) => f.id === featureId)!;
  const evaluated = evaluateExpressionRef(solidDimensionRef(edited, field), { parameters: parameters.values });
  if (evaluated.error || !evaluated.quantity) throw new Error(evaluated.error ?? "Could not evaluate the driving field.");
  if (evaluated.quantity.dimension !== (field === "angle" ? "angle" : "length") || !Number.isFinite(evaluated.quantity.value) || evaluated.quantity.value <= 0 || (field === "angle" && evaluated.quantity.value > 2 * Math.PI + 1e-9))
    throw new Error(field === "angle" ? "Angle must be greater than zero and at most 360 degrees." : "Driving dimension must be a positive length.");
  return staged;
}
