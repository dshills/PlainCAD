import { Sketch, SketchCircle, SketchLine, SketchPoint } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { Quantity } from "../parameters/units";

const EPSILON = 1e-7;
const ANGLE_EPSILON = 1e-6;

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
      } else if (lineLength({ id: line.id, start, end }) <= EPSILON) {
        errors.push({ sketchId: sketch.id, entityId: line.id, message: "Line is degenerate because its endpoints are coincident.", severity: "error" });
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
        errors.push({ sketchId: sketch.id, entityId: circle.id, message: radius.error ?? "Circle radius must be a positive length greater than zero.", severity: "error" });
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
    if (constraint.type === "parallel" || constraint.type === "perpendicular") {
      const selected = constraint.entityIds.map((id) => lineById.get(id)).filter((line): line is ResolvedLine => Boolean(line));
      if (constraint.entityIds.length !== 2 || selected.length !== 2) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: `${constraint.type} constraint requires exactly two resolved lines.`, severity: "error" });
        continue;
      }
      const [first, second] = selected;
      const dot = unitDot(first, second);
      const angle = Math.acos(clamp(Math.abs(dot), 0, 1));
      const valid = constraint.type === "parallel" ? angle <= ANGLE_EPSILON : Math.abs(angle - Math.PI / 2) <= ANGLE_EPSILON;
      if (!valid) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: `Cannot satisfy ${constraint.type} constraint.`, severity: "error" });
      }
    }
    if (constraint.type === "midpoint") {
      const pointId = constraint.pointIds?.[0];
      const lineId = constraint.entityIds[0];
      const point = pointId ? points[pointId] : undefined;
      const line = lineById.get(lineId);
      if (!point || !line) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: pointId ?? lineId, message: "Midpoint constraint requires one point and one resolved line.", severity: "error" });
        continue;
      }
      const midX = (line.start.x + line.end.x) / 2;
      const midY = (line.start.y + line.end.y) / 2;
      if (Math.hypot(point.x - midX, point.y - midY) > EPSILON) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, entityId: point.id, message: "Cannot satisfy midpoint constraint.", severity: "error" });
      }
    }
    if (constraint.type === "symmetric") {
      const [firstId, secondId, axisStartId, axisEndId] = constraint.pointIds ?? [];
      const first = points[firstId];
      const second = points[secondId];
      const axisStart = points[axisStartId];
      const axisEnd = points[axisEndId];
      if (!first || !second || !axisStart || !axisEnd) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Symmetric constraint requires two points and two axis points.", severity: "error" });
        continue;
      }
      if (!areSymmetric(first, second, axisStart, axisEnd)) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Cannot satisfy symmetric constraint.", severity: "error" });
      }
    }
    if (constraint.type === "tangent") {
      if (constraint.entityIds.length !== 2) {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Tangent constraint requires exactly two entities.", severity: "error" });
        continue;
      }
      const line = lineById.get(constraint.entityIds[0]) ?? lineById.get(constraint.entityIds[1]);
      const circles = constraint.entityIds.map((id) => circleById.get(id)).filter((circle): circle is ResolvedCircle => Boolean(circle));
      const circle = circles[0];
      if (line && circle) {
        const distance = pointSegmentDistance(circle.center, line);
        if (Math.abs(distance - circle.radius) > EPSILON) {
          errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Cannot satisfy tangent constraint.", severity: "error" });
        }
        continue;
      }
      if (circles.length === 2) {
        const distance = Math.hypot(circles[1].center.x - circles[0].center.x, circles[1].center.y - circles[0].center.y);
        const external = Math.abs(distance - (circles[0].radius + circles[1].radius)) <= EPSILON;
        const internal = Math.abs(distance - Math.abs(circles[0].radius - circles[1].radius)) <= EPSILON;
        if (!external && !internal) {
          errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Cannot satisfy tangent constraint.", severity: "error" });
        }
        continue;
      }
      {
        errors.push({ sketchId: sketch.id, constraintId: constraint.id, message: "Cannot satisfy tangent constraint.", severity: "error" });
      }
    }
  }
  validateDimensions(sketch, points, lineById, circleById, errors, parameters);

  return { id: sketch.id, points, lines, circles, errors };
}

