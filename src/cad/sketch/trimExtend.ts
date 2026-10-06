import type { CadDocument, Sketch, SketchEntity } from "../document/schema";
import { createId } from "../document/ids";
import { upsertSketch } from "../document/CadDocument";
import { collectExpressionDependencies, evaluateParameters } from "../parameters/expressionEvaluator";
import { solveSketch, type ResolvedLine } from "./SketchSolver";
import { detectProfiles } from "./profileDetection";
import { entityPoints } from "./canvasPointMove";
import type { CanvasPoint } from "./canvasGeometry";
import { SKETCH_TOLERANCE as EPS } from "./tolerances";

export type TrimExtendMode = "trim" | "extend";
export interface SketchTrimExtendPlan {
  base: CadDocument;
  document: CadDocument;
  sketchId: string;
  lineId: string;
  changes: string[];
}
const cross = (a: CanvasPoint, b: CanvasPoint) => a.x * b.y - a.y * b.x;
const subtract = (a: CanvasPoint, b: CanvasPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a: CanvasPoint, b: CanvasPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const pointAt = (line: ResolvedLine, t: number) => ({
  x: line.start.x + (line.end.x - line.start.x) * t,
  y: line.start.y + (line.end.y - line.start.y) * t,
});
function lineParameter(line: ResolvedLine, point: CanvasPoint) {
  const delta = subtract(line.end, line.start);
  return ((point.x - line.start.x) * delta.x + (point.y - line.start.y) * delta.y) /
    (delta.x * delta.x + delta.y * delta.y);
}
/** All boundaries are finite authored lines. Extending the selected support line
 * never extends a boundary line implicitly. */
function contacts(target: ResolvedLine, lines: ResolvedLine[]) {
  const r = subtract(target.end, target.start), length = Math.hypot(r.x, r.y);
  const hits: number[] = [];
  for (const boundary of lines) {
    if (boundary.id === target.id) continue;
    const s = subtract(boundary.end, boundary.start), otherLength = Math.hypot(s.x, s.y);
    if (otherLength <= EPS) continue;
    const q = subtract(boundary.start, target.start), determinant = cross(r, s);
    if (Math.abs(determinant) <= Number.EPSILON * length * otherLength * 32) {
      if (Math.abs(cross(q, r)) / length <= EPS) {
        const a = lineParameter(target, boundary.start), b = lineParameter(target, boundary.end);
        if (Math.min(a, b) < 1 - EPS / length && Math.max(a, b) > EPS / length)
          throw new Error(`Line ${boundary.id} overlaps the selected line. Separate duplicate or overlapping boundaries first.`);
      }
      continue;
    }
    const t = cross(q, s) / determinant, u = cross(q, r) / determinant;
    if (u >= -EPS / otherLength && u <= 1 + EPS / otherLength && Number.isFinite(t)) hits.push(t);
  }
  return hits.sort((a, b) => a - b).filter((value, index, values) => !index || Math.abs(value - values[index - 1]) * length > EPS);
}
function protectIntent(sketch: Sketch, lineId: string) {
  const points = entityPoints(sketch, lineId);
  const touched = (ids: string[]) => ids.some((id) => id === lineId || points.includes(id) || entityPoints(sketch, id).some((p) => points.includes(p)));
  const constraint = sketch.constraints.find((c) => touched([...c.entityIds, ...(c.pointIds ?? [])]));
  if (constraint) throw new Error(`Constraint ${constraint.id} protects this line or its endpoints. Edit or remove that constraint explicitly before trimming or extending.`);
  const dimension = sketch.dimensions.find((d) => touched([...d.entityIds, ...(d.pointIds ?? [])]));
  if (dimension) throw new Error(`Dimension ${dimension.id} protects this line or its endpoints. Edit or remove that dimension explicitly first.`);
  for (const id of points) {
    const point = sketch.entities[id];
    if (point?.type !== "point") throw new Error(`Endpoint ${id} is missing. Repair the line's point reference first.`);
    if ([point.x, point.y].some((ref) =>
      Object.keys(ref.parameterRefs ?? {}).length || collectExpressionDependencies(ref.expression).length))
      throw new Error(`Point ${id} is parameter-bound. Edit its parameter expressions explicitly; trim and extend preserve bindings.`);
  }
}
export function buildSketchTrimExtend(document: CadDocument, sketchId: string, lineId: string, mode: TrimExtendMode, pick: CanvasPoint): SketchTrimExtendPlan {
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Sketch was removed. Open a current sketch.");
  if (Object.keys(sketch.entities).length > 512) throw new Error("Trim and extend support at most 512 sketch entities.");
  if (!Number.isFinite(pick.x) || !Number.isFinite(pick.y) || Math.max(Math.abs(pick.x), Math.abs(pick.y)) > 1e8)
    throw new Error("Pick coordinates must be finite and within 100,000,000 mm.");
  const source = sketch.entities[lineId];
  if (source?.type !== "line") throw new Error("Select a line. Arc and circle trim/extend are not supported yet.");
  protectIntent(sketch, lineId);
  if (document.features.some((f) => f.type === "revolve" && f.axis.type === "sketchLine" && f.axis.sketchId === sketchId && f.axis.lineId === lineId))
    throw new Error("This line is a revolve axis. Edit its references explicitly before trimming or extending.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before trimming or extending.");
  const solved = solveSketch(sketch, evaluation.values);
  if (solved.errors.some((e) => e.severity === "error")) throw new Error("Repair sketch constraints before trimming or extending.");
  const line = solved.lines.find((candidate) => candidate.id === lineId);
  if (!line || distance(line.start, line.end) <= EPS) throw new Error("The selected line is missing or too short to edit.");
  const length = distance(line.start, line.end), selectedT = lineParameter(line, pick);
  const hits = contacts(line, solved.lines);
  let intervals: [number, number][];
  if (mode === "trim") {
    if (selectedT < -EPS / length || selectedT > 1 + EPS / length) throw new Error("Pick a segment within the selected line to trim.");
    const cuts = [0, ...hits.filter((t) => t > EPS / length && t < 1 - EPS / length), 1];
    if (cuts.length === 2) throw new Error("No line intersections divide this line. Use Delete to remove the whole line; arcs and circles are not trim boundaries yet.");
    if (cuts.some((t) => Math.abs(t - selectedT) * length <= EPS)) throw new Error("Pick inside a segment, away from an intersection or endpoint.");
    const index = cuts.findIndex((t, i) => i > 0 && selectedT < t);
    intervals = [];
    if (cuts[index - 1] > EPS / length) intervals.push([0, cuts[index - 1]]);
    if (cuts[index] < 1 - EPS / length) intervals.push([cuts[index], 1]);
  } else {
    if (Math.abs(selectedT - 0.5) * length <= EPS) throw new Error("Pick nearer the start or end to choose which endpoint to extend.");
    const start = selectedT < 0.5;
    const movedPointId = start ? source.startPointId : source.endPointId;
    const connected = Object.values(sketch.entities).find((entity) => entity.id !== lineId && entity.type !== "point" && entityPoints(sketch, entity.id).includes(movedPointId));
    if (connected) throw new Error(`Endpoint ${movedPointId} is shared with ${connected.id}. Separate or repair that connection explicitly before extending.`);
    if (hits.some((t) => Math.abs(t - (start ? 0 : 1)) * length <= EPS))
      throw new Error("This endpoint already meets a finite line boundary. Choose the other endpoint or edit the connection explicitly.");
    const candidate = start ? hits.filter((t) => t < -EPS / length).at(-1) : hits.find((t) => t > 1 + EPS / length);
    if (candidate === undefined) throw new Error("No finite line boundary meets this endpoint's extension. Arc and circle boundaries are not supported yet.");
    intervals = start ? [[candidate, 1]] : [[0, candidate]];
  }
  const entities: Record<string, SketchEntity> = { ...sketch.entities };
  const endpoint = (t: number) => {
    if (Math.abs(t) * length <= EPS) return source.startPointId;
    if (Math.abs(t - 1) * length <= EPS) return source.endPointId;
    const point = pointAt(line, t);
    if (Math.max(Math.abs(point.x), Math.abs(point.y)) > 1e8) throw new Error("The boundary exceeds supported sketch coordinate limits.");
    // Reuse only authored endpoints of the finite line boundaries. A coincident
    // standalone point or an arc/circle center is not an authored line junction.
    const existing = solved.lines.filter((boundary) => boundary.id !== lineId)
      .flatMap((boundary) => [boundary.start, boundary.end]).find((p) => distance(point, p) <= EPS);
    if (existing) return existing.id;
    const id = createId("point");
    entities[id] = { id, type: "point", x: { expression: `${point.x.toFixed(12)}mm`, unit: "mm" }, y: { expression: `${point.y.toFixed(12)}mm`, unit: "mm" } };
    return id;
  };
  intervals.forEach(([a, b], i) => {
    const id = i === 0 ? lineId : createId("line");
    entities[id] = { ...source, id, startPointId: endpoint(a), endPointId: endpoint(b) };
  });
  // Clean only superseded target endpoints, preserving standalone points and
  // every surviving curve, constraint, dimension and feature-center reference.
  const retained = new Set(Object.values(entities).filter((e) => e.type !== "point").flatMap((e) => entityPoints({ ...sketch, entities }, e.id)));
  for (const ref of [...sketch.constraints, ...sketch.dimensions]) [...ref.entityIds, ...(ref.pointIds ?? [])].forEach((id) => retained.add(id));
  for (const feature of document.features) if (feature.type === "hole" && feature.sketchId === sketchId) feature.centerPointIds.forEach((id) => retained.add(id));
  for (const id of [source.startPointId, source.endPointId]) if (!retained.has(id)) delete entities[id];
  const next = { ...sketch, entities }, nextSolved = solveSketch(next, evaluation.values);
  if (nextSolved.errors.some((e) => e.severity === "error")) throw new Error("The edited sketch cannot solve. Repair its constraints before applying.");
  const profiles = detectProfiles(nextSolved).profiles;
  for (const feature of document.features) {
    if ((feature.type === "extrude" || feature.type === "revolve") && feature.sketchId === sketchId &&
      !profiles.some((profile) => profile.id === feature.profileId || profile.alternateIds?.includes(feature.profileId)))
      throw new Error(`Feature ${feature.name} would lose profile ${feature.profileId}. Repair or change that feature's profile reference explicitly first.`);
  }
  return { base: document, document: upsertSketch(document, next), sketchId, lineId,
    changes: [mode === "trim" ? `Remove the picked line segment; retain ${intervals.length} fragment(s).` : "Extend the chosen endpoint to its nearest finite line boundary.",
      "Existing constraints, dimensions, parameter bindings and feature references are preserved."] };
}
