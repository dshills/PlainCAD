import type { ResolvedArc, ResolvedCircle, ResolvedLine } from "./SketchSolver";
import type { CanvasPoint } from "./canvasGeometry";

export type CanvasSnapCurve = ResolvedLine | ResolvedCircle | ResolvedArc;
export interface CurveSnapPoint extends CanvasPoint {
  kind: "intersection" | "tangent";
  sourceId: string;
}
export const compareCanvasSnapIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const EPS = 1e-9;
const cross = (a: CanvasPoint, b: CanvasPoint) => a.x * b.y - a.y * b.x;
const sub = (a: CanvasPoint, b: CanvasPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const isLine = (curve: CanvasSnapCurve): curve is ResolvedLine => "start" in curve && !("radius" in curve);
const isArc = (curve: CanvasSnapCurve): curve is ResolvedArc => "startAngle" in curve && "sweep" in curve;
const valid = (point: CanvasPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
function onCurve(point: CanvasPoint, curve: CanvasSnapCurve): boolean {
  if (!isArc(curve)) return true;
  const angle = Math.atan2(point.y - curve.center.y, point.x - curve.center.x);
  const turn = Math.PI * 2;
  const distance = ((curve.sweep >= 0 ? angle - curve.startAngle : curve.startAngle - angle) % turn + turn) % turn;
  return distance <= Math.abs(curve.sweep) + EPS || turn - distance <= EPS;
}
function intersections(a: CanvasSnapCurve, b: CanvasSnapCurve): CanvasPoint[] {
  if (isLine(a) && isLine(b)) {
    const r = sub(a.end, a.start), s = sub(b.end, b.start), q = sub(b.start, a.start);
    const determinant = cross(r, s);
    const normProduct = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
    if (normProduct === 0 || Math.abs(determinant) <= EPS * normProduct) return [];
    const t = cross(q, s) / determinant, u = cross(q, r) / determinant;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS
      ? [{ x: a.start.x + t * r.x, y: a.start.y + t * r.y }] : [];
  }
  if (isLine(a) || isLine(b)) {
    const line = isLine(a) ? a : b as ResolvedLine;
    const circle = isLine(a) ? b as ResolvedCircle : a as ResolvedCircle;
    const d = sub(line.end, line.start), f = sub(line.start, circle.center);
    const lengthSquared = d.x * d.x + d.y * d.y;
    if (lengthSquared <= EPS * EPS) return [];
    // Project onto the finite segment; this avoids cancellation in a quadratic.
    const t = -(f.x * d.x + f.y * d.y) / lengthSquared;
    const closest = { x: line.start.x + t * d.x, y: line.start.y + t * d.y };
    const offset = sub(closest, circle.center);
    const heightSquared = circle.radius ** 2 - offset.x ** 2 - offset.y ** 2;
    const tolerance = EPS * Math.max(1, circle.radius ** 2);
    if (heightSquared < -tolerance) return [];
    const delta = Math.sqrt(Math.max(0, heightSquared) / lengthSquared);
    return (delta <= EPS ? [t] : [t - delta, t + delta])
      .filter((value) => value >= -EPS && value <= 1 + EPS)
      .map((value) => ({ x: line.start.x + value * d.x, y: line.start.y + value * d.y }));
  }
  const separation = sub(b.center, a.center), distance = Math.hypot(separation.x, separation.y);
  const tolerance = EPS * Math.max(1, a.radius, b.radius, distance);
  if (distance <= tolerance || distance > a.radius + b.radius + tolerance || distance < Math.abs(a.radius - b.radius) - tolerance) return [];
  const along = (a.radius ** 2 - b.radius ** 2 + distance ** 2) / (2 * distance);
  const heightSquared = a.radius ** 2 - along ** 2;
  if (heightSquared < -tolerance * Math.max(1, a.radius)) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const center = { x: a.center.x + along * separation.x / distance, y: a.center.y + along * separation.y / distance };
  return (height <= tolerance ? [0] : [-1, 1]).map((sign) => ({
    x: center.x - sign * height * separation.y / distance,
    y: center.y + sign * height * separation.x / distance,
  }));
}
export function validCanvasSnapCurve(curve: CanvasSnapCurve) {
  return isLine(curve)
    ? valid(curve.start) && valid(curve.end)
    : valid(curve.center) && Number.isFinite(curve.radius) && curve.radius > EPS &&
    (!isArc(curve) || (Number.isFinite(curve.startAngle) && Number.isFinite(curve.sweep) && Math.abs(curve.sweep) <= Math.PI * 2 + EPS));
}
function nearCurve(curve: CanvasSnapCurve, point: CanvasPoint, margin: CanvasPoint) {
  const minX = isLine(curve) ? Math.min(curve.start.x, curve.end.x) : curve.center.x - curve.radius;
  const maxX = isLine(curve) ? Math.max(curve.start.x, curve.end.x) : curve.center.x + curve.radius;
  const minY = isLine(curve) ? Math.min(curve.start.y, curve.end.y) : curve.center.y - curve.radius;
  const maxY = isLine(curve) ? Math.max(curve.start.y, curve.end.y) : curve.center.y + curve.radius;
  if (!(point.x >= minX - margin.x && point.x <= maxX + margin.x &&
    point.y >= minY - margin.y && point.y <= maxY + margin.y)) return false;
  if (isLine(curve)) return true;
  // The largest world-space radius of the pixel-tolerance ellipse is a
  // conservative radial bound even under independent SVG X/Y scaling.
  const tolerance = Math.max(margin.x, margin.y);
  if (Math.abs(Math.hypot(point.x - curve.center.x, point.y - curve.center.y) - curve.radius) > tolerance) return false;
  if (!isArc(curve) || onCurve(point, curve)) return true;
  // Outside the signed sweep, only an endpoint can be close enough. Compute
  // from the same analytic angles used by the intersection filter.
  return [curve.startAngle, curve.startAngle + curve.sweep].some((angle) =>
    Math.hypot(point.x - curve.center.x - curve.radius * Math.cos(angle),
      point.y - curve.center.y - curve.radius * Math.sin(angle)) <= tolerance,
  );
}
/** Finite-geometry targets only. At most 2,016 pairs per pointer event. On
 * overflow, decline advanced inference instead of exposing arbitrary subsets. */
export function canvasCurveSnapTargets(curves: CanvasSnapCurve[], raw: CanvasPoint, margin: CanvasPoint, anchor?: CanvasPoint): { points: CurveSnapPoint[]; limited: boolean } {
  const nearby: CanvasSnapCurve[] = [];
  for (const curve of curves) {
    if (validCanvasSnapCurve(curve) && nearCurve(curve, raw, margin)) nearby.push(curve);
    if (nearby.length > 64) return { points: [], limited: true };
  }
  nearby.sort((a, b) => compareCanvasSnapIds(a.id, b.id));
  const points: CurveSnapPoint[] = [];
  for (let i = 0; i < nearby.length; i++) {
    const a = nearby[i];
    for (const b of nearby.slice(i + 1))
      for (const point of intersections(a, b))
        if (valid(point) && onCurve(point, a) && onCurve(point, b))
          points.push({ ...point, kind: "intersection", sourceId: `${a.id}:${b.id}` });
    if (!anchor || !valid(anchor) || isLine(a)) continue;
    const vector = sub(anchor, a.center), lengthSquared = vector.x ** 2 + vector.y ** 2;
    if (lengthSquared <= a.radius ** 2 + EPS * Math.max(1, lengthSquared)) continue;
    const ratio = a.radius ** 2 / lengthSquared;
    const offset = a.radius * Math.sqrt(lengthSquared - a.radius ** 2) / lengthSquared;
    for (const sign of [-1, 1]) {
      const point = { x: a.center.x + ratio * vector.x - sign * offset * vector.y, y: a.center.y + ratio * vector.y + sign * offset * vector.x };
      if (valid(point) && onCurve(point, a)) points.push({ ...point, kind: "tangent", sourceId: a.id });
    }
  }
  return { points, limited: false };
}