function validateDimensions(
  sketch: Sketch,
  points: Record<string, ResolvedPoint>,
  lineById: Map<string, ResolvedLine>,
  circleById: Map<string, ResolvedCircle>,
  errors: SketchSolveError[],
  parameters: Record<string, Quantity>,
) {
  for (const dimension of sketch.dimensions) {
    const expected = evaluateExpression(dimension.expression.expression, { parameters });
    if (expected.error || !expected.quantity) {
      errors.push({ sketchId: sketch.id, constraintId: dimension.id, message: expected.error ?? "Invalid dimension expression.", severity: "error" });
      continue;
    }
    const isAngle = dimension.type === "angle";
    if (isAngle ? expected.quantity.dimension !== "angle" : expected.quantity.dimension !== "length") {
      errors.push({ sketchId: sketch.id, constraintId: dimension.id, message: `${dimension.type} dimension has incompatible units.`, severity: "error" });
      continue;
    }
    const actual = measuredDimensionValue(dimension, points, lineById, circleById);
    if (actual === undefined) {
      errors.push({ sketchId: sketch.id, constraintId: dimension.id, message: `${dimension.type} dimension references unresolved geometry.`, severity: "error" });
      continue;
    }
    const tolerance = isAngle ? ANGLE_EPSILON : EPSILON;
    if (Math.abs(actual - expected.quantity.value) > tolerance) {
      errors.push({ sketchId: sketch.id, constraintId: dimension.id, message: `Cannot satisfy ${dimension.type} dimension.`, severity: "error" });
    }
  }
}

function measuredDimensionValue(
  dimension: Sketch["dimensions"][number],
  points: Record<string, ResolvedPoint>,
  lineById: Map<string, ResolvedLine>,
  circleById: Map<string, ResolvedCircle>,
): number | undefined {
  if (dimension.type === "radius" || dimension.type === "diameter") {
    const circle = circleById.get(dimension.entityIds[0]);
    if (!circle) return undefined;
    return dimension.type === "radius" ? circle.radius : circle.radius * 2;
  }
  if (dimension.type === "length") {
    const line = lineById.get(dimension.entityIds[0]);
    return line ? lineLength(line) : undefined;
  }
  if (dimension.type === "angle") {
    const first = lineById.get(dimension.entityIds[0]);
    const second = lineById.get(dimension.entityIds[1]);
    return first && second ? Math.acos(clamp(unitDot(first, second), -1, 1)) : undefined;
  }
  const [aId, bId] = dimension.pointIds ?? [];
  const a = points[aId];
  const b = points[bId];
  if (!a || !b) return undefined;
  if (dimension.type === "horizontalDistance") return Math.abs(b.x - a.x);
  if (dimension.type === "verticalDistance") return Math.abs(b.y - a.y);
  return Math.hypot(b.x - a.x, b.y - a.y);
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

function lineLength(line: ResolvedLine): number {
  return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
}

function unitDot(a: ResolvedLine, b: ResolvedLine): number {
  const ax = a.end.x - a.start.x;
  const ay = a.end.y - a.start.y;
  const bx = b.end.x - b.start.x;
  const by = b.end.y - b.start.y;
  const magnitudeA = Math.hypot(ax, ay);
  const magnitudeB = Math.hypot(bx, by);
  const divisor = magnitudeA * magnitudeB;
  if (divisor <= EPSILON * EPSILON) return 0;
  return (ax * bx + ay * by) / divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointSegmentDistance(point: ResolvedPoint, line: ResolvedLine): number {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON * EPSILON) return Math.hypot(point.x - line.start.x, point.y - line.start.y);
  const t = clamp(((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / lengthSquared, 0, 1);
  const closest = { x: line.start.x + t * dx, y: line.start.y + t * dy };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function areSymmetric(first: ResolvedPoint, second: ResolvedPoint, axisStart: ResolvedPoint, axisEnd: ResolvedPoint): boolean {
  const ax = axisEnd.x - axisStart.x;
  const ay = axisEnd.y - axisStart.y;
  const lengthSquared = ax * ax + ay * ay;
  if (lengthSquared <= EPSILON * EPSILON) return false;
  const t = ((first.x - axisStart.x) * ax + (first.y - axisStart.y) * ay) / lengthSquared;
  const projected = { x: axisStart.x + t * ax, y: axisStart.y + t * ay };
  const reflected = { x: projected.x * 2 - first.x, y: projected.y * 2 - first.y };
  return Math.hypot(reflected.x - second.x, reflected.y - second.y) <= EPSILON;
}
