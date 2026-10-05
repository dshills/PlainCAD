import type { Sketch } from "../cad/document/schema";
import type { Quantity } from "../cad/parameters/units";
import { evaluateExpression } from "../cad/parameters/expressionEvaluator";
import {
  addCircleAt,
  addArc,
  addLine,
  addPoint,
} from "../cad/sketch/SketchModel";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE } from "../cad/sketch/tolerances";
import type { SketchProfile } from "../cad/sketch/profileDetection";
import type { AiProfile, AiSketchIntent } from "./plan";
import { addAiSketchIntent, type AiExpression } from "./sketchIntent";

function compileLoop(
  sketch: Sketch,
  p: Exclude<AiProfile, { type: "compound" }>,
  intent: AiSketchIntent | undefined,
  expr: AiExpression,
  parameters: Record<string, Quantity>,
) {
  const pointIds: string[] = [];
  const coordinate = (sketch: Sketch, id: string) => {
    const point = sketch.entities[id];
    if (point?.type !== "point")
      throw new Error("AI sketch has a missing point.");
    const x = evaluateExpression(point.x.expression, {
      parameters,
    });
    const y = evaluateExpression(point.y.expression, {
      parameters,
    });
    if (
      x.error ||
      y.error ||
      x.quantity?.dimension !== "length" ||
      y.quantity?.dimension !== "length" ||
      !Number.isFinite(x.quantity.value) ||
      !Number.isFinite(y.quantity.value)
    )
      throw new Error("AI point coordinates must be finite lengths.");
    return { x: x.quantity.value, y: y.quantity.value };
  };
  if (p.type === "points" || p.type === "polygon" || p.type === "wire") {
    for (const vertex of p.type === "points" ? p.points : p.vertices) {
      const point = addPoint(
        sketch,
        expr(vertex.x, "length").expression,
        expr(vertex.y, "length").expression,
      );
      sketch = point.sketch;
      pointIds.push(point.pointId);
    }
    if (p.type !== "points")
      for (let i = 0; i < pointIds.length; i++) {
        const edge = p.type === "wire" ? p.edges[i] : { type: "line" as const };
        const start = pointIds[i],
          end = pointIds[(i + 1) % pointIds.length];
        if (edge.type === "line") sketch = addLine(sketch, start, end).sketch;
        else {
          const center = addPoint(
            sketch,
            expr(edge.center.x, "length").expression,
            expr(edge.center.y, "length").expression,
          );
          // The driving solver may move free points to satisfy its intrinsic
          // equal-radius relation. Reject malformed authored AI arcs first.
          const c = coordinate(center.sketch, center.pointId),
            a = coordinate(center.sketch, start),
            b = coordinate(center.sketch, end);
          const r1 = Math.hypot(a.x - c.x, a.y - c.y),
            r2 = Math.hypot(b.x - c.x, b.y - c.y);
          if (r1 < MIN_ENTITY_SIZE || Math.abs(r1 - r2) > SKETCH_TOLERANCE)
            throw new Error(
              `AI sketch ${sketch.name}: arc center must be equidistant from both endpoints with a nonzero radius.`,
            );
          sketch = addArc(
            center.sketch,
            center.pointId,
            start,
            end,
            edge.clockwise,
          ).sketch;
        }
      }
  } else if (p.type === "circle")
    sketch = addCircleAt(
      sketch,
      expr(p.x, "length").expression,
      expr(p.y, "length").expression,
      expr(p.radius, "length", true).expression,
    );
  else {
    const x = expr(p.x, "length").expression,
      y = expr(p.y, "length").expression;
    const width = expr(p.width, "length", true).expression,
      height = expr(p.height, "length", true).expression;
    const ids: string[] = [];
    for (const [cx, cy] of [
      [`(${x}) - (${width}) / 2`, `(${y}) - (${height}) / 2`],
      [`(${x}) + (${width}) / 2`, `(${y}) - (${height}) / 2`],
      [`(${x}) + (${width}) / 2`, `(${y}) + (${height}) / 2`],
      [`(${x}) - (${width}) / 2`, `(${y}) + (${height}) / 2`],
    ]) {
      const point = addPoint(sketch, cx, cy);
      sketch = point.sketch;
      ids.push(point.pointId);
    }
    for (let i = 0; i < 4; i++)
      sketch = addLine(sketch, ids[i], ids[(i + 1) % 4]).sketch;
  }
  if (p.type === "points") {
    const positions = pointIds.map((id) => coordinate(sketch, id));
    if (
      positions.some((a, i) =>
        positions
          .slice(i + 1)
          .some((b) => Math.hypot(a.x - b.x, a.y - b.y) <= SKETCH_TOLERANCE),
      )
    )
      throw new Error(
        `AI sketch ${sketch.name}: coincident hole centers must be removed.`,
      );
  }
  sketch = addAiSketchIntent(sketch, p, intent, expr);
  return {
    sketch,
    pointIds,
    boundaries: [
      Object.values(sketch.entities)
        .filter((e) => e.type !== "point" && !e.construction)
        .map((e) => e.id),
    ],
  };
}
export function compileAiSketchProfile(
  sketch: Sketch,
  p: AiProfile,
  intent: AiSketchIntent | undefined,
  expr: AiExpression,
  parameters: Record<string, Quantity>,
) {
  if (p.type !== "compound")
    return compileLoop(sketch, p, intent, expr, parameters);
  if (intent)
    throw new Error(
      "AI compound profiles use each rectangle/circle loop's automatic intent; explicit indexed intent is not supported.",
    );
  let next = sketch;
  const boundaries: string[][] = [];
  for (const loop of [p.outer, ...p.holes]) {
    const result = compileLoop(
      { ...sketch, entities: {}, constraints: [], dimensions: [] },
      loop,
      undefined,
      expr,
      parameters,
    );
    const ids = new Set([
      ...Object.keys(next.entities),
      ...next.constraints.map((c) => c.id),
      ...next.dimensions.map((d) => d.id),
    ]);
    const incoming = [
      ...Object.keys(result.sketch.entities),
      ...result.sketch.constraints.map((c) => c.id),
      ...result.sketch.dimensions.map((d) => d.id),
    ];
    if (
      incoming.some((id) => ids.has(id)) ||
      new Set(incoming).size !== incoming.length
    )
      throw new Error(
        "AI compound generated duplicate identities. Generate a fresh proposal.",
      );
    next = {
      ...next,
      entities: { ...next.entities, ...result.sketch.entities },
      constraints: [...next.constraints, ...result.sketch.constraints],
      dimensions: [...next.dimensions, ...result.sketch.dimensions],
    };
    boundaries.push(...result.boundaries);
  }
  return { sketch: next, pointIds: [], boundaries };
}
export function assertAiCompoundProfile(
  boundaries: string[][],
  profile: SketchProfile | undefined,
) {
  const key = (ids: string[]) => [...new Set(ids)].sort().join("|");
  if (
    !profile ||
    key(profile.outerLoop.entityIds) !== key(boundaries[0]) ||
    profile.innerLoops.length !== boundaries.length - 1 ||
    boundaries
      .slice(1)
      .some(
        (ids) =>
          !profile.innerLoops.some((loop) => key(loop.entityIds) === key(ids)),
      )
  )
    throw new Error(
      "AI compound openings must be separate, strictly inside the outer loop, and preserve every authored boundary. Remove overlapping, touching or nested-island openings.",
    );
}
