import type { ExpressionRef, Sketch } from "../cad/document/schema";
import { createId } from "../cad/document/ids";
import {
  addConstraint,
  addLine,
  addPoint,
  setConstruction,
} from "../cad/sketch/SketchModel";
import type { AiProfile, AiSketchIntent } from "./plan";

export type AiExpression = (
  source: string,
  dimension: "length" | "angle",
  positive?: boolean | "nonNegative",
) => ExpressionRef;
/** Recipe indices refer only to authored points and boundary curves, before construction anchors. */
export function addAiSketchIntent(
  sketch: Sketch,
  profile: Exclude<AiProfile, { type: "compound" }>,
  intent: AiSketchIntent | undefined,
  expr: AiExpression,
): Sketch {
  const points = Object.values(sketch.entities)
    .filter((e) => e.type === "point")
    .map((e) => e.id);
  const curves = Object.values(sketch.entities)
    .filter((e) => e.type !== "point")
    .map((e) => e.id);
  const dimension = (
    next: Sketch,
    type: Sketch["dimensions"][number]["type"],
    entityIds: string[],
    pointIds: string[],
    expression: ExpressionRef,
  ): Sketch => ({
    ...next,
    dimensions: [
      ...next.dimensions,
      { id: createId("dimension"), type, entityIds, pointIds, expression },
    ],
  });
  if (profile.type === "rectangle") {
    if (
      points.length !== 4 ||
      curves.length !== 4 ||
      curves.some((id) => sketch.entities[id].type !== "line")
    )
      throw new Error("AI rectangle boundary mapping is invalid.");
    if (intent)
      throw new Error(
        "AI rectangles use automatic centered width/height design intent; omit explicit intent.",
      );
    const center = addPoint(
      sketch,
      expr(profile.x, "length").expression,
      expr(profile.y, "length").expression,
    );
    let next = setConstruction(center.sketch, center.pointId, true);
    const diagonal = addLine(next, points[0], points[2]);
    next = setConstruction(diagonal.sketch, diagonal.lineId, true);
    next = addConstraint(next, "fixed", { pointIds: [center.pointId] });
    next = addConstraint(next, "midpoint", {
      entityIds: [diagonal.lineId],
      pointIds: [center.pointId],
    });
    for (let i = 0; i < 4; i++)
      next = addConstraint(next, i % 2 ? "vertical" : "horizontal", {
        entityIds: [curves[i]],
      });
    next = dimension(
      next,
      "length",
      [curves[0]],
      [],
      expr(profile.width, "length", true),
    );
    return dimension(
      next,
      "length",
      [curves[1]],
      [],
      expr(profile.height, "length", true),
    );
  }
  if (profile.type === "circle") {
    if (
      points.length !== 1 ||
      curves.length !== 1 ||
      sketch.entities[curves[0]].type !== "circle"
    )
      throw new Error("AI circle boundary mapping is invalid.");
    if (intent)
      throw new Error(
        "AI circles use automatic fixed-center radius design intent; omit explicit intent.",
      );
    return dimension(
      addConstraint(sketch, "fixed", { pointIds: [points[0]] }),
      "radius",
      [curves[0]],
      [],
      expr(profile.radius, "length", true),
    );
  }
  if (!intent) return sketch;
  const references = (indices: number[], ids: string[], label: string) =>
    indices.map((index) => {
      const id = ids[index];
      if (!id)
        throw new Error(
          `AI sketch ${label} index ${index} does not identify an authored ${label}.`,
        );
      return id;
    });
  let next = sketch;
  for (const constraint of intent.constraints)
    next = addConstraint(next, constraint.type, {
      entityIds: references(constraint.entities, curves, "curve"),
      pointIds: references(constraint.points, points, "point"),
    });
  for (const d of intent.dimensions)
    next = dimension(
      next,
      d.type,
      references(d.entities, curves, "curve"),
      references(d.points, points, "point"),
      expr(
        d.value,
        d.type === "angle" ? "angle" : "length",
        d.type === "horizontalDistance" || d.type === "verticalDistance"
          ? "nonNegative"
          : true,
      ),
    );
  return next;
}
