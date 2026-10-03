import type { Sketch } from "../document/schema";
import type { ResolvedSketch } from "./SketchSolver";
import {
  addArc,
  addCircle,
  addLine,
  addPoint,
  setConstruction,
} from "./SketchModel";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE } from "./tolerances";

export type CanvasTool = "point" | "line" | "rectangle" | "circle" | "arc";
export interface CanvasPoint {
  x: number;
  y: number;
  pointId?: string;
}
export const CANVAS_POINT_COUNT: Record<CanvasTool, number> = {
  point: 1,
  line: 2,
  rectangle: 2,
  circle: 2,
  arc: 3,
};
export const distance2d = (a: CanvasPoint, b: CanvasPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Millimeter grid snapping never changes an existing point's solved position. */
export function snapCanvasPoint(
  point: CanvasPoint,
  solved: ResolvedSketch,
  tolerance: number,
  grid: number,
): CanvasPoint {
  let nearest: (typeof solved.points)[string] | undefined;
  for (const candidate of Object.values(solved.points)) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y))
      continue;
    const distance = distance2d(candidate, point),
      best = nearest ? distance2d(nearest, point) : Infinity;
    if (
      distance < best ||
      (distance === best && candidate.id.localeCompare(nearest!.id) < 0)
    )
      nearest = candidate;
  }
  if (nearest && distance2d(nearest, point) <= tolerance)
    return { x: nearest.x, y: nearest.y, pointId: nearest.id };
  return grid > 0 && Number.isFinite(grid)
    ? {
        x: Math.round(point.x / grid) * grid,
        y: Math.round(point.y / grid) * grid,
      }
    : point;
}

/** Center/start/end arc authoring projects a free endpoint onto the circle. */
export function arcEndpoint(
  center: CanvasPoint,
  start: CanvasPoint,
  end: CanvasPoint,
): CanvasPoint {
  if (end.pointId) return end;
  const radius = distance2d(center, start),
    length = distance2d(center, end);
  return length > MIN_ENTITY_SIZE
    ? {
        x: center.x + ((end.x - center.x) * radius) / length,
        y: center.y + ((end.y - center.y) * radius) / length,
      }
    : end;
}

/** Commit a whole primitive at once; unfinished gestures never create entities. */
export function addCanvasGeometry(
  sketch: Sketch,
  solved: ResolvedSketch,
  tool: CanvasTool,
  input: CanvasPoint[],
  construction = false,
  clockwise = false,
): { sketch: Sketch; endpoint?: CanvasPoint } {
  if (input.length !== CANVAS_POINT_COUNT[tool])
    throw new Error("Finish all points for this geometry.");
  if (
    input.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.max(Math.abs(p.x), Math.abs(p.y)) > 1e8,
    )
  )
    throw new Error(
      "Canvas coordinates must be finite and within 100,000,000 mm.",
    );
  if (tool !== "point" && distance2d(input[0], input[1]) <= MIN_ENTITY_SIZE)
    throw new Error("Geometry is too small. Choose distinct points.");
  if (
    tool === "rectangle" &&
    (Math.abs(input[0].x - input[1].x) <= MIN_ENTITY_SIZE ||
      Math.abs(input[0].y - input[1].y) <= MIN_ENTITY_SIZE)
  )
    throw new Error("A rectangle needs nonzero width and height.");
  const points =
    tool === "arc"
      ? [
          input[0],
          input[1],
          arcEndpoint(...(input as [CanvasPoint, CanvasPoint, CanvasPoint])),
        ]
      : input;
  if (
    tool === "arc" &&
    (distance2d(points[1], points[2]) <= MIN_ENTITY_SIZE ||
      Math.abs(
        distance2d(points[0], points[1]) - distance2d(points[0], points[2]),
      ) > SKETCH_TOLERANCE)
  )
    throw new Error(
      "Arc endpoints must be distinct and on the same radius. Choose an unsnapped endpoint or a point on the circle.",
    );
  let next = sketch;
  const created: CanvasPoint[] = [];
  const pointId = (p: CanvasPoint) => {
    if (p.pointId) {
      const resolved = solved.points[p.pointId];
      if (
        next.entities[p.pointId]?.type !== "point" ||
        !resolved ||
        distance2d(resolved, p) > SKETCH_TOLERANCE
      )
        throw new Error("Snapped point changed. Cancel and draw again.");
      return p.pointId;
    }
    const existing = snapCanvasPoint(p, solved, SKETCH_TOLERANCE, 0);
    if (existing.pointId) return existing.pointId;
    const shared = created.find(
      (candidate) => distance2d(candidate, p) <= SKETCH_TOLERANCE,
    );
    if (shared) return shared.pointId!;
    const result = addPoint(
      next,
      `${p.x.toFixed(12)}mm`,
      `${p.y.toFixed(12)}mm`,
    );
    next = result.sketch;
    created.push({ ...p, pointId: result.pointId });
    return result.pointId;
  };
  const mark = (result: { sketch: Sketch }, id: string) => {
    next = setConstruction(result.sketch, id, construction);
  };
  if (tool === "point") {
    const id = pointId(points[0]);
    // Reusing an existing point must not change its construction flag.
    if (!sketch.entities[id]) next = setConstruction(next, id, construction);
  } else if (tool === "line") {
    const a = pointId(points[0]),
      b = pointId(points[1]),
      result = addLine(next, a, b);
    mark(result, result.lineId);
    return { sketch: next, endpoint: { ...points[1], pointId: b } };
  } else if (tool === "rectangle") {
    const [a, b] = points;
    const ids = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(pointId);
    for (let i = 0; i < 4; i++) {
      const result = addLine(next, ids[i], ids[(i + 1) % 4]);
      mark(result, result.lineId);
    }
  } else if (tool === "circle") {
    const center = pointId(points[0]),
      result = addCircle(
        next,
        center,
        `${distance2d(points[0], points[1]).toFixed(12)}mm`,
      );
    mark(result, result.circleId);
  } else {
    const ids = points.map(pointId),
      result = addArc(next, ids[0], ids[1], ids[2], clockwise);
    mark(result, result.arcId);
  }
  return { sketch: next };
}
