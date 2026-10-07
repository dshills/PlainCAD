import type { CadDocument, ExpressionRef, ExtrudeFeature, Feature, FeaturePatternSettings, HoleFeature } from "../document/schema";
import type { Quantity, Dimension } from "../parameters/units";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import type { SketchPlaneTransform, Point3 } from "../sketch/planes";
import { transformPoint } from "../sketch/planes";
import type { SketchProfile } from "../sketch/profileDetection";
import type { BoundingBox } from "../kernel/KernelAdapter";

export const MAX_FEATURE_PATTERN_COUNT = 32;
export type PatternSource = HoleFeature | ExtrudeFeature;
export function isPatternSource(feature: Feature | undefined): feature is PatternSource {
  return Boolean(feature && !feature.suppressed &&
    ((feature.type === "hole" && feature.centerPointIds.length === 1) ||
      (feature.type === "extrude" && feature.operation === "cut" && (!feature.termination || feature.termination.type === "distance"))));
}
export function patternSource(document: CadDocument, id: string): PatternSource {
  const source = document.features.find(feature => feature.id === id);
  if (!isPatternSource(source)) throw new Error("Pattern source was lost, suppressed, or changed. Select a single-center Hole or distance Cut Extrude.");
  return source;
}
function value(ref: ExpressionRef, dimension: Dimension, parameters: Record<string, Quantity>, label: string) {
  const evaluated = evaluateExpressionRef(ref, { parameters });
  if (evaluated.error || evaluated.quantity?.dimension !== dimension || !Number.isFinite(evaluated.quantity.value))
    throw new Error(`${label} must resolve to a finite ${dimension}.${evaluated.error ? ` ${evaluated.error}` : ""}`);
  return evaluated.quantity.value;
}

/** Pure placement planning. The source at index zero is not cut a second time. */
export function featurePatternTransforms(settings: FeaturePatternSettings, plane: SketchPlaneTransform, parameters: Record<string, Quantity>): SketchPlaneTransform[] {
  const count = value(settings.count, "scalar", parameters, "Pattern count");
  if (!Number.isInteger(count) || count < 2 || count > MAX_FEATURE_PATTERN_COUNT)
    throw new Error(`Pattern count must be a whole number from 2 to ${MAX_FEATURE_PATTERN_COUNT}, including the original.`);
  const point = (x: number, y: number): Point3 => ({
    x: plane.origin.x + plane.u.x * x + plane.v.x * y,
    y: plane.origin.y + plane.u.y * x + plane.v.y * y,
    z: plane.origin.z + plane.u.z * x + plane.v.z * y,
  });
  if (settings.type === "linear") {
    const spacing = value(settings.spacing, "length", parameters, "Pattern spacing");
    if (Math.abs(spacing) < 1e-7) throw new Error("Pattern spacing must be nonzero; overlapping copies cannot be modeled.");
    return Array.from({ length: count }, (_, index) => ({ ...plane,
      origin: point(settings.direction === "X" ? index * spacing : 0, settings.direction === "Y" ? index * spacing : 0) }));
  }
  const angle = value(settings.angle, "angle", parameters, "Pattern sweep angle");
  if (Math.abs(angle) < 1e-7 || Math.abs(angle) > 2 * Math.PI + 1e-8)
    throw new Error("Pattern sweep angle must be nonzero and at most 360 degrees in either direction.");
  const cx = value(settings.centerX, "length", parameters, "Pattern center X"),
    cy = value(settings.centerY, "length", parameters, "Pattern center Y"),
    closed = Math.abs(Math.abs(angle) - 2 * Math.PI) < 1e-8,
    step = angle / (closed ? count : count - 1);
  return Array.from({ length: count }, (_, index) => {
    const cos = Math.cos(step * index), sin = Math.sin(step * index);
    return { ...plane, origin: point(cx - cos * cx + sin * cy, cy - sin * cx - cos * cy),
      u: { x: plane.u.x * cos + plane.v.x * sin, y: plane.u.y * cos + plane.v.y * sin, z: plane.u.z * cos + plane.v.z * sin },
      v: { x: -plane.u.x * sin + plane.v.x * cos, y: -plane.u.y * sin + plane.v.y * cos, z: -plane.u.z * sin + plane.v.z * cos } };
  });
}

/** Conservative envelope only. Arc circles enclose every analytic extremum,
 * avoiding the sampled profile bounds when deciding whether native proof is needed. */
export function patternToolBounds(profile: SketchProfile, sweep: SketchPlaneTransform, distance: number): BoundingBox | undefined {
  if (!Number.isFinite(distance) || distance <= 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  if (profile.outerLoop.type === "circle") {
    include(profile.bounds.minX, profile.bounds.minY);
    include(profile.bounds.maxX, profile.bounds.maxY);
  } else {
    if (!profile.outerLoop.segments?.length) return;
    for (const segment of profile.outerLoop.segments) {
      include(segment.start.x, segment.start.y);
      include(segment.end.x, segment.end.y);
      if (segment.type === "arc") {
        if (!Number.isFinite(segment.radius) || segment.radius <= 0) return;
        include(segment.center.x - segment.radius, segment.center.y - segment.radius);
        include(segment.center.x + segment.radius, segment.center.y + segment.radius);
      }
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
  const min: BoundingBox["min"] = [Infinity, Infinity, Infinity], max: BoundingBox["max"] = [-Infinity, -Infinity, -Infinity];
  for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [0, distance]) {
    const point = transformPoint(sweep, x, y, z), coordinates = [point.x, point.y, point.z];
    if (!coordinates.every(Number.isFinite)) return;
    coordinates.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); });
  }
  for (let axis = 0; axis < 3; axis++) {
    const padding = Math.max(1e-7, Math.max(Math.abs(min[axis]), Math.abs(max[axis])) * 1e-12);
    min[axis] -= padding; max[axis] += padding;
  }
  return { min, max };
}

/** Unknown bounds and touching envelopes still require the native common-volume check. */
export function patternBoundsMayOverlap(a: BoundingBox | undefined, b: BoundingBox | undefined): boolean {
  return !a || !b || [0, 1, 2].every(axis => a.max[axis] >= b.min[axis] && b.max[axis] >= a.min[axis]);
}
