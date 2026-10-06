import type { CadDocument, Sketch, ExpressionRef } from "../cad/document/schema";
import { upsertSketch } from "../cad/document/CadDocument";
import { collectExpressionDependencies, evaluateExpressionRef, evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { addConstraint } from "../cad/sketch/SketchModel";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { normalizeQuantity } from "../cad/parameters/units";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE } from "../cad/sketch/tolerances";

export interface SketchRefinement {
  /** Runtime-only identity of the immutable source revision; never saved. */
  base: CadDocument;
  document: CadDocument;
  sketchId: string;
  changes: string[];
  profileCount: number;
}
/** Deliberately bounded grammar. Unsupported text never falls through to a provider. */
export function buildSketchRefinement(document: CadDocument, sketchId: string, selection: readonly string[], prompt: string): SketchRefinement {
  if (prompt.length > 1000) throw new Error("Shorten this sketch request to 1,000 characters.");
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Sketch was removed. Open a current sketch.");
  if (Object.keys(sketch.entities).length > 512) throw new Error("Local refinement supports sketches with at most 512 entities. Use ordinary dimension/constraint controls for larger sketches.");
  if (selection.some((id) => !sketch.entities[id])) throw new Error("Selection changed. Reselect current geometry.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before refining a sketch.");
  const solved = solveSketch(sketch, evaluation.values);
  if (solved.errors.some((e) => e.severity === "error")) throw new Error("Repair sketch constraints before refining geometry.");
  const text = prompt.trim();
  const rectangle = /^(?:make|resize) (?:this|the|selected) rectangle (\d+(?:\.\d+)?)\s*(mm|cm|in)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|in)?\.?$/i.exec(text);
  const relation = /^make (?:these|the selected|selected) lines? (horizontal|vertical)\.?$/i.exec(text);
  let next: Sketch = sketch;
  const changes: string[] = [];
  const constrain = (id: string, type: "horizontal" | "vertical") => {
    if (!next.constraints.some((c) => c.type === type && c.entityIds.includes(id)))
      next = addConstraint(next, type, { entityIds: [id] });
  };
  if (rectangle) {
    const widthUnit = rectangle[2]?.toLowerCase() ?? rectangle[4]?.toLowerCase() ?? document.unitSettings.length;
    const heightUnit = rectangle[4]?.toLowerCase() ?? rectangle[2]?.toLowerCase() ?? document.unitSettings.length;
    const lengths = [normalizeQuantity(Number(rectangle[1]), widthUnit).value, normalizeQuantity(Number(rectangle[3]), heightUnit).value];
    if (lengths.some((length) => !Number.isFinite(length) || length <= MIN_ENTITY_SIZE || length > 1e8))
      throw new Error("Rectangle width and height must be positive and at most 100,000,000 mm.");
    const candidates = detectProfiles(solved).profiles.filter((p) => {
      const ids = p.outerLoop.entityIds;
      return !p.innerLoops.length && ids.length === 4 && ids.every((id) => sketch.entities[id]?.type === "line") &&
        (!selection.length || selection.every((id) => ids.includes(id) || ids.some((edgeId) => {
          const edge = sketch.entities[edgeId];
          return edge.type === "line" && (edge.startPointId === id || edge.endPointId === id);
        })));
    }).filter((p) => p.outerLoop.entityIds.every((id) => {
      const line = solved.lines.find((l) => l.id === id)!;
      return Math.abs(line.start.x - line.end.x) < SKETCH_TOLERANCE || Math.abs(line.start.y - line.end.y) < SKETCH_TOLERANCE;
    }));
    if (candidates.length !== 1) throw new Error("Select edges of one closed, axis-aligned rectangle. Rotated, nested or ambiguous regions are unsupported.");
    const ids = candidates[0].outerLoop.entityIds;
    const points = ids.flatMap((id) => {
      const edge = sketch.entities[id];
      return edge.type === "line" ? [edge.startPointId, edge.endPointId] : [];
    });
    const touches = (refs: string[]) => refs.some((id) => ids.includes(id) || points.includes(id));
    if (points.some((id) => {
      const point = sketch.entities[id];
      return point.type === "point" && [point.x, point.y].some((ref) => collectExpressionDependencies(ref.expression).length > 0);
    })) throw new Error("Rectangle coordinates are parameter-bound. Edit their parameters explicitly; refinement preserves bindings.");
    if (sketch.dimensions.some((d) => touches([...d.entityIds, ...(d.pointIds ?? [])]) && collectExpressionDependencies(d.expression.expression).length))
      throw new Error("Rectangle dimensions are parameter-bound. Edit their parameters explicitly; refinement preserves bindings.");
    if (sketch.dimensions.some((d) => touches([...d.entityIds, ...(d.pointIds ?? [])]) && (d.type !== "length" || d.entityIds.length !== 1 || !ids.includes(d.entityIds[0]))))
      throw new Error("This rectangle has other driving dimensions. Edit those dimensions explicitly to preserve design intent.");
    const width = `${rectangle[1]}${widthUnit}`;
    const height = `${rectangle[3]}${heightUnit}`;
    for (const [type, expression] of [["horizontal", width], ["vertical", height]] as const) {
      const sideIds = ids.filter((id) => {
        const line = solved.lines.find((l) => l.id === id)!;
        return type === "horizontal" ? Math.abs(line.start.y - line.end.y) < SKETCH_TOLERANCE : Math.abs(line.start.x - line.end.x) < SKETCH_TOLERANCE;
      });
      if (sideIds.length !== 2) throw new Error("Choose a rectangle with two horizontal and two vertical edges.");
      for (const id of sideIds) constrain(id, type);
      const existing = next.dimensions.filter((d) => d.type === "length" && sideIds.includes(d.entityIds[0]));
      if (existing.length) {
        for (const dimension of existing) next = withCanvasDimension(next, { id: dimension.id, type: "length", refs: dimension.entityIds, expression });
      } else next = withCanvasDimension(next, { type: "length", refs: [sideIds[0]], expression });
    }
    changes.push(`Rectangle width → ${width}`, `Rectangle height → ${height}`, "Preserve existing entity and dimension identities; add missing horizontal/vertical relations.");
  } else if (relation) {
    if (!selection.length || selection.some((id) => sketch.entities[id].type !== "line"))
      throw new Error("Select one or more lines before requesting horizontal or vertical relations.");
    if (selection.length > 32) throw new Error("Refine at most 32 selected lines at once.");
    const type = relation[1].toLowerCase() as "horizontal" | "vertical";
    for (const id of selection) constrain(id, type);
    changes.push(`Selected ${selection.length} line(s) → ${type}`);
  } else throw new Error('Supported requests: “make this rectangle 60 x 40 mm”, “make selected lines horizontal”, or “make selected lines vertical”. No provider request was sent.');
  const baseline = { ...sketch, solveMode: "driving" };
  const candidate = { ...next, solveMode: "driving" as const };
  if (JSON.stringify(candidate) === JSON.stringify(baseline)) throw new Error("These dimensions or relations are already present. The sketch is unchanged.");
  next = candidate;
  if (sketch.solveMode === "validate") changes.push("Activate dimension-driven solving while preserving existing expressions.");
  const refined = solveSketch(next, evaluation.values);
  const failure = refined.errors.find((e) => e.severity === "error");
  if (failure) throw new Error(`Refinement conflicts with existing design intent: ${failure.message}`);
  // Worker continuity seeds must not make Undo inherit the newly solved free
  // geometry. Publish unbound solved coordinates as explicit canonical seeds;
  // bound expressions remain authoritative and are never replaced.
  const entities = { ...next.entities };
  let reseeded = false;
  const seedRef = (ref: ExpressionRef, value: number) => {
    if (Object.keys(ref.parameterRefs ?? {}).length || collectExpressionDependencies(ref.expression).length) return ref;
    const authored = evaluateExpressionRef(ref, { parameters: evaluation.values }).quantity?.value;
    if (authored === undefined || Math.abs(authored - value) <= 1e-8) return ref;
    reseeded = true;
    return { expression: `${value.toFixed(12)}mm`, unit: "mm" };
  };
  for (const entity of Object.values(next.entities)) {
    if (entity.type === "point") {
      const point = refined.points[entity.id];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new Error(`Refinement is missing a valid solved point: ${entity.id}. Repair sketch geometry.`);
      entities[entity.id] = { ...entity, x: seedRef(entity.x, point.x), y: seedRef(entity.y, point.y) };
    } else if (entity.type === "circle") {
      const circle = refined.circles.find((c) => c.id === entity.id);
      if (circle) entities[entity.id] = { ...entity, radius: seedRef(entity.radius, circle.radius) };
    }
  }
  if (reseeded) {
    next = { ...next, entities };
    changes.push("Store solved unbound geometry as coordinate seeds so Undo restores the original shape.");
  }
  const profiles = detectProfiles(refined);
  if (rectangle && !profiles.profiles.length) throw new Error("Refinement did not produce a closed rectangle.");
  return { base: document, document: upsertSketch(document, next), sketchId, changes, profileCount: profiles.profiles.length };
}
