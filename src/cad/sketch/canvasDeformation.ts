import { assertEditableGeometry } from "./projectedGeometry";
import type { Sketch } from "../document/schema";
import { collectExpressionDependencies } from "../parameters/expressionEvaluator";
import { entityPoints } from "./canvasPointMove";
import type { CanvasPoint } from "./canvasGeometry";
import { detectProfiles } from "./profileDetection";
import type { ResolvedSketch } from "./SketchSolver";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE as EPS } from "./tolerances";

class DeformationReferenceError extends Error {}

export const MAX_DEFORMATION_POINTS = 80;
export interface CanvasDeformationPlan {
  xIds: string[];
  yIds: string[];
  pointIds: string[];
  lockedX?: string;
  lockedY?: string;
  reason?: string;
}
/** Coordinate changes propagate through linear orthogonal relations. An offset
 * dimension links changes, not absolute coordinates, preserving its signed branch. */
export function canvasDeformationPlan(
  sketch: Sketch,
  solved: ResolvedSketch,
  pointId: string,
): CanvasDeformationPlan {
  const fail = (reason: string): CanvasDeformationPlan => ({
    xIds: [],
    yIds: [],
    pointIds: [],
    reason,
  });
  if (!solved.points[pointId] || sketch.entities[pointId]?.type !== "point")
    return fail("Point reference lost. Select a current point.");
  if (solved.errors.some((e) => e.severity === "error"))
    return fail("Repair sketch diagnostics before deforming geometry.");
  const points = Object.values(sketch.entities).filter(
    (e) => e.type === "point",
  );
  if (points.length > MAX_DEFORMATION_POINTS)
    return fail(
      `Deformation supports at most ${MAX_DEFORMATION_POINTS} points. Split the sketch.`,
    );
  if (
    Object.values(sketch.entities).some(
      (e) => e.type !== "point" && e.type !== "line",
    )
  )
    return fail(
      "Deformation currently supports point-and-line sketches. Edit circle/arc geometry or dimensions instead.",
    );
  const parents = {
    x: new Map(points.map((p) => [p.id, p.id])),
    y: new Map(points.map((p) => [p.id, p.id])),
  };
  const root = (axis: "x" | "y", id: string): string => {
    const parent = parents[axis];
    if (!parent.has(id))
      throw new DeformationReferenceError(
        `Deformation reference "${id}" is not a current point.`,
      );
    let result = id;
    while (parent.get(result)! !== result) result = parent.get(result)!;
    return result;
  };
  const connect = (axis: "x" | "y", ids: string[]) => {
    for (const id of ids.slice(1))
      parents[axis].set(root(axis, id), root(axis, ids[0]));
  };
  const horizontal = new Set<string>(),
    vertical = new Set<string>(),
    fixed = new Set<string>();
  try {
    for (const c of sketch.constraints) {
      if (c.type === "fixed") {
        [
          ...(c.pointIds ?? []),
          ...c.entityIds.flatMap((id) => entityPoints(sketch, id)),
        ].forEach((id) => fixed.add(id));
      } else if (c.type === "coincident") {
        connect("x", c.pointIds ?? []);
        connect("y", c.pointIds ?? []);
      } else if (c.type === "horizontal" || c.type === "vertical") {
        for (const id of c.entityIds) {
          const line = sketch.entities[id];
          if (line?.type !== "line")
            return fail(
              `Repair constraint "${c.id}": a current line is required.`,
            );
          connect(c.type === "horizontal" ? "y" : "x", [
            line.startPointId,
            line.endPointId,
          ]);
          (c.type === "horizontal" ? horizontal : vertical).add(id);
        }
      } else
        return fail(
          `Constraint "${c.id}" (${c.type}) is not supported by orthogonal deformation. Edit its intent instead.`,
        );
    }
    for (const d of sketch.dimensions) {
      if (d.type === "horizontalDistance" || d.type === "verticalDistance") {
        connect(d.type === "horizontalDistance" ? "x" : "y", d.pointIds ?? []);
      } else if (d.type === "length" && d.entityIds.length === 1) {
        const line = sketch.entities[d.entityIds[0]];
        if (
          line?.type !== "line" ||
          (!horizontal.has(line.id) && !vertical.has(line.id))
        )
          return fail(
            `Dimension "${d.id}" requires a horizontal/vertical-constrained line for deformation.`,
          );
        connect(horizontal.has(line.id) ? "x" : "y", [
          line.startPointId,
          line.endPointId,
        ]);
      } else
        return fail(
          `Dimension "${d.id}" (${d.type}) is not supported by orthogonal deformation. Edit the dimension instead.`,
        );
    }
    const ids = (axis: "x" | "y") =>
      points
        .filter((p) => root(axis, p.id) === root(axis, pointId))
        .map((p) => p.id);
    const xIds = ids("x"),
      yIds = ids("y");
    const locked = (axis: "x" | "y", group: string[]) =>
      group.find((id) => {
        const p = sketch.entities[id];
        return (
          fixed.has(id) ||
          (p.type === "point" &&
            (Object.keys(p[axis].parameterRefs ?? {}).length > 0 ||
              collectExpressionDependencies(p[axis].expression).length > 0))
        );
      });
    return {
      xIds,
      yIds,
      pointIds: [...new Set([...xIds, ...yIds])],
      lockedX: locked("x", xIds),
      lockedY: locked("y", yIds),
    };
  } catch (error) {
    if (error instanceof DeformationReferenceError) return fail(error.message);
    throw error;
  }
}

