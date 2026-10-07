import { assertEditableGeometry } from "./projectedGeometry";
import { normalizeQuantity } from "../parameters/units";
import { MIN_ENTITY_SIZE } from "./tolerances";
import type { Sketch, SketchDimension, UnitSettings } from "../document/schema";
import type { ResolvedSketch } from "./SketchSolver";
import { formatMeasuredLength } from "../inspection/measurements";
import { createId } from "../document/ids";
import type { CanvasPoint } from "./canvasGeometry";
import { distance2d } from "./canvasGeometry";

export interface CanvasAnnotation {
  id: string;
  dimensionId?: string;
  label: string;
  title: string;
  position: CanvasPoint;
  lines: [CanvasPoint, CanvasPoint][];
  unavailable: boolean;
  anchored: boolean;
}
export interface CanvasDimensionInput {
  id?: string;
  type: SketchDimension["type"];
  refs: string[];
  expression: string;
  authoredUnit?: string;
}
export const CANVAS_DIMENSION_TYPES: SketchDimension["type"][] = [
  "length",
  "radius",
  "diameter",
  "horizontalDistance",
  "verticalDistance",
  "distance",
  "angle",
];
/** Reference selection measures solved geometry in internal millimeters. */
export function canvasEntitySize(solved: ResolvedSketch, id: string) {
  const line = solved.lines.find((entity) => entity.id === id);
  if (line)
    return { type: "length" as const, value: distance2d(line.start, line.end) };
  const curve = [...solved.circles, ...solved.arcs].find(
    (entity) => entity.id === id,
  );
  return curve ? { type: "radius" as const, value: curve.radius } : undefined;
}
/** Keep measured intent precise while displaying the same authored unit as the size field. */
export function canvasSizeExpression(mm: number, unit: UnitSettings["length"]) {
  if (!Number.isFinite(mm) || mm < 0 || mm > 1e8) return undefined;
  const decimal = (mm / normalizeQuantity(1, unit).value).toFixed(12);
  const value = decimal.replace(/0+$/, "").replace(/\.$/, "");
  return `${value || "0"}${unit}`;
}
export function pointDimension(type: SketchDimension["type"]) {
  return (
    type === "horizontalDistance" ||
    type === "verticalDistance" ||
    type === "distance"
  );
}
export function dimensionReferenceCount(type: SketchDimension["type"]) {
  return pointDimension(type) || type === "angle" ? 2 : 1;
}
export function withCanvasDimension(
  sketch: Sketch,
  input: CanvasDimensionInput,
): Sketch {
  const references = input.id ? sketch.dimensions.find((dimension) => dimension.id === input.id) : undefined;
  assertEditableGeometry(sketch, references ? [...references.entityIds, ...(references.pointIds ?? [])] : input.refs);
  if (!input.expression.trim())
    throw new Error("Dimension expression is required.");
  if (input.id) {
    const existing = sketch.dimensions.find((d) => d.id === input.id);
    if (!existing)
      throw new Error("Dimension reference lost. Select a current dimension.");
    if (
      existing.expression.expression === input.expression &&
      (input.authoredUnit === undefined ||
        existing.expression.authoredUnit === input.authoredUnit) &&
      sketch.solveMode !== "validate"
    )
      return sketch;
    return {
      ...sketch,
      solveMode: "driving",
      dimensions: sketch.dimensions.map((d) =>
        d.id === input.id
          ? {
              ...d,
              expression: {
                ...d.expression,
                expression: input.expression,
                ...(input.authoredUnit
                  ? { authoredUnit: input.authoredUnit }
                  : {}),
              },
            }
          : d,
      ),
    };
  }
  if (!CANVAS_DIMENSION_TYPES.includes(input.type))
    throw new Error("Unsupported canvas dimension type.");
  const { refs, type } = input;
  if (
    refs.length !== dimensionReferenceCount(type) ||
    new Set(refs).size !== refs.length
  )
    throw new Error("Choose distinct dimension references.");
  const expected = pointDimension(type)
    ? ["point"]
    : type === "radius" || type === "diameter"
      ? ["circle", "arc"]
      : ["line"];
  if (refs.some((id) => !expected.includes(sketch.entities[id]?.type)))
    throw new Error(
      "Dimension references are lost or incompatible. Reselect geometry.",
    );
  return {
    ...sketch,
    solveMode: "driving",
    dimensions: [
      ...sketch.dimensions,
      {
        id: createId("dimension"),
        type,
        entityIds: pointDimension(type) ? [] : refs,
        ...(pointDimension(type) ? { pointIds: refs } : {}),
        expression: {
          expression: input.expression,
          unit: type === "angle" ? "deg" : "mm",
          ...(input.authoredUnit ? { authoredUnit: input.authoredUnit } : {}),
        },
      },
    ],
  };
}
const prefixes: Record<SketchDimension["type"], string> = {
  length: "L",
  radius: "R",
  diameter: "Ø",
  distance: "d",
  horizontalDistance: "ΔX",
  verticalDistance: "ΔY",
  angle: "∠",
};
/** Annotations measure solved geometry. No authored parameter value substitutes for a failed solve. */
export function canvasAnnotations(
  sketch: Sketch,
  solved: ResolvedSketch,
  units: UnitSettings,
  span: number,
  showReference: boolean,
  pending = false,
): CanvasAnnotation[] {
  const offset = span / 45,
    failed = pending || solved.errors.some((e) => e.severity === "error");
  const annotation = (
    id: string,
    type: SketchDimension["type"],
    refs: string[],
    dimension?: SketchDimension,
    index?: number,
  ): CanvasAnnotation => {
    let value: number | undefined,
      a: CanvasPoint | undefined,
      b: CanvasPoint | undefined,
      lines: [CanvasPoint, CanvasPoint][] = [];
    if (type === "length") {
      const line = solved.lines.find((l) => l.id === refs[0]);
      a = line?.start;
      b = line?.end;
      if (a && b) value = distance2d(a, b);
    } else if (type === "radius" || type === "diameter") {
      const arc = solved.arcs.find((c) => c.id === refs[0]);
      const curve = arc ?? solved.circles.find((c) => c.id === refs[0]);
      if (curve) {
        const angle = arc ? arc.startAngle + arc.sweep / 2 : 0;
        const delta = {
          x: Math.cos(angle) * curve.radius,
          y: Math.sin(angle) * curve.radius,
        };
        a =
          type === "diameter" && !arc
            ? { x: curve.center.x - delta.x, y: curve.center.y - delta.y }
            : curve.center;
        b = { x: curve.center.x + delta.x, y: curve.center.y + delta.y };
        value = curve.radius * (type === "diameter" ? 2 : 1);
      }
    } else if (type === "angle") {
      const first = solved.lines.find((l) => l.id === refs[0]),
        second = solved.lines.find((l) => l.id === refs[1]);
      if (first && second) {
        const u = {
            x: first.end.x - first.start.x,
            y: first.end.y - first.start.y,
          },
          v = {
            x: second.end.x - second.start.x,
            y: second.end.y - second.start.y,
          };
        value =
          Math.hypot(u.x, u.y) > MIN_ENTITY_SIZE &&
          Math.hypot(v.x, v.y) > MIN_ENTITY_SIZE
            ? Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y)
            : undefined;
        a = {
          x: (first.start.x + first.end.x) / 2,
          y: (first.start.y + first.end.y) / 2,
        };
        b = {
          x: (second.start.x + second.end.x) / 2,
          y: (second.start.y + second.end.y) / 2,
        };
      }
    } else {
      a = solved.points[refs[0]];
      b = solved.points[refs[1]];
      if (a && b)
        value =
          type === "horizontalDistance"
            ? Math.abs(b.x - a.x)
            : type === "verticalDistance"
              ? Math.abs(b.y - a.y)
              : distance2d(a, b);
    }
    let position = { x: a ? a.x + offset : 0, y: a ? a.y + offset : 0 };
    if (a && b) {
      if (type === "radius" || type === "diameter") {
        lines = [[a, b]];
        position = { x: b.x + offset, y: b.y + offset };
      } else if (type === "horizontalDistance") {
        const y = Math.max(a.y, b.y) + offset,
          c = { x: a.x, y },
          d = { x: b.x, y };
        lines = [
          [a, c],
          [c, d],
          [b, d],
        ];
        position = { x: (a.x + b.x) / 2, y: y + offset / 3 };
      } else if (type === "verticalDistance") {
        const x = Math.max(a.x, b.x) + offset,
          c = { x, y: a.y },
          d = { x, y: b.y };
        lines = [
          [a, c],
          [c, d],
          [b, d],
        ];
        position = { x: x + offset / 3, y: (a.y + b.y) / 2 };
      } else if (type === "angle") {
        position = { x: (a.x + b.x) / 2 + offset, y: (a.y + b.y) / 2 + offset };
        lines = [
          [a, position],
          [b, position],
        ];
      } else {
        const length = distance2d(a, b) || 1,
          delta = {
            x: (-(b.y - a.y) / length) * offset,
            y: ((b.x - a.x) / length) * offset,
          };
        const c = { x: a.x + delta.x, y: a.y + delta.y },
          d = { x: b.x + delta.x, y: b.y + delta.y };
        lines = [
          [a, c],
          [c, d],
          [b, d],
        ];
        position = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 + offset / 3 };
      }
    }
    const unavailable =
      failed || value === undefined || !Number.isFinite(value);
    const text = unavailable
      ? "unavailable"
      : type === "angle"
        ? `${(units.angle === "rad" ? value! : (value! * 180) / Math.PI).toFixed(3)} ${units.angle}`
        : formatMeasuredLength(value!, units.length);
    const label = `${dimension ? `D${index! + 1} ` : ""}${prefixes[type]} ${text}`;
    const diagnostics = solved.errors
      .filter(
        (e) =>
          (dimension && e.constraintId === dimension.id) ||
          (!e.constraintId && e.severity === "error"),
      )
      .map((e) => e.message);
    return {
      id,
      ...(dimension ? { dimensionId: dimension.id } : {}),
      label,
      title: dimension
        ? `${dimension.type}: ${dimension.expression.expression}${pending ? " — rebuild pending" : ""}${diagnostics.length ? ` — ${diagnostics.join("; ")}` : ""}`
        : "Reference measurement; add a driving dimension to change geometry.",
      position,
      lines,
      unavailable,
      anchored: !!a && !!b,
    };
  };
  const result = sketch.dimensions.map((d, i) =>
    annotation(
      d.id,
      d.type,
      pointDimension(d.type) ? (d.pointIds ?? []) : d.entityIds,
      d,
      i,
    ),
  );
  if (showReference && !failed) {
    for (const line of solved.lines.filter((l) => !l.construction)) {
      if (
        !sketch.dimensions.some(
          (d) => d.type === "length" && d.entityIds.includes(line.id),
        )
      )
        result.push(annotation(`reference:${line.id}`, "length", [line.id]));
    }
    for (const curve of [...solved.circles, ...solved.arcs].filter(
      (c) => !c.construction,
    )) {
      if (
        !sketch.dimensions.some(
          (d) =>
            (d.type === "radius" || d.type === "diameter") &&
            d.entityIds.includes(curve.id),
        )
      )
        result.push(annotation(`reference:${curve.id}`, "radius", [curve.id]));
    }
  }
  return result;
}
