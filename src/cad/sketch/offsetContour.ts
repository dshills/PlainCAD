import type { CanvasPoint } from "./canvasGeometry";
import type { ProfileSegment } from "./profileDetection";
import { ANGULAR_TOLERANCE, MIN_ENTITY_SIZE, SKETCH_TOLERANCE as EPS } from "./tolerances";

export type OffsetCurve = ProfileSegment | { type: "circle"; id: string; center: CanvasPoint; radius: number };
const subtract = (a: CanvasPoint, b: CanvasPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: CanvasPoint, b: CanvasPoint) => a.x * b.y - a.y * b.x;
const dot = (a: CanvasPoint, b: CanvasPoint) => a.x * b.x + a.y * b.y;
const length = (a: CanvasPoint) => Math.hypot(a.x, a.y);
const distance = (a: CanvasPoint, b: CanvasPoint) => length(subtract(a, b));
const wrap = (angle: number) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
function onCurve(curve: OffsetCurve, point: CanvasPoint) {
  if (curve.type === "line") {
    const edge = subtract(curve.end, curve.start), relative = subtract(point, curve.start), size = length(edge);
    return Math.abs(cross(relative, edge)) <= EPS * size && dot(relative, edge) >= -EPS * size && dot(relative, edge) <= dot(edge, edge) + EPS * size;
  }
  if (Math.abs(distance(point, curve.center) - curve.radius) > EPS) return false;
  if (curve.type === "circle") return true;
  const angle = wrap(Math.sign(curve.sweep) * (Math.atan2(point.y - curve.center.y, point.x - curve.center.x) - curve.startAngle));
  return angle <= Math.abs(curve.sweep) + EPS / curve.radius || Math.PI * 2 - angle <= EPS / curve.radius;
}
/** Exact finite line/circle/arc contacts, including tangencies and overlapping spans. */
export function offsetCurvesTouch(a: OffsetCurve, b: OffsetCurve, allowed?: CanvasPoint | CanvasPoint[]): boolean {
  let candidates: CanvasPoint[] = [];
  if (a.type === "line" && b.type === "line") {
    const r = subtract(a.end, a.start), s = subtract(b.end, b.start), q = subtract(b.start, a.start), determinant = cross(r, s);
    const collinear = Math.abs(cross(q, r)) <= EPS * length(r) && Math.abs(cross(subtract(b.end, a.start), r)) <= EPS * length(r);
    if (collinear) {
      candidates = [a.start, a.end, b.start, b.end].filter((point) => onCurve(a, point) && onCurve(b, point));
    } else if (Math.abs(determinant) <= Number.EPSILON * length(r) * length(s) * 64) return false;
    else {
      const t = cross(q, s) / determinant;
      candidates = [{ x: a.start.x + t * r.x, y: a.start.y + t * r.y }];
    }
  } else if (a.type === "line" || b.type === "line") {
    const line = a.type === "line" ? a : b as Extract<OffsetCurve, { type: "line" }>;
    const circle = a.type === "line" ? b as Exclude<OffsetCurve, { type: "line" }> : a;
    const r = subtract(line.end, line.start), size = length(r), unit = { x: r.x / size, y: r.y / size }, q = subtract(line.start, circle.center);
    const perpendicular = cross(q, unit), along = -dot(q, unit);
    if (Math.abs(perpendicular) > circle.radius + EPS) return false;
    const half = Math.abs(Math.abs(perpendicular) - circle.radius) <= EPS ? 0 : Math.sqrt(Math.max(0, (circle.radius - Math.abs(perpendicular)) * (circle.radius + Math.abs(perpendicular))));
    candidates = [along - half, along + half].map((t) => ({ x: line.start.x + unit.x * t, y: line.start.y + unit.y * t }));
  } else {
    const delta = subtract(b.center, a.center), size = length(delta), sum = a.radius + b.radius, difference = Math.abs(a.radius - b.radius);
    if (size <= EPS && difference <= EPS) {
      if (a.type === "circle" || b.type === "circle") return true;
      // Testing interior angular spans distinguishes shared endpoints from coincident overlap.
      const spans = [a, b].map((curve) => {
        const start = wrap(curve.startAngle + Math.min(0, curve.sweep)), end = start + Math.abs(curve.sweep);
        return end <= Math.PI * 2 ? [[start, end]] : [[start, Math.PI * 2], [0, end - Math.PI * 2]];
      });
      if (spans[0].some(([x, y]) => spans[1].some(([u, v]) => Math.min(y, v) - Math.max(x, u) > EPS / a.radius))) return true;
      candidates = [a.start, a.end, b.start, b.end];
    } else {
      if (size <= EPS || size > sum + EPS || size < difference - EPS) return false;
      const along = ((a.radius - b.radius) * sum + size * size) / (2 * size);
      const half = Math.abs(size - sum) <= EPS || Math.abs(size - difference) <= EPS ? 0 : Math.sqrt(Math.max(0, (sum + size) * (sum - size) * (size + difference) * (size - difference))) / (2 * size);
      const unit = { x: delta.x / size, y: delta.y / size };
      candidates = [-1, 1].map((sign) => ({ x: a.center.x + along * unit.x - sign * half * unit.y, y: a.center.y + along * unit.y + sign * half * unit.x }));
    }
  }
  const allowedPoints = allowed ? Array.isArray(allowed) ? allowed : [allowed] : [];
  return candidates.some((point) => onCurve(a, point) && onCurve(b, point) && allowedPoints.every((endpoint) => distance(point, endpoint) > EPS));
}
function tangent(segment: ProfileSegment, atEnd: boolean) {
  if (segment.type === "line") {
    const delta = subtract(segment.end, segment.start), size = length(delta);
    return { x: delta.x / size, y: delta.y / size };
  }
  const radial = subtract(atEnd ? segment.end : segment.start, segment.center), sign = Math.sign(segment.sweep);
  return { x: -sign * radial.y / segment.radius, y: sign * radial.x / segment.radius };
}
export function offsetContourArea(segments: ProfileSegment[]) {
  if (!segments.length) return 0;
  const origin = segments[0].start;
  return segments.reduce((sum, segment) => {
    const start = subtract(segment.start, origin), end = subtract(segment.end, origin);
    return sum + (segment.type === "line" ? cross(start, end) : cross(subtract(segment.center, origin), subtract(end, start)) + segment.radius * segment.radius * segment.sweep);
  }, 0) / 2;
}
/** Miter line corners and preserve tangent analytic arc junctions; never sample curves. */
export function offsetAuthoredContour(source: ProfileSegment[], signedDistance: number): ProfileSegment[] {
  const area = offsetContourArea(source), orientation = Math.sign(area);
  if (Math.abs(area) <= MIN_ENTITY_SIZE * MIN_ENTITY_SIZE) throw new Error("The source outline is collapsed or too small to offset.");
  const copied = source.map((segment, index): ProfileSegment => {
    if (distance(segment.end, source[(index + 1) % source.length].start) > EPS)
      throw new Error("Outline is not a single continuous closed boundary. Repair its connections first.");
    if (segment.type === "line") {
      const edge = subtract(segment.end, segment.start), size = length(edge);
      if (size <= MIN_ENTITY_SIZE) throw new Error("The source outline has an undersized edge. Repair it first.");
      const shift = { x: signedDistance * orientation * edge.y / size, y: -signedDistance * orientation * edge.x / size };
      return { ...segment, start: { x: segment.start.x + shift.x, y: segment.start.y + shift.y }, end: { x: segment.end.x + shift.x, y: segment.end.y + shift.y } };
    }
    const radius = segment.radius + signedDistance * orientation * Math.sign(segment.sweep);
    if (radius <= MIN_ENTITY_SIZE) throw new Error("Offset collapses an analytic arc radius. Reduce the distance.");
    if (!Number.isFinite(radius) || radius > 1e8) throw new Error("Offset arc radius exceeds 100,000,000 mm. Reduce the distance.");
    const radial = (point: CanvasPoint) => ({ x: segment.center.x + (point.x - segment.center.x) * radius / segment.radius, y: segment.center.y + (point.y - segment.center.y) * radius / segment.radius });
    return { ...segment, radius, start: radial(segment.start), end: radial(segment.end) };
  });
  for (let i = 0; i < source.length; i++) {
    const j = (i + 1) % source.length, previous = copied[i], next = copied[j];
    if (previous.type === "line" && next.type === "line") {
      const r = subtract(previous.end, previous.start), s = subtract(next.end, next.start), determinant = cross(r, s);
      if (Math.abs(determinant) <= Number.EPSILON * length(r) * length(s) * 64) {
        if (dot(r, s) <= 0) throw new Error("A reversing corner needs an unsupported miter. Simplify the outline.");
        if (distance(previous.end, next.start) > EPS) throw new Error("Offset parallel edges are disconnected beyond sketch tolerance. Repair the source connections or reduce the distance.");
      } else {
        const t = cross(subtract(next.start, previous.start), s) / determinant;
        const join = { x: previous.start.x + t * r.x, y: previous.start.y + t * r.y };
        previous.end = join; next.start = join;
      }
    } else {
      const incoming = tangent(source[i], true), outgoing = tangent(source[j], false);
      if (dot(incoming, outgoing) <= 0 || Math.abs(cross(incoming, outgoing)) > ANGULAR_TOLERANCE || distance(previous.end, next.start) > EPS)
        throw new Error("Offset requires tangent joins at analytic arcs. Add a tangent constraint or use separate outlines; nonsmooth arc corners are not approximated.");
      // Coincident joins share one authored point within the same closure tolerance
      // used by profile detection; the copied sketch solve/native preview remains required.
      next.start = previous.end;
    }
  }
  for (let i = 0; i < copied.length; i++) {
    const segment = copied[i];
    if ([segment.start, segment.end, ...(segment.type === "arc" ? [segment.center] : [])].some((point) => ![point.x, point.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 1e8)))
      throw new Error("Offset coordinates exceed the supported ±100,000,000 mm range. Reduce the distance.");
    if (segment.type === "line" && dot(subtract(segment.end, segment.start), subtract(source[i].end, source[i].start)) <= MIN_ENTITY_SIZE * distance(source[i].start, source[i].end))
      throw new Error("Offset collapses or reverses an edge. Reduce the distance; no collapsed contour is created.");
    for (let j = i + 1; j < copied.length; j++) {
      const allowed = copied.length === 2 ? [segment.start, segment.end] : j === i + 1 ? segment.end : i === 0 && j === copied.length - 1 ? segment.start : undefined;
      if (offsetCurvesTouch(segment, copied[j], allowed)) throw new Error("Offset would self-intersect or overlap. Reduce the distance or simplify the outline.");
    }
  }
  if (orientation * offsetContourArea(copied) <= MIN_ENTITY_SIZE * MIN_ENTITY_SIZE) throw new Error("Offset collapses or reverses the contour. Reduce the distance.");
  return copied;
}
