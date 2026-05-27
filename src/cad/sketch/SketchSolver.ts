import { Sketch, SketchCircle, SketchLine, SketchPoint } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { Quantity } from "../parameters/units";

const EPSILON = 1e-7;

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

  applyCoincidentConstraints(sketch, points, errors);

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
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const circleById = new Map(circles.map((circle) => [circle.id, circle]));

  for (const constraint of sketch.constraints) {
    if (constraint.type === "fixed" || constraint.type === "coincident") continue;
    if (constraint.type === "horizontal" || constraint.type === "vertical") {
      const lineId = constraint.entityIds[0];
      const line = lineById.get(lineId);
      if (!line) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: lineId, message: `${constraint.type} constraint references an unresolved line.`, severity: "error" });
        continue;
      }
      if (constraint.type === "horizontal" && Math.abs(line.start.y - line.end.y) > EPSILON) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: lineId, message: "Cannot satisfy horizontal constraint.", severity: "error" });
      }
      if (constraint.type === "vertical" && Math.abs(line.start.x - line.end.x) > EPSILON) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: lineId, message: "Cannot satisfy vertical constraint.", severity: "error" });
      }
    }
    if (constraint.type === "equalRadius") {
      const selected = constraint.entityIds.map((id) => circleById.get(id)).filter((circle): circle is ResolvedCircle => Boolean(circle));
      if (selected.length !== constraint.entityIds.length) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Equal radius constraint references an unresolved circle.", severity: "error" });
        continue;
      }
      if (selected.length > 1 && selected.some((circle) => Math.abs(circle.radius - selected[0].radius) > EPSILON)) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Cannot satisfy equal radius constraint.", severity: "error" });
      }
    }
    if (constraint.type === "equalLength") {
      const selected = constraint.entityIds.map((id) => lineById.get(id)).filter((line): line is ResolvedLine => Boolean(line));
      if (selected.length !== constraint.entityIds.length) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Equal length constraint references an unresolved line.", severity: "error" });
        continue;
      }
      const length = (line: ResolvedLine) => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
      if (selected.length > 1 && selected.some((line) => Math.abs(length(line) - length(selected[0])) > EPSILON)) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Cannot satisfy equal length constraint.", severity: "error" });
      }
    }
  }

  return { id: sketch.id, points, lines, circles, errors };
}

function applyCoincidentConstraints(
  sketch: Sketch,
  points: Record<string, ResolvedPoint>,
  errors: SketchSolveError[],
) {
  const parent = new Map<string, string>();
  const pointOrder = new Map<string, number>();
  Object.keys(points).forEach((pointId, index) => {
    parent.set(pointId, pointId);
    pointOrder.set(pointId, index);
  });
  const fixedPointIds = new Set<string>();

  const find = (pointId: string): string => {
    let root = pointId;
    while (parent.get(root) && parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    let current = pointId;
    while (parent.get(current) && parent.get(current) !== root) {
      const next = parent.get(current) ?? root;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const constraint of sketch.constraints) {
    if (constraint.type === "fixed") {
      for (const pointId of constraint.pointIds ?? []) fixedPointIds.add(pointId);
      continue;
    }
    if (constraint.type !== "coincident") continue;
    const pointIds = constraint.pointIds ?? [];
    const missing = pointIds.filter((pointId) => !points[pointId]);
    for (const pointId of missing) {
      errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: pointId, message: "Coincident constraint references an unresolved point.", severity: "error" });
    }
    const resolved = pointIds.filter((pointId) => points[pointId]);
    for (const pointId of resolved.slice(1)) union(resolved[0], pointId);
  }

  const groups = new Map<string, string[]>();
  for (const pointId of Object.keys(points)) {
    const root = find(pointId);
    const group = groups.get(root) ?? [];
    group.push(pointId);
    groups.set(root, group);
  }
  for (const pointIds of groups.values()) {
    const ordered = [...pointIds].sort((a, b) => {
      const fixedA = fixedPointIds.has(a);
      const fixedB = fixedPointIds.has(b);
      if (fixedA !== fixedB) return fixedA ? -1 : 1;
      return (pointOrder.get(a) ?? 0) - (pointOrder.get(b) ?? 0);
    });
    const anchor = points[ordered[0]];
    for (const pointId of ordered.slice(1)) {
      if (fixedPointIds.has(pointId) && (Math.abs(points[pointId].x - anchor.x) > EPSILON || Math.abs(points[pointId].y - anchor.y) > EPSILON)) {
        errors.push({ sketchId: sketch.id, entityId: pointId, message: "Coincident constraint conflicts with fixed point coordinates.", severity: "error" });
      }
      points[pointId] = { ...points[pointId], x: anchor.x, y: anchor.y };
    }
  }
}
