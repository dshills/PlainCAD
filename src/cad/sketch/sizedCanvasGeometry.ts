import type { Sketch, UnitSettings } from "../document/schema";
import type { Quantity } from "../parameters/units";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import { addConstraint } from "./SketchModel";
import { solveSketch, type ResolvedSketch } from "./SketchSolver";
import {
  addCanvasGeometry,
  distance2d,
  type CanvasPoint,
  type CanvasTool,
} from "./canvasGeometry";
import { withCanvasDimension } from "./canvasDimensions";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE } from "./tolerances";

export interface CanvasSizeInput {
  width?: string;
  height?: string;
  diameter?: string;
  /** Transient creation mode; the document stores ordinary rectangle geometry. */
  rectangleMode?: "corner" | "center";
}
function readSize(
  expression: string,
  label: string,
  parameters: Record<string, Quantity>,
  unit: UnitSettings["length"],
) {
  const result = evaluateExpressionRef(
    { expression, authoredUnit: unit },
    { parameters },
  );
  if (
    result.error ||
    result.quantity?.dimension !== "length" ||
    !Number.isFinite(result.quantity.value)
  )
    throw new Error(
      `${label}: ${result.error ?? "enter a length or length parameter."}`,
    );
  if (result.quantity.value <= MIN_ENTITY_SIZE || result.quantity.value > 1e8)
    throw new Error(`${label} must be positive and at most 100,000,000 mm.`);
  return result.quantity.value;
}
/** Pointer direction chooses the quadrant. Bare sizes use the project's authored units. */
export function sizedCanvasPoints(
  tool: CanvasTool,
  input: CanvasPoint[],
  sizes: CanvasSizeInput,
  parameters: Record<string, Quantity>,
  unit: UnitSettings["length"],
): CanvasPoint[] {
  if (input.length !== 2 || (tool !== "rectangle" && tool !== "circle"))
    return input;
  const [a, b] = input;
  let end = b;
  const centered = tool === "rectangle" && sizes.rectangleMode === "center";
  if (tool === "rectangle")
    end = {
      x: sizes.width?.trim()
        ? a.x +
          (b.x < a.x ? -1 : 1) *
            readSize(sizes.width, "Width", parameters, unit) / (centered ? 2 : 1)
        : b.x,
      y: sizes.height?.trim()
        ? a.y +
          (b.y < a.y ? -1 : 1) *
            readSize(sizes.height, "Height", parameters, unit) / (centered ? 2 : 1)
        : b.y,
    };
  else if (sizes.diameter?.trim()) {
    const radius = readSize(sizes.diameter, "Diameter", parameters, unit) / 2;
    const distance = distance2d(a, b);
    end =
      distance > MIN_ENTITY_SIZE
        ? {
            x: a.x + ((b.x - a.x) * radius) / distance,
            y: a.y + ((b.y - a.y) * radius) / distance,
          }
        : { x: a.x + radius, y: a.y };
  }
  if (centered)
    return [
      { x: 2 * a.x - end.x, y: 2 * a.y - end.y },
      distance2d(end, b) <= SKETCH_TOLERANCE
        ? { ...end, pointId: b.pointId }
        : end,
    ];
  return [
    a,
    distance2d(end, b) <= SKETCH_TOLERANCE
      ? { ...end, pointId: b.pointId }
      : end,
  ];
}
/** Sized primitives and their driving intent form one history edit. Existing points stay put. */
export function addSizedCanvasGeometry(
  sketch: Sketch,
  solved: ResolvedSketch,
  tool: CanvasTool,
  input: CanvasPoint[],
  construction: boolean,
  clockwise: boolean,
  sizes: CanvasSizeInput,
  parameters: Record<string, Quantity>,
  unit: UnitSettings["length"],
) {
  const points = sizedCanvasPoints(tool, input, sizes, parameters, unit);
  const result = addCanvasGeometry(
    sketch,
    solved,
    tool,
    points,
    construction,
    clockwise,
  );
  const hasSizes =
    tool === "rectangle"
      ? Boolean(sizes.width?.trim() || sizes.height?.trim())
      : tool === "circle" && Boolean(sizes.diameter?.trim());
  if (!hasSizes) return result;
  let next = result.sketch;
  const entities = Object.values(next.entities).filter(
    (e) => !sketch.entities[e.id],
  );
  if (tool === "rectangle") {
    const lines = entities.filter((e) => e.type === "line");
    if (lines.length !== 4)
      throw new Error(
        "Size could not be applied: rectangle needs four new edges.",
      );
    const geometry = solveSketch(next, parameters);
    const roles = lines.map((line) => {
      const resolved = geometry.lines.find(
        (candidate) => candidate.id === line.id,
      );
      if (!resolved)
        throw new Error(
          "Size could not be applied: rectangle edge is unavailable.",
        );
      const horizontal =
        Math.abs(resolved.end.y - resolved.start.y) <= SKETCH_TOLERANCE;
      const vertical =
        Math.abs(resolved.end.x - resolved.start.x) <= SKETCH_TOLERANCE;
      if (horizontal === vertical)
        throw new Error(
          "Size could not be applied: rectangle edges must be orthogonal.",
        );
      return {
        id: line.id,
        type: horizontal ? ("horizontal" as const) : ("vertical" as const),
      };
    });
    for (const role of roles)
      next = addConstraint(next, role.type, { entityIds: [role.id] });
    for (const [role, expression] of [
      ["horizontal", sizes.width],
      ["vertical", sizes.height],
    ] as const) {
      if (expression?.trim()) {
        const edge = roles.find((candidate) => candidate.type === role);
        if (!edge)
          throw new Error(
            "Size could not be applied: rectangle side is unavailable.",
          );
        next = withCanvasDimension(next, {
          type: "length",
          refs: [edge.id],
          expression,
          authoredUnit: unit,
        });
      }
    }
  } else {
    const circle = entities.find((e) => e.type === "circle");
    if (!circle)
      throw new Error("Size could not be applied: circle was not created.");
    next = withCanvasDimension(next, {
      type: "diameter",
      refs: [circle.id],
      expression: sizes.diameter!,
      authoredUnit: unit,
    });
  }
  const resolved = solveSketch(next, parameters);
  const error = resolved.errors.find((e) => e.severity === "error");
  if (error) throw new Error(`Size could not be applied: ${error.message}`);
  for (const [id, before] of Object.entries(solved.points)) {
    const after = resolved.points[id];
    if (!after || distance2d(before, after) > SKETCH_TOLERANCE)
      throw new Error(
        "This size would move existing geometry. Choose a free corner or center.",
      );
  }
  return { ...result, sketch: next };
}
