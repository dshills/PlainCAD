import type { Sketch } from "../document/schema";
import type { ResolvedSketch } from "./SketchSolver";
import type { CanvasPoint } from "./canvasGeometry";

export const MAX_CANVAS_CONSTRAINT_REFERENCES = 750;
export const CONSTRAINT_REFERENCE_HINTS = {
  fixed: "One or more points or entities.",
  coincident: "At least two points, no entity references.",
  horizontal: "One or more lines, no point references.",
  vertical: "One or more lines, no point references.",
  parallel: "Exactly two lines, no point references.",
  perpendicular: "Exactly two lines, no point references.",
  equalLength: "At least two lines, no point references.",
  equalRadius: "At least two circles or arcs, no point references.",
  midpoint: "One line and one point.",
  symmetric:
    "Four ordered points: reflected point, matching point, axis start, axis end. No entity references.",
  tangent:
    "Two circles/arcs, or one line and one circle/arc. No point references.",
} as const;

export interface CanvasConstraintAnnotation {
  id: string;
  label: string;
  title: string;
  state:
    | "pending"
    | "satisfied"
    | "redundant"
    | "conflicting"
    | "lost"
    | "unavailable";
  position?: CanvasPoint;
  anchors: CanvasPoint[];
  references: string[];
}
const symbols = {
  fixed: "Fix",
  coincident: "Coin",
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⊥",
  tangent: "Tan",
  equalLength: "=L",
  equalRadius: "=R",
  midpoint: "Mid",
  symmetric: "Sym",
} as const;

export function canvasConstraintAnnotations(
  sketch: Sketch,
  solved: ResolvedSketch,
  span: number,
  pending = false,
): CanvasConstraintAnnotation[] {
  const lineById = new Map(solved.lines.map((l) => [l.id, l])),
    curveById = new Map(
      [...solved.circles, ...solved.arcs].map((c) => [c.id, c]),
    );
  return sketch.constraints.map((constraint, index) => {
    const refs = [...constraint.entityIds, ...(constraint.pointIds ?? [])];
    const lost = refs.some((id) => !sketch.entities[id]);
    const diagnostics = solved.errors.filter(
      (e) => e.constraintId === constraint.id,
    );
    const failed = solved.errors.some((e) => e.severity === "error");
    const anchors: CanvasPoint[] = [];
    if (!lost && !pending)
      for (const id of refs) {
        const point = solved.points[id],
          line = lineById.get(id),
          curve = curveById.get(id);
        const anchor =
          point ??
          (line
            ? {
                x: (line.start.x + line.end.x) / 2,
                y: (line.start.y + line.end.y) / 2,
              }
            : curve?.center);
        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y))
          anchors.push(anchor);
      }
    const state: CanvasConstraintAnnotation["state"] = lost
      ? "lost"
      : pending
        ? "pending"
        : solved.redundantConstraintIds.includes(constraint.id)
          ? "redundant"
          : diagnostics.some((e) => e.severity === "error")
            ? "conflicting"
            : failed || !refs.length || anchors.length !== refs.length
              ? "unavailable"
              : "satisfied";
    const offset = Math.max(1e-6, span / 55);
    const position =
      anchors.length === refs.length && anchors.length
        ? {
            x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length + offset,
            y:
              anchors.reduce((s, p) => s + p.y, 0) / anchors.length +
              offset * (2 + (index % 3)),
          }
        : undefined;
    return {
      id: constraint.id,
      label: `C${index + 1} ${symbols[constraint.type]} — ${state}`,
      title: `${constraint.type}${lost ? " — geometry reference lost" : ""}${pending ? " — waiting for current solve" : ""}${diagnostics.length ? ` — ${diagnostics.map((e) => e.message).join("; ")}` : ""}`,
      state,
      position,
      anchors: anchors.slice(0, 16),
      references: refs,
    };
  });
}

/** Reference repair preserves the constraint type, identity and unrelated design intent. */
export function withCanvasConstraintReferences(
  sketch: Sketch,
  id: string,
  entityIds: string[],
  pointIds: string[],
): Sketch {
  const existing = sketch.constraints.find((c) => c.id === id);
  if (!existing)
    throw new Error("Constraint reference lost. Select a current constraint.");
  if (!entityIds.length && !pointIds.length)
    throw new Error("Choose geometry references, or remove the constraint.");
  if (entityIds.length + pointIds.length > MAX_CANVAS_CONSTRAINT_REFERENCES)
    throw new Error(
      `Constraint repair exceeds the ${MAX_CANVAS_CONSTRAINT_REFERENCES} reference limit.`,
    );
  if (
    new Set(entityIds).size !== entityIds.length ||
    new Set(pointIds).size !== pointIds.length
  )
    throw new Error("Choose distinct references within each group.");
  for (const ref of entityIds)
    if (!sketch.entities[ref])
      throw new Error("Constraint geometry reference lost. Reselect it.");
  for (const ref of pointIds)
    if (sketch.entities[ref]?.type !== "point")
      throw new Error("Constraint point reference lost. Reselect a point.");
  const lines = entityIds.every((id) => sketch.entities[id].type === "line"),
    rounds = entityIds.every((id) =>
      ["circle", "arc"].includes(sketch.entities[id].type),
    ),
    count = entityIds.length,
    points = pointIds.length;
  let valid = false;
  switch (existing.type) {
    case "fixed":
      valid = count + points > 0;
      break;
    case "coincident":
      valid = count === 0 && points >= 2;
      break;
    case "horizontal":
    case "vertical":
      valid = count >= 1 && lines && points === 0;
      break;
    case "parallel":
    case "perpendicular":
      valid = count === 2 && lines && points === 0;
      break;
    case "equalLength":
      valid = count >= 2 && lines && points === 0;
      break;
    case "equalRadius":
      valid = count >= 2 && rounds && points === 0;
      break;
    case "midpoint":
      valid = count === 1 && lines && points === 1;
      break;
    case "symmetric":
      valid = count === 0 && points === 4;
      break;
    case "tangent":
      valid =
        count === 2 &&
        points === 0 &&
        (rounds ||
          (entityIds.filter((id) => sketch.entities[id].type === "line")
            .length === 1 &&
            entityIds.filter((id) =>
              ["circle", "arc"].includes(sketch.entities[id].type),
            ).length === 1));
      break;
  }
  if (!valid)
    throw new Error(
      `${existing.type} references: ${CONSTRAINT_REFERENCE_HINTS[existing.type]}`,
    );
  if (
    JSON.stringify(entityIds) === JSON.stringify(existing.entityIds) &&
    JSON.stringify(pointIds) === JSON.stringify(existing.pointIds ?? [])
  )
    return sketch;
  return {
    ...sketch,
    constraints: sketch.constraints.map((c) =>
      c.id === id
        ? {
            ...c,
            entityIds: [...entityIds],
            ...(pointIds.length || c.pointIds
              ? { pointIds: [...pointIds] }
              : {}),
          }
        : c,
    ),
  };
}
