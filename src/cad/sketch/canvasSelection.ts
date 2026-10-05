import type {
  ResolvedSketch,
  ResolvedArc,
  ResolvedCircle,
} from "./SketchSolver";
import type { CanvasPoint } from "./canvasGeometry";

export interface CanvasSelectionBox {
  start: CanvasPoint;
  end: CanvasPoint;
}
/** Left-to-right contains entire curves; right-to-left also includes intersecting curves. Zero-area boxes select nothing. */
export function canvasBoxEntityIds(
  solved: ResolvedSketch,
  box: CanvasSelectionBox,
): string[] {
  const minX = Math.min(box.start.x, box.end.x),
    maxX = Math.max(box.start.x, box.end.x);
  const minY = Math.min(box.start.y, box.end.y),
    maxY = Math.max(box.start.y, box.end.y);
  if (minX === maxX || minY === maxY) return [];
  const crossing = box.end.x < box.start.x;
  const epsilon =
    Math.max(
      1,
      Math.abs(minX),
      Math.abs(minY),
      Math.abs(maxX),
      Math.abs(maxY),
    ) *
    Number.EPSILON *
    32;
  const inside = (p: CanvasPoint, tolerance = epsilon) =>
    p.x >= minX - tolerance &&
    p.x <= maxX + tolerance &&
    p.y >= minY - tolerance &&
    p.y <= maxY + tolerance;
  const angleOnArc = (angle: number, arc: ResolvedArc) => {
    const tau = Math.PI * 2;
    const relative =
      arc.sweep < 0 ? arc.startAngle - angle : angle - arc.startAngle;
    return ((relative % tau) + tau) % tau <= Math.abs(arc.sweep) + 1e-10;
  };
  const curvePoint = (c: ResolvedCircle, angle: number) => ({
    x: c.center.x + c.radius * Math.cos(angle),
    y: c.center.y + c.radius * Math.sin(angle),
  });
  const intersectsCurve = (c: ResolvedCircle, arc?: ResolvedArc) => {
    const candidates: CanvasPoint[] = arc ? [arc.start, arc.end] : [];
    for (const x of [minX, maxX]) {
      const value = (x - c.center.x) / c.radius;
      if (Math.abs(value) <= 1)
        for (const angle of [Math.acos(value), -Math.acos(value)]) {
          if (!arc || angleOnArc(angle, arc))
            candidates.push(curvePoint(c, angle));
        }
    }
    for (const y of [minY, maxY]) {
      const value = (y - c.center.y) / c.radius;
      if (Math.abs(value) <= 1)
        for (const angle of [Math.asin(value), Math.PI - Math.asin(value)]) {
          if (!arc || angleOnArc(angle, arc))
            candidates.push(curvePoint(c, angle));
        }
    }
    // Cardinal extrema also catch a complete curve enclosed by the box.
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5])
      if (!arc || angleOnArc(angle, arc)) candidates.push(curvePoint(c, angle));
    const tolerance = Math.max(epsilon, c.radius * Number.EPSILON * 32);
    return candidates.some((p) => inside(p, tolerance));
  };
  const intersectsLine = (a: CanvasPoint, b: CanvasPoint) => {
    let lo = 0,
      hi = 1;
    for (const [origin, delta, min, max] of [
      [a.x, b.x - a.x, minX - epsilon, maxX + epsilon],
      [a.y, b.y - a.y, minY - epsilon, maxY + epsilon],
    ]) {
      if (delta === 0) {
        if (origin < min || origin > max) return false;
      } else {
        const t1 = (min - origin) / delta,
          t2 = (max - origin) / delta;
        lo = Math.max(lo, Math.min(t1, t2));
        hi = Math.min(hi, Math.max(t1, t2));
        if (lo > hi) return false;
      }
    }
    return true;
  };
  // Box selection selects curves and standalone points. Selecting support points
  // explicitly would cascade deletion into adjoining curves outside the box.
  const curvePoints = new Set([
    ...solved.lines.flatMap((l) => [l.start.id, l.end.id]),
    ...solved.circles.map((c) => c.center.id),
    ...solved.arcs.flatMap((a) => [a.center.id, a.start.id, a.end.id]),
  ]);
  const ids = Object.values(solved.points)
    .filter((p) => !curvePoints.has(p.id) && inside(p))
    .map((p) => p.id);
  for (const line of solved.lines)
    if (
      crossing
        ? intersectsLine(line.start, line.end)
        : inside(line.start) && inside(line.end)
    )
      ids.push(line.id);
  for (const circle of solved.circles)
    if (
      crossing
        ? intersectsCurve(circle)
        : inside({
            x: circle.center.x - circle.radius,
            y: circle.center.y - circle.radius,
          }) &&
          inside({
            x: circle.center.x + circle.radius,
            y: circle.center.y + circle.radius,
          })
    )
      ids.push(circle.id);
  for (const arc of solved.arcs) {
    const extrema = [
      arc.start,
      arc.end,
      ...[0, Math.PI / 2, Math.PI, Math.PI * 1.5]
        .filter((a) => angleOnArc(a, arc))
        .map((a) => curvePoint(arc, a)),
    ];
    if (
      crossing
        ? intersectsCurve(arc, arc)
        : extrema.every((p) =>
            inside(p, Math.max(epsilon, arc.radius * Number.EPSILON * 32)),
          )
    )
      ids.push(arc.id);
  }
  return ids;
}
