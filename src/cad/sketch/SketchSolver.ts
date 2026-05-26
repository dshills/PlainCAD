import { Sketch, SketchCircle, SketchLine, SketchPoint } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { Quantity } from "../parameters/units";

export interface ResolvedPoint {
  id: string;
  x: number;
  y: number;
}

export interface ResolvedLine {
  id: string;
  start: ResolvedPoint;
  end: ResolvedPoint;
}

export interface ResolvedCircle {
  id: string;
  center: ResolvedPoint;
  radius: number;
}

export interface ResolvedSketch {
  id: string;
  points: Record<string, ResolvedPoint>;
  lines: ResolvedLine[];
  circles: ResolvedCircle[];
  errors: SketchSolveError[];
}

export interface SketchSolveError {
  sketchId: string;
  constraintId?: string;
  entityId?: string;
  message: string;
  severity: "warning" | "error";
}

export function solveSketch(sketch: Sketch, parameters: Record<string, Quantity>): ResolvedSketch {
  const points: Record<string, ResolvedPoint> = {};
  const errors: SketchSolveError[] = [];

  for (const entity of Object.values(sketch.entities)) {
    if (entity.type !== "point") continue;
    const point = entity as SketchPoint;
    const x = evaluateExpression(point.x.expression, { parameters });
    const y = evaluateExpression(point.y.expression, { parameters });
    if (x.error || !x.quantity) {
      errors.push({ sketchId: sketch.id, entityId: point.id, message: x.error ?? "Invalid x expression.", severity: "error" });
      continue;
    }
    if (y.error || !y.quantity) {
      errors.push({ sketchId: sketch.id, entityId: point.id, message: y.error ?? "Invalid y expression.", severity: "error" });
      continue;
    }
    if (x.quantity.dimension !== "length" || y.quantity.dimension !== "length") {
      errors.push({ sketchId: sketch.id, entityId: point.id, message: "Point coordinates must resolve to length values.", severity: "error" });
      continue;
    }
    points[point.id] = { id: point.id, x: x.quantity.value, y: y.quantity.value };
  }

  const lines: ResolvedLine[] = [];
  const circles: ResolvedCircle[] = [];
  for (const entity of Object.values(sketch.entities)) {
    if (entity.type === "line") {
      const line = entity as SketchLine;
      const start = points[line.startPointId];
      const end = points[line.endPointId];
      if (!start || !end) {
        errors.push({ sketchId: sketch.id, entityId: line.id, message: "Line references unresolved points.", severity: "error" });
      } else {
        lines.push({ id: line.id, start, end });
      }
    }
    if (entity.type === "circle") {
      const circle = entity as SketchCircle;
      const center = points[circle.centerPointId];
      const radius = evaluateExpression(circle.radius.expression, { parameters });
      if (!center) {
        errors.push({ sketchId: sketch.id, entityId: circle.id, message: "Circle references unresolved center point.", severity: "error" });
      } else if (radius.error || !radius.quantity || radius.quantity.value <= 0 || radius.quantity.dimension !== "length") {
        errors.push({ sketchId: sketch.id, entityId: circle.id, message: radius.error ?? "Circle radius must be greater than zero.", severity: "error" });
      } else {
        circles.push({ id: circle.id, center, radius: radius.quantity.value });
      }
    }
  }

  for (const constraint of sketch.constraints) {
    if (constraint.type === "horizontal" || constraint.type === "vertical") {
      const lineId = constraint.entityIds[0];
      const line = lines.find((item) => item.id === lineId);
      if (!line) continue;
      if (constraint.type === "horizontal" && Math.abs(line.start.y - line.end.y) > 0.0001) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: lineId, message: "Cannot satisfy horizontal constraint.", severity: "error" });
      }
      if (constraint.type === "vertical" && Math.abs(line.start.x - line.end.x) > 0.0001) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: lineId, message: "Cannot satisfy vertical constraint.", severity: "error" });
      }
    }
  }

  return { id: sketch.id, points, lines, circles, errors };
}
