import { assertEditableGeometry } from "./projectedGeometry";
import type { Sketch } from "../document/schema";
import { collectExpressionDependencies } from "../parameters/expressionEvaluator";
import type { CanvasPoint } from "./canvasGeometry";
import { entityPoints } from "./canvasPointMove";
import { detectProfiles } from "./profileDetection";
import type { ResolvedSketch } from "./SketchSolver";
import { ANGULAR_TOLERANCE, SKETCH_TOLERANCE as EPS } from "./tolerances";

export const MAX_TRANSLATION_POINTS = 80;
export interface CanvasTranslationGroup {
  pointIds: string[];
  reason?: string;
}

/** Connected entities, design-intent references and solved endpoint/T-junction
 * contacts move together. This is a rigid translation, not free deformation. */
export function canvasTranslationGroup(
  sketch: Sketch,
  solved: ResolvedSketch,
  pointId: string,
): CanvasTranslationGroup {
  const points = Object.values(sketch.entities).filter(
      (e) => e.type === "point",
    ),
    parent = new Map(points.map((p) => [p.id, p.id]));
  const fail = (
    reason: string,
    pointIds: string[] = [],
  ): CanvasTranslationGroup => ({ pointIds, reason });
  if (!parent.has(pointId) || !solved.points[pointId])
    return fail("Point reference lost. Select a current point.");
  if (solved.errors.some((e) => e.severity === "error"))
    return fail("Repair sketch diagnostics before translating a group.");
  const root = (id: string): string => {
    let r = id;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    while (id !== r) {
      const next = parent.get(id)!;
      parent.set(id, r);
      id = next;
    }
    return r;
  };
  const connect = (ids: string[]) => {
    if (ids.some((id) => !parent.has(id))) return false;
    for (const id of ids.slice(1)) parent.set(root(id), root(ids[0]));
    return true;
  };
  for (const e of Object.values(sketch.entities))
    if (!connect(entityPoints(sketch, e.id)))
      return fail(
        "Sketch geometry reference lost. Repair it before translating.",
      );
  for (const c of [...sketch.constraints, ...sketch.dimensions]) {
    if (
      c.entityIds.some((id) => !sketch.entities[id]) ||
      !connect([
        ...c.entityIds.flatMap((id) => entityPoints(sketch, id)),
        ...(c.pointIds ?? []),
      ])
    )
      return fail(
        `Constraint or dimension "${c.id}" has a lost reference. Repair it before translating.`,
      );
  }
  // Import limits bound this scan to 750 entities. Sorted X and segment bounds
  // avoid distance/projection work on unrelated geometry; the UI memoizes it.
  const resolved = Object.values(solved.points).sort((a, b) => a.x - b.x);
  for (let i = 0; i < resolved.length; i++)
    for (
      let j = i + 1;
      j < resolved.length && resolved[j].x - resolved[i].x <= EPS;
      j++
    )
      if (
        Math.hypot(
          resolved[i].x - resolved[j].x,
          resolved[i].y - resolved[j].y,
        ) <= EPS
      )
        connect([resolved[i].id, resolved[j].id]);
  for (const l of solved.lines) {
    const dx = l.end.x - l.start.x,
      dy = l.end.y - l.start.y,
      length = dx * dx + dy * dy,
      minX = Math.min(l.start.x, l.end.x) - EPS,
      maxX = Math.max(l.start.x, l.end.x) + EPS,
      minY = Math.min(l.start.y, l.end.y) - EPS,
      maxY = Math.max(l.start.y, l.end.y) + EPS;
    if (!length) continue;
    for (const p of resolved) {
      if (p.x > maxX) break;
      if (p.x < minX || p.y < minY || p.y > maxY) continue;
      const t = ((p.x - l.start.x) * dx + (p.y - l.start.y) * dy) / length;
      if (
        t >= 0 &&
        t <= 1 &&
        Math.hypot(p.x - l.start.x - t * dx, p.y - l.start.y - t * dy) <= EPS
      )
        connect([l.start.id, l.end.id, p.id]);
    }
  }
  const ids = points
      .filter((p) => root(p.id) === root(pointId))
      .map((p) => p.id)
      .sort(),
    included = new Set(ids);
  if (ids.length > MAX_TRANSLATION_POINTS)
    return fail(
      `Connected group exceeds the ${MAX_TRANSLATION_POINTS} point translation limit. Split the sketch.`,
      ids,
    );
  for (const id of ids) {
    const p = sketch.entities[id];
    if (p.type !== "point" || !solved.points[id])
      return fail(
        "Connected geometry is unavailable. Repair the sketch first.",
        ids,
      );
    if (
      [p.x, p.y].some(
        (ref) =>
          Object.keys(ref.parameterRefs ?? {}).length ||
          collectExpressionDependencies(ref.expression).length,
      )
    )
      return fail(
        "This connected group has parameter-bound coordinates. Edit their expressions instead of translating.",
        ids,
      );
  }
  if (
    sketch.constraints.some(
      (c) =>
        c.type === "fixed" &&
        [
          ...(c.pointIds ?? []),
          ...c.entityIds.flatMap((id) => entityPoints(sketch, id)),
        ].some((id) => included.has(id)),
    )
  )
    return fail(
      "This connected group is fixed. Repair or remove the fixed constraint before translating.",
      ids,
    );
  return { pointIds: ids };
}

