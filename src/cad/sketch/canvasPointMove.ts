import type { Sketch } from "../document/schema";
import { collectExpressionDependencies } from "../parameters/expressionEvaluator";
import type { CanvasPoint } from "./canvasGeometry";

function entityPoints(sketch: Sketch, id: string): string[] {
  const entity = sketch.entities[id];
  if (!entity) return [];
  return entity.type === "point"
    ? [id]
    : entity.type === "circle"
      ? [entity.centerPointId]
      : entity.type === "line"
        ? [entity.startPointId, entity.endPointId]
        : [entity.centerPointId, entity.startPointId, entity.endPointId];
}
/** Conservative first point-move support keeps parameter and constraint intent intact. */
export function canvasPointMoveReason(
  sketch: Sketch,
  pointId: string,
): string | undefined {
  const point = sketch.entities[pointId];
  if (point?.type !== "point")
    return "Point reference lost. Select a current point.";
  if (
    [point.x, point.y].some(
      (ref) =>
        Object.keys(ref.parameterRefs ?? {}).length ||
        collectExpressionDependencies(ref.expression).length,
    )
  )
    return "This point uses parameters. Edit its coordinate expressions instead of dragging.";
  if (
    Object.values(sketch.entities).some(
      (e) => e.type === "arc" && entityPoints(sketch, e.id).includes(pointId),
    )
  )
    return "Arc points require coordinated radius/sweep editing. Use the sketch geometry and dimension controls.";
  if (
    sketch.constraints.some(
      (c) =>
        (c.pointIds ?? []).includes(pointId) ||
        c.entityIds.some((id) => entityPoints(sketch, id).includes(pointId)),
    )
  )
    return "This point participates in a constraint. Edit dimensions or constraints instead of dragging.";
  if (
    sketch.dimensions.some(
      (d) =>
        (d.pointIds ?? []).includes(pointId) ||
        ((d.type === "length" || d.type === "angle") &&
          d.entityIds.some((id) => entityPoints(sketch, id).includes(pointId))),
    )
  )
    return "This point participates in a driving distance or angle. Edit that dimension instead of dragging.";
}
export function movedCanvasPoint(
  sketch: Sketch,
  pointId: string,
  target: CanvasPoint,
): Sketch {
  const reason = canvasPointMoveReason(sketch, pointId);
  if (reason) throw new Error(reason);
  if (
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    Math.max(Math.abs(target.x), Math.abs(target.y)) > 1e8
  )
    throw new Error(
      "Point coordinates must be finite and within 100,000,000 mm.",
    );
  const point = sketch.entities[pointId];
  if (point.type !== "point") throw new Error("Point reference lost.");
  return {
    ...sketch,
    entities: {
      ...sketch.entities,
      [pointId]: {
        ...point,
        x: { expression: `${target.x.toFixed(12)}mm`, unit: "mm" },
        y: { expression: `${target.y.toFixed(12)}mm`, unit: "mm" },
      },
    },
  };
}
