import type { ResolvedArc, ResolvedCircle, ResolvedLine } from "./SketchSolver";
import type { CanvasPoint } from "./canvasGeometry";
import { SKETCH_TOLERANCE as EPS } from "./tolerances";

// Arcs also have start/end fields; exclude their radius from the line member.
type TrimLine = ResolvedLine & { radius?: never; sweep?: never };
export type TrimCurve = TrimLine | ResolvedCircle | ResolvedArc;
export const FULL_TURN = Math.PI * 2;
export const wrapTrimAngle = (angle: number) => ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;
export const trimCurveIsLine = (curve: TrimCurve): curve is TrimLine => !("radius" in curve);
export const trimCurveIsArc = (curve: TrimCurve): curve is ResolvedArc => "sweep" in curve;
const subtract = (a: CanvasPoint, b: CanvasPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: CanvasPoint, b: CanvasPoint) => a.x * b.y - a.y * b.x;
export const trimPointDistance = (a: CanvasPoint, b: CanvasPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export function trimCurveParameter(curve: TrimCurve, point: CanvasPoint) {
  if (trimCurveIsLine(curve)) {
    const delta = subtract(curve.end, curve.start);
    return ((point.x - curve.start.x) * delta.x + (point.y - curve.start.y) * delta.y) / (delta.x * delta.x + delta.y * delta.y);
  }
  const start = trimCurveIsArc(curve) ? curve.startAngle : 0;
  const sign = trimCurveIsArc(curve) && curve.sweep < 0 ? -1 : 1;
  const value = wrapTrimAngle(sign * (Math.atan2(point.y - curve.center.y, point.x - curve.center.x) - start));
  return FULL_TURN - value <= EPS / curve.radius ? 0 : value;
}
export function trimCurvePointAt(curve: TrimCurve, value: number): CanvasPoint {
  if (trimCurveIsLine(curve)) return { x: curve.start.x + value * (curve.end.x - curve.start.x), y: curve.start.y + value * (curve.end.y - curve.start.y) };
  const angle = (trimCurveIsArc(curve) ? curve.startAngle : 0) + (trimCurveIsArc(curve) && curve.sweep < 0 ? -value : value);
  return { x: curve.center.x + curve.radius * Math.cos(angle), y: curve.center.y + curve.radius * Math.sin(angle) };
}
export function trimCurveScale(curve: TrimCurve) {
  return trimCurveIsLine(curve) ? trimPointDistance(curve.start, curve.end) : curve.radius;
}
function onFiniteCurve(curve: TrimCurve, point: CanvasPoint) {
  const t = trimCurveParameter(curve, point), tolerance = EPS / trimCurveScale(curve);
  return trimCurveIsLine(curve) ? t >= -tolerance && t <= 1 + tolerance :
    !trimCurveIsArc(curve) || t <= Math.abs(curve.sweep) + tolerance;
}
function circularIntervals(curve: ResolvedCircle | ResolvedArc): [number, number][] {
  if (!trimCurveIsArc(curve)) return [[0, FULL_TURN]];
  const start = wrapTrimAngle(curve.startAngle + Math.min(0, curve.sweep)), end = start + Math.abs(curve.sweep);
  return end <= FULL_TURN ? [[start, end]] : [[start, FULL_TURN], [0, end - FULL_TURN]];
}
function coincidentCircularContacts(target: ResolvedCircle | ResolvedArc, boundary: ResolvedCircle | ResolvedArc, extendTarget: boolean) {
  const tolerance = EPS / Math.max(target.radius, boundary.radius);
  const overlap = circularIntervals(target).some(([a, b]) => circularIntervals(boundary).some(([c, d]) => Math.min(b, d) - Math.max(a, c) > tolerance));
  if (overlap) throw new Error(`Curves ${target.id} and ${boundary.id} overlap on a coincident circular support. Separate their overlapping spans before trimming or extending.`);
  // Disjoint authored arcs have a unique finite contact at an endpoint. Never infer an interior contact on their shared support.
  return trimCurveIsArc(boundary) ? [boundary.start, boundary.end].filter((point) => extendTarget || onFiniteCurve(target, point)) : [];
}
/** Analytic contacts on finite boundaries; target support may be extended.
 * Tangencies and coincident supports cannot choose a unique trim interval. */
export function analyticTrimIntersections(target: TrimCurve, boundary: TrimCurve, extendTarget: boolean): CanvasPoint[] {
  let points: CanvasPoint[] = [], tangent = false;
  if (trimCurveIsLine(target) && trimCurveIsLine(boundary)) {
    const r = subtract(target.end, target.start), s = subtract(boundary.end, boundary.start), q = subtract(boundary.start, target.start);
    const denominator = cross(r, s), length = trimCurveScale(target), otherLength = trimCurveScale(boundary);
    if (Math.abs(denominator) <= Math.max(Number.EPSILON * 32, EPS / Math.max(length, otherLength)) * length * otherLength) {
      if (Math.abs(cross(q, r)) / length <= EPS) {
        const a = trimCurveParameter(target, boundary.start), b = trimCurveParameter(target, boundary.end);
        if (Math.min(a, b) < 1 - EPS / length && Math.max(a, b) > EPS / length)
          throw new Error(`Boundary ${boundary.id} overlaps or is collinear with the selected curve. Separate ambiguous supports first.`);
      }
      return [];
    }
    const t = cross(q, s) / denominator;
    points = [trimCurvePointAt(target, t)];
  } else if (trimCurveIsLine(target) || trimCurveIsLine(boundary)) {
    const line = trimCurveIsLine(target) ? target : boundary as ResolvedLine;
    const circle = trimCurveIsLine(target) ? boundary as ResolvedCircle : target as ResolvedCircle;
    const length = trimCurveScale(line), direction = subtract(line.end, line.start), ux = direction.x / length, uy = direction.y / length;
    const offset = subtract(line.start, circle.center), along = -(offset.x * ux + offset.y * uy);
    const perpendicular = offset.x * uy - offset.y * ux;
    if (Math.abs(perpendicular) > circle.radius + EPS) return [];
    tangent = Math.abs(Math.abs(perpendicular) - circle.radius) <= EPS;
    const half = Math.sqrt(Math.max(0, (circle.radius - Math.abs(perpendicular)) * (circle.radius + Math.abs(perpendicular))));
    points = (tangent ? [along] : [along - half, along + half]).map((root) => ({ x: line.start.x + root * ux, y: line.start.y + root * uy }));
  } else {
    const vector = subtract(boundary.center, target.center), separation = Math.hypot(vector.x, vector.y);
    const sum = target.radius + boundary.radius, difference = Math.abs(target.radius - boundary.radius);
    if (separation <= EPS && difference <= EPS) return coincidentCircularContacts(target, boundary, extendTarget);
    if (separation <= EPS || separation > sum + EPS || separation < difference - EPS) return [];
    const along = ((target.radius - boundary.radius) * sum + separation * separation) / (2 * separation);
    tangent = Math.abs(separation - sum) <= EPS || Math.abs(separation - difference) <= EPS;
    const half = Math.sqrt(Math.max(0, (sum + separation) * (sum - separation) * (separation + difference) * (separation - difference))) / (2 * separation);
    const ux = vector.x / separation, uy = vector.y / separation;
    points = (tangent ? [0] : [-1, 1]).map((sign) => ({ x: target.center.x + along * ux - sign * half * uy, y: target.center.y + along * uy + sign * half * ux }));
  }
  points = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && onFiniteCurve(boundary, point) && (extendTarget || onFiniteCurve(target, point)));
  if (tangent && points.length) throw new Error(`Curves ${target.id} and ${boundary.id} meet tangentially. A tangent contact does not define an unambiguous trim or extension boundary.`);
  return points;
}