export function translatedCanvasGroup(
  sketch: Sketch,
  solved: ResolvedSketch,
  pointId: string,
  target: CanvasPoint,
) {
  const group = canvasTranslationGroup(sketch, solved, pointId);
  if (group.reason) throw new Error(group.reason);
  assertEditableGeometry(sketch, [pointId, ...group.pointIds]);
  const anchor = solved.points[pointId],
    dx = target.x - anchor.x,
    dy = target.y - anchor.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    throw new Error("Translation coordinates must be finite.");
  const targets = new Map(
    group.pointIds.map((id) => {
      const p = solved.points[id],
        next = { x: p.x + dx, y: p.y + dy };
      if (
        !Number.isFinite(next.x) ||
        !Number.isFinite(next.y) ||
        Math.max(Math.abs(next.x), Math.abs(next.y)) > 1e8
      )
        throw new Error("Translated points must stay within 100,000,000 mm.");
      return [id, next] as const;
    }),
  );
  const entities = { ...sketch.entities };
  for (const [id, p] of targets) {
    const entity = entities[id];
    if (entity.type !== "point") throw new Error("Point reference lost.");
    entities[id] = {
      ...entity,
      x: { expression: `${p.x.toFixed(12)}mm`, unit: "mm" },
      y: { expression: `${p.y.toFixed(12)}mm`, unit: "mm" },
    };
  }
  return {
    sketch: { ...sketch, entities },
    targets,
    unchanged: Math.hypot(dx, dy) <= EPS,
  };
}

export function validateCanvasTranslation(
  before: ResolvedSketch,
  after: ResolvedSketch,
  targets: Map<string, CanvasPoint>,
): void {
  const error = after.errors.find((e) => e.severity === "error");
  if (error)
    throw new Error(
      `Translation would invalidate the sketch: ${error.message}`,
    );
  for (const p of Object.values(before.points)) {
    const actual = after.points[p.id],
      expected = targets.get(p.id) ?? p;
    if (
      !actual ||
      Math.hypot(actual.x - expected.x, actual.y - expected.y) > EPS
    )
      throw new Error(
        "The solver would deform the group or move other geometry. Reset the solve or edit dimensions instead.",
      );
  }
  for (const c of before.circles) {
    const actual = after.circles.find((a) => a.id === c.id);
    if (!actual || Math.abs(actual.radius - c.radius) > EPS)
      throw new Error(
        "The solver would change a circle's radius. Edit dimensions instead.",
      );
  }
  for (const arc of before.arcs) {
    const actual = after.arcs.find((a) => a.id === arc.id);
    if (
      !actual ||
      Math.abs(actual.radius - arc.radius) > EPS ||
      Math.abs(actual.sweep - arc.sweep) > ANGULAR_TOLERANCE
    )
      throw new Error(
        "The solver would change an arc's radius or sweep. Edit dimensions instead.",
      );
  }
  for (const id of targets.keys())
    for (const outside of Object.values(after.points))
      if (
        !targets.has(outside.id) &&
        Math.hypot(
          after.points[id].x - outside.x,
          after.points[id].y - outside.y,
        ) <= EPS
      )
        throw new Error(
          `Translation would coincide point "${id}" with other geometry. Point IDs are never merged.`,
        );
  const previous = detectProfiles(before),
    next = detectProfiles(after);
  if (
    !previous.errors.length &&
    (next.errors.length ||
      JSON.stringify(previous.profiles.map((p) => p.id).sort()) !==
        JSON.stringify(next.profiles.map((p) => p.id).sort()))
  )
    throw new Error(
      `Translation would change sketch profile topology. ${next.errors[0] ?? "Move the group within its current region or repair feature references explicitly."}`,
    );
}
