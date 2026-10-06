import type { CadDocument, Sketch, SketchEntity } from "../document/schema";
import { createId } from "../document/ids";
import { upsertSketch } from "../document/CadDocument";
import { collectExpressionDependencies, evaluateParameters } from "../parameters/expressionEvaluator";
import { solveSketch } from "./SketchSolver";
import { detectProfiles } from "./profileDetection";
import { entityPoints } from "./canvasPointMove";
import type { CanvasPoint } from "./canvasGeometry";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE as EPS } from "./tolerances";
import { analyticTrimIntersections, FULL_TURN, trimCurveIsArc, trimCurveIsLine, trimCurveParameter,
  trimCurvePointAt, trimCurveScale, trimPointDistance, wrapTrimAngle, type TrimCurve } from "./trimExtendIntersections";

export type TrimExtendMode = "trim" | "extend";
export interface SketchTrimExtendPlan {
  base: CadDocument;
  document: CadDocument;
  sketchId: string;
  /** Legacy field name; identifies a line, arc or circle target. */
  lineId: string;
  changes: string[];
}
function protectIntent(sketch: Sketch, id: string) {
  const points = entityPoints(sketch, id);
  const touched = (ids: string[]) => ids.some((ref) => ref === id || points.includes(ref) || entityPoints(sketch, ref).some((p) => points.includes(p)));
  const constraint = sketch.constraints.find((c) => touched([...c.entityIds, ...(c.pointIds ?? [])]));
  if (constraint) throw new Error(`Constraint ${constraint.id} protects this curve or its points. Edit or remove that constraint explicitly before trimming or extending.`);
  const dimension = sketch.dimensions.find((d) => touched([...d.entityIds, ...(d.pointIds ?? [])]));
  if (dimension) throw new Error(`Dimension ${dimension.id} protects this curve or its points. Edit or remove that dimension explicitly first.`);
  for (const pointId of points) {
    const point = sketch.entities[pointId];
    if (point?.type !== "point") throw new Error(`Point ${pointId} is missing. Repair the curve's point reference first.`);
    if ([point.x, point.y].some((ref) => Object.keys(ref.parameterRefs ?? {}).length || collectExpressionDependencies(ref.expression).length))
      throw new Error(`Point ${pointId} is parameter-bound. Edit its parameter expressions explicitly; trim and extend preserve bindings.`);
  }
  const entity = sketch.entities[id];
  if (entity.type === "circle" && (Object.keys(entity.radius.parameterRefs ?? {}).length || collectExpressionDependencies(entity.radius.expression).length))
    throw new Error(`Circle ${id} has a parameter-bound radius. Edit that binding explicitly before converting the circle to an arc.`);
}
function trimIntervals(curve: TrimCurve, selected: number, hits: number[]): [number, number][] {
  const scale = trimCurveScale(curve), tolerance = EPS / scale;
  if (!trimCurveIsLine(curve) && !trimCurveIsArc(curve)) {
    if (hits.length < 2) throw new Error("Circle Trim needs at least two distinct crossing contacts. A lone contact cannot choose a bounded segment.");
    if (hits.some((t) => Math.min(Math.abs(t - selected), FULL_TURN - Math.abs(t - selected)) <= tolerance))
      throw new Error("Pick inside a circle segment, away from an intersection.");
    const nextIndex = hits.findIndex((t) => t > selected), index = nextIndex < 0 ? 0 : nextIndex;
    const end = hits[index], start = hits[(index + hits.length - 1) % hits.length];
    return [[end, end + wrapTrimAngle(start - end)]];
  }
  const end = trimCurveIsLine(curve) ? 1 : Math.abs(curve.sweep);
  if (selected < -tolerance || selected > end + tolerance) throw new Error("Pick a segment within the selected curve to trim.");
  const cuts = [0, ...hits.filter((t) => t > tolerance && t < end - tolerance), end];
  if (cuts.length === 2) throw new Error("No finite intersections divide this curve. Use Delete to remove the whole curve.");
  if (cuts.some((t) => Math.abs(t - selected) <= tolerance)) throw new Error("Pick inside a segment, away from an intersection or endpoint.");
  const index = cuts.findIndex((t, i) => i > 0 && selected < t), intervals: [number, number][] = [];
  if (cuts[index - 1] > tolerance) intervals.push([0, cuts[index - 1]]);
  if (cuts[index] < end - tolerance) intervals.push([cuts[index], end]);
  return intervals;
}
function extendInterval(sketch: Sketch, id: string, curve: TrimCurve, pick: CanvasPoint, hits: number[]): [number, number][] {
  if (!trimCurveIsLine(curve) && !trimCurveIsArc(curve)) throw new Error("A circle has no endpoints to extend. Trim it into an arc first.");
  const entity = sketch.entities[id];
  if (entity.type !== "line" && entity.type !== "arc") throw new Error("Select a line or arc to extend.");
  const scale = trimCurveScale(curve), tolerance = EPS / scale;
  const projected = trimCurvePointAt(curve, trimCurveParameter(curve, pick));
  const startDistance = trimPointDistance(projected, curve.start), endDistance = trimPointDistance(projected, curve.end);
  if (Math.abs(startDistance - endDistance) <= EPS) throw new Error("Pick nearer the start or end to choose which endpoint to extend.");
  const start = startDistance < endDistance, end = trimCurveIsLine(curve) ? 1 : Math.abs(curve.sweep);
  const movedPointId = start ? entity.startPointId : entity.endPointId;
  const connected = Object.values(sketch.entities).find((candidate) => candidate.id !== id && candidate.type !== "point" && entityPoints(sketch, candidate.id).includes(movedPointId));
  if (connected) throw new Error(`Endpoint ${movedPointId} is shared with ${connected.id}. Separate or repair that connection explicitly before extending.`);
  if (hits.some((t) => Math.abs(t - (start ? 0 : end)) <= tolerance))
    throw new Error("This endpoint already meets a finite boundary. Choose the other endpoint or edit the connection explicitly.");
  if (trimCurveIsLine(curve)) {
    const candidate = start ? hits.filter((t) => t < -tolerance).at(-1) : hits.find((t) => t > end + tolerance);
    if (candidate === undefined) throw new Error("No finite line, arc or circle boundary meets this endpoint's extension.");
    return start ? [[candidate, 1]] : [[0, candidate]];
  }
  const outside = hits.filter((t) => t > end + tolerance && t < FULL_TURN - tolerance);
  const candidate = start ? outside.at(-1) : outside[0];
  if (candidate === undefined) throw new Error("No finite boundary meets this arc endpoint before a full turn. Circle conversion and full-turn arc extensions are unsupported.");
  return start ? [[candidate - FULL_TURN, end]] : [[0, candidate]];
}
export function buildSketchTrimExtend(document: CadDocument, sketchId: string, lineId: string, mode: TrimExtendMode, pick: CanvasPoint): SketchTrimExtendPlan {
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Sketch was removed. Open a current sketch.");
  if (Object.keys(sketch.entities).length > 512) throw new Error("Trim and extend support at most 512 sketch entities.");
  if (!Number.isFinite(pick.x) || !Number.isFinite(pick.y) || Math.max(Math.abs(pick.x), Math.abs(pick.y)) > 1e8)
    throw new Error("Pick coordinates must be finite and within 100,000,000 mm.");
  const source = sketch.entities[lineId];
  if (!source || source.type === "point") throw new Error("Select a line, arc or circle to trim, or a line/arc to extend.");
  if (mode === "extend" && source.type === "circle") throw new Error("A circle has no endpoints to extend. Trim it into an arc first.");
  protectIntent(sketch, lineId);
  if (document.features.some((f) => f.type === "revolve" && f.axis.type === "sketchLine" && f.axis.sketchId === sketchId && f.axis.lineId === lineId))
    throw new Error("This line is a revolve axis. Edit its references explicitly before trimming or extending.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before trimming or extending.");
  const solved = solveSketch(sketch, evaluation.values);
  if (solved.errors.some((e) => e.severity === "error")) throw new Error("Repair sketch constraints before trimming or extending.");
  const curves: TrimCurve[] = [...solved.lines, ...solved.arcs, ...solved.circles], curve = curves.find((candidate) => candidate.id === lineId);
  if (!curve || trimCurveScale(curve) <= MIN_ENTITY_SIZE) throw new Error("The selected curve is missing or too small to edit.");
  if (!trimCurveIsLine(curve) && trimPointDistance(pick, curve.center) <= EPS) throw new Error("Pick on the curve, away from its center; the center has no unique radial projection.");
  const scale = trimCurveScale(curve), tolerance = EPS / scale;
  const hits = curves.filter((boundary) => boundary.id !== lineId).flatMap((boundary) => analyticTrimIntersections(curve, boundary, mode === "extend"))
    .map((point) => trimCurveParameter(curve, point)).sort((a, b) => a - b)
    .reduce<number[]>((kept, value) => { if (!kept.length || Math.abs(value - kept[kept.length - 1]) > tolerance) kept.push(value); return kept; }, []);
  if (!trimCurveIsLine(curve) && hits.length > 1 && FULL_TURN - hits[hits.length - 1] + hits[0] <= tolerance) hits.pop();
  const intervals = mode === "trim" ? trimIntervals(curve, trimCurveParameter(curve, pick), hits) : extendInterval(sketch, lineId, curve, pick, hits);
  if (mode === "extend" && trimCurveIsLine(curve)) {
    const [a, b] = intervals[0], extended = { ...curve, start: { ...curve.start, ...trimCurvePointAt(curve, a) }, end: { ...curve.end, ...trimCurvePointAt(curve, b) } };
    // Disjoint collinear lines are not crossing contacts. Reject them only when the chosen finite extension would overlap them.
    for (const boundary of curves) if (boundary.id !== lineId) analyticTrimIntersections(extended, boundary, false);
  }
  if (intervals.some(([a, b]) => (b - a) * scale <= MIN_ENTITY_SIZE || (!trimCurveIsLine(curve) && b - a >= FULL_TURN - tolerance)))
    throw new Error("The edit would leave a zero-size or full-turn arc fragment. Pick another segment or boundary.");
  const entities: Record<string, SketchEntity> = { ...sketch.entities };
  const originalEnd = trimCurveIsLine(curve) ? 1 : trimCurveIsArc(curve) ? Math.abs(curve.sweep) : undefined;
  const endpoint = (t: number) => {
    if (source.type !== "circle") {
      if (Math.abs(t) <= tolerance) return source.startPointId;
      if (originalEnd !== undefined && Math.abs(t - originalEnd) <= tolerance) return source.endPointId;
    }
    const point = trimCurvePointAt(curve, t);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.max(Math.abs(point.x), Math.abs(point.y)) > 1e8)
      throw new Error("The boundary exceeds supported sketch coordinate limits.");
    // Centers and unrelated standalone points are never implicitly attached.
    const existing = curves.filter((boundary) => boundary.id !== lineId)
      .flatMap((boundary) => trimCurveIsLine(boundary) || trimCurveIsArc(boundary) ? [boundary.start, boundary.end] : []).find((p) => trimPointDistance(point, p) <= EPS);
    if (existing) return existing.id;
    const id = createId("point");
    entities[id] = { id, type: "point", x: { expression: `${point.x.toFixed(12)}mm`, unit: "mm" }, y: { expression: `${point.y.toFixed(12)}mm`, unit: "mm" } };
    return id;
  };
  intervals.forEach(([a, b], i) => {
    const id = i === 0 ? lineId : createId(source.type === "line" ? "line" : "arc"), startPointId = endpoint(a), endPointId = endpoint(b);
    entities[id] = source.type === "line" ? { ...source, id, startPointId, endPointId } :
      { id, type: "arc", centerPointId: source.centerPointId, startPointId, endPointId,
        clockwise: source.type === "arc" ? source.clockwise : false, ...(source.construction !== undefined ? { construction: source.construction } : {}) };
  });
  const retained = new Set(Object.values(entities).filter((e) => e.type !== "point").flatMap((e) => entityPoints({ ...sketch, entities }, e.id)));
  for (const ref of [...sketch.constraints, ...sketch.dimensions]) [...ref.entityIds, ...(ref.pointIds ?? [])].forEach((id) => retained.add(id));
  for (const feature of document.features) if (feature.type === "hole" && feature.sketchId === sketchId) feature.centerPointIds.forEach((id) => retained.add(id));
  for (const id of entityPoints(sketch, lineId)) if (!retained.has(id)) delete entities[id];
  const next = { ...sketch, entities }, nextSolved = solveSketch(next, evaluation.values);
  if (nextSolved.errors.some((e) => e.severity === "error")) throw new Error("The edited sketch cannot solve. Repair its constraints before applying.");
  const profiles = detectProfiles(nextSolved).profiles;
  for (const feature of document.features) {
    if ((feature.type === "extrude" || feature.type === "revolve") && feature.sketchId === sketchId &&
      !profiles.some((profile) => profile.id === feature.profileId || profile.alternateIds?.includes(feature.profileId)))
      throw new Error(`Feature ${feature.name} would lose profile ${feature.profileId}. Repair or change that feature's profile reference explicitly first.`);
  }
  return { base: document, document: upsertSketch(document, next), sketchId, lineId,
    changes: [mode === "trim" ? `Remove the picked ${source.type} segment; retain ${intervals.length} fragment(s).` : "Extend the chosen endpoint to its nearest finite analytic boundary.",
      ...(source.type === "circle" ? ["Convert the remaining circle segment to an arc, preserving its entity and center IDs."] : []),
      "Existing constraints, dimensions, parameter bindings and feature references are preserved."] };
}
