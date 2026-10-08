import type { CadDocument, Feature } from "../document/schema";
import type { ResolvedSketch } from "../sketch/SketchSolver";
import type { ProfileDetectionResult } from "../sketch/profileDetection";
import type { SketchPlaneTransform } from "../sketch/planes";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import type { Quantity } from "../parameters/units";
import { targetBodyIds } from "../document/bodyScopes";
import { stableBodyIdForFeature } from "./featureGraph";

/** Exact values, never a lossy hash. Upstream body versions identify validated
 * immutable cache outputs; changed inputs obtain new versions on publication. */
export function nativeFeatureSignature(
  feature: Feature,
  document: CadDocument,
  sketches: Map<string, ResolvedSketch>,
  profiles: Map<string, ProfileDetectionResult>,
  planes: Map<string, SketchPlaneTransform>,
  parameters: Record<string, Quantity>,
  bodyVersions: Map<string, number>,
): string | undefined {
  const source = feature.type === "pattern" ? document.features.find(item => item.id === feature.sourceFeatureId) : feature;
  const sketchId = source && "sketchId" in source ? source.sketchId : undefined;
  const solved = sketchId ? sketches.get(sketchId) : undefined;
  if (sketchId && (!solved || solved.errors.length || !planes.has(sketchId))) return undefined;
  const dependencies = new Set(targetBodyIds(feature));
  if (feature.type === "extrude" && feature.termination?.type === "toFace") dependencies.add(stableBodyIdForFeature(feature.termination.faceRef.featureId));
  for (const id of dependencies) if (!bodyVersions.has(id)) return undefined;
  try {
    const signature = JSON.stringify([
      normalize(feature, parameters, true),
      source !== feature ? normalize(source, parameters, true) : undefined,
      solved && normalize({ id: solved.id, points: solved.points, lines: solved.lines, circles: solved.circles, arcs: solved.arcs }, parameters),
      sketchId && normalize(profiles.get(sketchId)?.profiles, parameters),
      sketchId && normalize(planes.get(sketchId), parameters),
      [...dependencies].map(id => [id, bodyVersions.get(id)]),
    ]);
    return signature.length <= 262144 ? signature : undefined;
  } catch (error) {
    if (error instanceof UncacheableInput) return undefined;
    throw error;
  }
}

class UncacheableInput extends Error {}

function normalize(value: unknown, parameters: Record<string, Quantity>, feature = false): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) throw new UncacheableInput();
  if (Array.isArray(value)) return value.map(item => normalize(item, parameters));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (typeof object.expression === "string") {
    const evaluated = evaluateExpressionRef(object as unknown as Parameters<typeof evaluateExpressionRef>[0], { parameters });
    if (evaluated.error || !evaluated.quantity) throw new UncacheableInput();
    return { quantity: evaluated.quantity };
  }
  return Object.fromEntries(Object.entries(object).filter(([key]) => !feature || !["name", "createdAt", "updatedAt", "timelineStep"].includes(key)).map(([key, item]) => [key, normalize(item, parameters)]));
}