export function deformedCanvasSketch(
  sketch: Sketch,
  solved: ResolvedSketch,
  pointId: string,
  target: CanvasPoint,
  plan = canvasDeformationPlan(sketch, solved, pointId),
) {
  assertEditableGeometry(sketch, [pointId, ...plan.pointIds]);
  if (plan.reason) throw new Error(plan.reason);
  if (
    ![target.x, target.y].every(Number.isFinite) ||
    Math.max(Math.abs(target.x), Math.abs(target.y)) > 1e8
  )
    throw new Error(
      "Deformation coordinates must be finite and within 100,000,000 mm.",
    );
  const anchor = solved.points[pointId];
  if (!anchor) throw new Error("Point reference lost. Select a current point.");
  const dx = target.x - anchor.x,
    dy = target.y - anchor.y;
  if (Math.abs(dx) > EPS && plan.lockedX)
    throw new Error(
      `X movement is blocked by fixed or parameter-bound point "${plan.lockedX}". Edit its intent instead.`,
    );
  if (Math.abs(dy) > EPS && plan.lockedY)
    throw new Error(
      `Y movement is blocked by fixed or parameter-bound point "${plan.lockedY}". Edit its intent instead.`,
    );
  const xIds = new Set(plan.xIds),
    yIds = new Set(plan.yIds),
    targets = new Map<string, CanvasPoint>();
  const entities = { ...sketch.entities };
  for (const id of plan.pointIds) {
    const point = solved.points[id],
      entity = entities[id];
    if (!point || entity?.type !== "point")
      throw new Error(`Point reference "${id}" is unavailable.`);
    const x = point.x + (xIds.has(id) && !plan.lockedX ? dx : 0),
      y = point.y + (yIds.has(id) && !plan.lockedY ? dy : 0);
    if (
      ![x, y].every(Number.isFinite) ||
      Math.max(Math.abs(x), Math.abs(y)) > 1e8
    )
      throw new Error("Deformed points must stay within 100,000,000 mm.");
    targets.set(id, { x, y });
    entities[id] = {
      ...entity,
      x:
        Math.abs(x - point.x) > EPS
          ? { expression: `${x.toFixed(12)}mm`, unit: "mm" }
          : entity.x,
      y:
        Math.abs(y - point.y) > EPS
          ? { expression: `${y.toFixed(12)}mm`, unit: "mm" }
          : entity.y,
    };
  }
  // Reversing an authored edge is a branch change, even if loop IDs survive.
  for (const line of solved.lines) {
    const a = targets.get(line.start.id) ?? line.start,
      b = targets.get(line.end.id) ?? line.end;
    if (
      Math.hypot(b.x - a.x, b.y - a.y) <= MIN_ENTITY_SIZE ||
      (line.end.x - line.start.x) * (b.x - a.x) +
        (line.end.y - line.start.y) * (b.y - a.y) <=
        0
    )
      throw new Error(
        `Deformation would collapse or reverse line "${line.id}". Keep its current branch.`,
      );
  }
  return {
    sketch: { ...sketch, entities },
    targets,
    unchanged: Math.hypot(dx, dy) <= EPS,
  };
}

export function validateCanvasDeformation(
  before: ResolvedSketch,
  after: ResolvedSketch,
  targets: Map<string, CanvasPoint>,
) {
  const error = after.errors.find((e) => e.severity === "error");
  if (error)
    throw new Error(
      `Deformation would invalidate the sketch: ${error.message}`,
    );
  for (const point of Object.values(before.points)) {
    const actual = after.points[point.id],
      expected = targets.get(point.id) ?? point;
    if (
      !actual ||
      Math.hypot(actual.x - expected.x, actual.y - expected.y) > EPS
    )
      throw new Error(
        "The solver would move other geometry or cannot honor the deformation. Reset the solve or edit dimensions instead.",
      );
  }
  const points = Object.values(after.points);
  for (const point of points)
    if (!before.points[point.id])
      throw new Error(`Deformation introduced unexpected point "${point.id}".`);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i],
        b = points[j];
      if (
        Math.hypot(a.x - b.x, a.y - b.y) <= EPS &&
        Math.hypot(
          before.points[a.id].x - before.points[b.id].x,
          before.points[a.id].y - before.points[b.id].y,
        ) > EPS
      )
        throw new Error(
          `Deformation would coincide points "${a.id}" and "${b.id}". Point IDs are never merged.`,
        );
    }
  const previous = detectProfiles(before),
    next = detectProfiles(after);
  if (
    !previous.errors.length &&
    (next.errors.length ||
      JSON.stringify(previous.profiles.map((p) => p.id).sort()) !==
        JSON.stringify(next.profiles.map((p) => p.id).sort()))
  )
    throw new Error(
      `Deformation would change sketch profile topology. ${next.errors[0] ?? "Repair feature references explicitly."}`,
    );
}
