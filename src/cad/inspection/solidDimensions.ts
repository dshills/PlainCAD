import type { SolidDimensionField } from "./solidDimensionEdit";
import type { CadDocument, ExpressionRef, Feature, SelectionRef } from "../document/schema";
import { featureComponentId } from "../document/components";
import { buildDependencyGraph, dependencyKey } from "../document/dependencyGraph";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";
import { parameterTokens } from "../parameters/expressionBindings";
import type { RebuildResult } from "../worker/workerProtocol";

export interface SolidDimension {
  id: string;
  featureId: string;
  featureName: string;
  field: SolidDimensionField;
  fieldLabel: string;
  label: string;
  value: number;
  unit: "mm" | "deg";
  expression: string;
  bound: boolean;
  affectedFeatures: string[];
  bodyIds: string[];
  anchor: [number, number, number];
}

function fields(feature: Feature): Array<{ field: SolidDimensionField; label: string; fieldLabel: string; ref: ExpressionRef }> {
  if (feature.type === "extrude")
    return !feature.termination || feature.termination.type === "distance"
      ? [{ field: "distance", label: "Thickness", fieldLabel: "Extrude distance", ref: feature.termination?.distance ?? feature.distance }]
      : [];
  if (feature.type === "revolve")
    return [{ field: "angle", label: "Angle", fieldLabel: "Revolve angle", ref: feature.angle }];
  if (feature.type === "fillet")
    return [{ field: "radius", label: "Radius", fieldLabel: "Fillet radius", ref: feature.radius }];
  if (feature.type === "chamfer")
    return [{ field: "distance", label: "Bevel size", fieldLabel: "Chamfer distance", ref: feature.distance }];
  return [
    { field: "diameter", label: "Diameter", fieldLabel: "Hole diameter", ref: feature.diameter },
    ...(feature.depth === "throughAll" ? [] : [{ field: "depth" as const, label: "Depth", fieldLabel: "Hole depth", ref: feature.depth }]),
  ];
}

/** Authored feature dimensions, never editable bounding-box measurements or inferred face roles.
 * Callers provide only a current successful rebuild and already-visible body IDs. */
export function solidDimensions(
  document: CadDocument,
  result: RebuildResult,
  selection: SelectionRef | undefined,
  componentId: string,
  hiddenBodyIds: readonly string[] = [],
): SolidDimension[] {
  if (!result.success || result.documentId !== document.id || selection?.documentId !== document.id)
    return [];
  const graph = buildDependencyGraph(document);
  const featureId = selection.kind === "feature" ? selection.id
    : selection.kind === "body" ? graph.bodyWriters.get(selection.id) : undefined;
  const feature = document.features.find((item) => item.id === featureId);
  if (!feature || feature.suppressed || featureComponentId(document, feature) !== componentId) return [];
  const visited = new Set<string>(), pending = [dependencyKey("feature", feature.id)];
  while (pending.length) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const edge of graph.outputs.get(key) ?? []) pending.push(edge.to);
  }
  const bodyIds = [...graph.bodyWriters].filter(([id, writer]) =>
    !hiddenBodyIds.includes(id) && visited.has(dependencyKey("feature", writer)),
  ).map(([id]) => id);
  const meshes = result.meshes.filter((mesh) => bodyIds.includes(mesh.bodyId) &&
    mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid);
  if (!meshes.length) return [];
  // An annotation is attached to one affected solid. It describes the feature,
  // not a measured length along an arbitrary BRep face or its bounding box.
  const anchor = meshes[0].bounds.min.map((value, axis) =>
    (value + meshes[0].bounds.max[axis]) / 2,
  ) as [number, number, number];
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length || !anchor.every(Number.isFinite)) return [];
  const affectedFeatures = document.features.filter((item) =>
    !item.suppressed && visited.has(dependencyKey("feature", item.id)),
  ).map((item) => item.name);
  return fields(feature).flatMap(({ field, label, fieldLabel, ref }) => {
    const evaluated = evaluateExpressionRef(ref, { parameters: evaluation.values });
    const angular = feature.type === "revolve";
    if (evaluated.error || evaluated.quantity?.dimension !== (angular ? "angle" : "length")) return [];
    const value = angular ? evaluated.quantity.value * 180 / Math.PI : evaluated.quantity.value;
    if (!Number.isFinite(value) || value <= 0) return [];
    return [{
      id: `${feature.id}:${fieldLabel}`, featureId: feature.id, featureName: feature.name,
      field, fieldLabel, label, value, unit: angular ? "deg" as const : "mm" as const,
      expression: ref.expression, bound: parameterTokens(ref.expression).length > 0,
      affectedFeatures, bodyIds: meshes.map((mesh) => mesh.bodyId), anchor,
    }];
  });
}
