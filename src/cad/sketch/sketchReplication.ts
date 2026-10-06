import type { CadDocument, ExpressionRef, Sketch, SketchEntity } from "../document/schema";
import { createId } from "../document/ids";
import { upsertSketch } from "../document/CadDocument";
import { evaluateExpressionRef, evaluateParameters, collectExpressionDependencies } from "../parameters/expressionEvaluator";
import { solveSketch, type ResolvedSketch } from "./SketchSolver";
import { detectProfiles } from "./profileDetection";
import { sketchPointReferences } from "./entityReferences";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE } from "./tolerances";
import { assertProjectJsonShape, PROJECT_IMPORT_LIMITS } from "../../persistence/importSafety";

export type SketchReplicationMode = "mirror" | "linear";
export type SketchReplicationInput = { mode: "mirror"; axisLineId: string } | {
  mode: "linear"; count: number; spacing: string; direction: "X" | "Y" | "vector"; vector?: { x: number; y: number };
};
export interface SketchReplicationCopy {
  entityIds: Record<string, string>;
  constraintIds: Record<string, string>;
  dimensionIds: Record<string, string>;
}
export interface SketchReplicationPlan {
  base: CadDocument;
  document: CadDocument;
  sketchId: string;
  selectedIds: string[];
  mode: SketchReplicationMode;
  copies: SketchReplicationCopy[];
  addedEntityIds: string[];
  profileCount: number;
  solved: ResolvedSketch;
  changes: string[];
}
export const MAX_SKETCH_REPLICATION_COUNT = 16;
export const MAX_SKETCH_REPLICATION_SELECTION = 64;
const MAX_COORDINATE = 1e8;
const scalar = (value: number) => value.toFixed(16).replace(/\.?0+$/, "") || "0";
const literal = (value: number): ExpressionRef => ({ expression: `${scalar(value)}mm`, unit: "mm" });
function hasBinding(ref: ExpressionRef) { return Object.keys(ref.parameterRefs ?? {}).length > 0 || collectExpressionDependencies(ref.expression).length > 0; }
/** Bind only newly authored copy expressions, preserving existing stable binding IDs. */
function expression(document: CadDocument, text: string, refs: ExpressionRef[]): ExpressionRef {
  const parameterRefs: Record<string, string> = {};
  for (const ref of refs) for (const [name, id] of Object.entries(ref.parameterRefs ?? {})) {
    if (parameterRefs[name] && parameterRefs[name] !== id) throw new Error(`Coordinate bindings disagree for ${name}. Repair the source expressions before copying.`);
    parameterRefs[name] = id;
  }
  for (const name of collectExpressionDependencies(text)) {
    if (!parameterRefs[name] && document.parameters[name]) parameterRefs[name] = document.parameters[name].id;
  }
  return { expression: text, unit: "mm", ...(Object.keys(parameterRefs).length ? { parameterRefs } : {}) };
}
interface Transform { xx: number; xy: number; yx: number; yy: number; tx: number; ty: number; swapAxes: boolean; axisAligned: boolean; spacing?: ExpressionRef; dx?: number; dy?: number; }
function transformInput(document: CadDocument, sketch: Sketch, solved: ResolvedSketch, input: SketchReplicationInput): { transforms: Transform[]; sourcesExcluded: string[] } {
  if (input.mode === "mirror") {
    const axis = solved.lines.find((line) => line.id === input.axisLineId);
    if (!axis || sketch.entities[input.axisLineId]?.type !== "line") throw new Error("Choose a current sketch line or construction line as the mirror axis.");
    const length = Math.hypot(axis.end.x - axis.start.x, axis.end.y - axis.start.y);
    if (length <= MIN_ENTITY_SIZE) throw new Error("Mirror axis must have a nonzero length.");
    const x = (axis.end.x - axis.start.x) / length, y = (axis.end.y - axis.start.y) / length;
    let xx = 2 * x * x - 1, xy = 2 * x * y, yy = 2 * y * y - 1;
    const tidy = (value: number) => Math.abs(value) < Number.EPSILON * 16 ? 0 : Math.abs(Math.abs(value) - 1) < Number.EPSILON * 16 ? Math.sign(value) : value;
    xx = tidy(xx); xy = tidy(xy); yy = tidy(yy);
    return { sourcesExcluded: [input.axisLineId], transforms: [{ xx, xy, yx: xy, yy, tx: axis.start.x - xx * axis.start.x - xy * axis.start.y, ty: axis.start.y - xy * axis.start.x - yy * axis.start.y, swapAxes: xx === 0 && yy === 0, axisAligned: xy === 0 || (xx === 0 && yy === 0) }] };
  }
  if (!Number.isInteger(input.count) || input.count < 2 || input.count > MAX_SKETCH_REPLICATION_COUNT) throw new Error(`Total pattern count must be an integer from 2 to ${MAX_SKETCH_REPLICATION_COUNT}, including the source.`);
  if (!input.spacing.trim() || input.spacing.length > 120) throw new Error("Enter a spacing expression of at most 120 characters.");
  const spacing = expression(document, input.spacing.trim(), []);
  const evaluated = evaluateExpressionRef(spacing, { parameters: evaluateParameters(document.parameters).values });
  if (evaluated.quantity?.dimension !== "length" || !Number.isFinite(evaluated.quantity.value) || evaluated.quantity.value <= MIN_ENTITY_SIZE || evaluated.quantity.value > MAX_COORDINATE) throw new Error(`Pattern spacing must be a positive length, up to ${MAX_COORDINATE} mm. ${evaluated.error ?? ""}`.trim());
  const vector = input.direction === "X" ? { x: 1, y: 0 } : input.direction === "Y" ? { x: 0, y: 1 } : input.vector;
  if (!vector || !Number.isFinite(vector.x) || !Number.isFinite(vector.y) || Math.hypot(vector.x, vector.y) <= 1e-12) throw new Error("Pattern direction needs a finite, nonzero vector.");
  const norm = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(norm)) throw new Error("Pattern direction vector exceeds supported limits.");
  const dx = vector.x / norm, dy = vector.y / norm;
  return { sourcesExcluded: [], transforms: Array.from({ length: input.count - 1 }, (_, index) => ({ xx: 1, xy: 0, yx: 0, yy: 1, tx: dx * evaluated.quantity!.value * (index + 1), ty: dy * evaluated.quantity!.value * (index + 1), axisAligned: true, swapAxes: false, spacing, dx: dx * (index + 1), dy: dy * (index + 1) })) };
}
function copyPoint(document: CadDocument, entity: Extract<SketchEntity, { type: "point" }>, solved: ResolvedSketch, transform: Transform) {
  const point = solved.points[entity.id];
  if (!point) throw new Error(`Point ${entity.id} has no solved coordinates. Repair it before copying.`);
  const x = transform.xx * point.x + transform.xy * point.y + transform.tx, y = transform.yx * point.x + transform.yy * point.y + transform.ty;
  if (![x, y].every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE)) throw new Error("Copied geometry exceeds the supported coordinate limits.");
  const baseX = hasBinding(entity.x) ? entity.x : literal(point.x), baseY = hasBinding(entity.y) ? entity.y : literal(point.y);
  const coordinate = (a: number, b: number, offset: number, factor: number | undefined, value: number) => {
    const terms: string[] = [], refs: ExpressionRef[] = [];
    if (a !== 0) { terms.push(`(${baseX.expression}) * ${scalar(a)}`); refs.push(baseX); }
    if (b !== 0) { terms.push(`(${baseY.expression}) * ${scalar(b)}`); refs.push(baseY); }
    if (transform.spacing && factor !== undefined) {
      if (factor !== 0) { terms.push(`(${transform.spacing.expression}) * ${scalar(factor)}`); refs.push(transform.spacing); }
    } else if (offset !== 0) terms.push(`${scalar(offset)}mm`);
    if (!refs.some(hasBinding)) return literal(value);
    return expression(document, terms.join(" + "), refs);
  };
  return { x: coordinate(transform.xx, transform.xy, transform.tx, transform.dx, x), y: coordinate(transform.yx, transform.yy, transform.ty, transform.dy, y) };
}
/** Creation-time copies: ordinary primitives with no saved pattern/mirror association. */
export function buildSketchReplication(document: CadDocument, sketchId: string, selectedIds: readonly string[], input: SketchReplicationInput): SketchReplicationPlan {
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Open a current sketch before copying geometry.");
  if (!selectedIds.length || selectedIds.length > MAX_SKETCH_REPLICATION_SELECTION || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !Object.hasOwn(sketch.entities, id))) throw new Error(`Select 1–${MAX_SKETCH_REPLICATION_SELECTION} current, distinct sketch items.`);
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before copying sketch geometry.");
  const solved = solveSketch(sketch, evaluation.values);
  const failure = solved.errors.find((error) => error.severity === "error");
  if (failure) throw new Error(`Repair sketch intent before copying: ${failure.constraintId ?? failure.entityId ?? sketch.id}: ${failure.message}`);
  const { transforms, sourcesExcluded } = transformInput(document, sketch, solved, input);
  const sourceIds = new Set(selectedIds.filter((id) => !sourcesExcluded.includes(id)));
  if (!sourceIds.size) throw new Error("Select geometry to mirror in addition to its axis. The axis is not copied.");
  for (const id of [...sourceIds]) for (const ref of sketchPointReferences(sketch.entities[id])) sourceIds.add(ref.pointId);
  const sourceEntities = [...sourceIds].map((id) => sketch.entities[id]);
  if (sourceEntities.some((entity) => !entity)) throw new Error("Selected geometry has lost a point reference. Repair it before copying.");
  if (Object.keys(sketch.entities).length + sourceIds.size * transforms.length > PROJECT_IMPORT_LIMITS.maxSketchEntitiesPerSketch) throw new Error("The copies exceed the 750-entity sketch limit. Reduce count or selection.");
  const internal = <T extends { id: string; entityIds: string[]; pointIds?: string[] }>(items: T[]) => items.filter((item) => {
    const refs = [...item.entityIds, ...(item.pointIds ?? [])], touches = refs.some((id) => sourceIds.has(id));
    if (touches && input.mode === "mirror" && refs.includes(input.axisLineId)) throw new Error(`Design intent ${item.id} references the mirror axis, which is not copied. Choose an independent axis or explicitly revise that intent before mirroring.`);
    if (touches && refs.some((id) => !sourceIds.has(id))) throw new Error(`Design intent ${item.id} crosses the selection. Select all its referenced geometry before copying.`);
    return touches;
  });
  const constraints = internal(sketch.constraints), dimensions = internal(sketch.dimensions);
  if (sketch.constraints.length + sketch.dimensions.length + (constraints.length + dimensions.length) * transforms.length > PROJECT_IMPORT_LIMITS.maxConstraintsAndDimensionsPerSketch) throw new Error("Copied design intent exceeds the sketch equation limit. Reduce count or selection.");
  if (transforms.some((transform) => !transform.axisAligned) && (constraints.some((constraint) => constraint.type === "horizontal" || constraint.type === "vertical") || dimensions.some((dimension) => dimension.type === "horizontalDistance" || dimension.type === "verticalDistance"))) throw new Error("Oblique mirror cannot remap horizontal/vertical intent. Choose a horizontal, vertical or 45-degree axis, or edit that intent explicitly.");
  let next = { ...sketch, entities: { ...sketch.entities }, constraints: [...sketch.constraints], dimensions: [...sketch.dimensions] };
  const copies: SketchReplicationCopy[] = [];
  for (const transform of transforms) {
    const entityIds = Object.fromEntries(sourceEntities.map((entity) => [entity.id, createId(entity.type)])), constraintIds: Record<string, string> = {}, dimensionIds: Record<string, string> = {};
    let moved = false;
    for (const entity of sourceEntities) {
      let copied: SketchEntity;
      if (entity.type === "point") {
        const coordinates = copyPoint(document, entity, solved, transform);
        const resolved = solved.points[entity.id];
        moved ||= Math.hypot(transform.xx * resolved.x + transform.xy * resolved.y + transform.tx - resolved.x, transform.yx * resolved.x + transform.yy * resolved.y + transform.ty - resolved.y) > SKETCH_TOLERANCE;
        copied = { ...entity, id: entityIds[entity.id], ...coordinates };
      } else if (entity.type === "line") copied = { ...entity, id: entityIds[entity.id], startPointId: entityIds[entity.startPointId], endPointId: entityIds[entity.endPointId] };
      else if (entity.type === "circle") {
        const circle = solved.circles.find((candidate) => candidate.id === entity.id)!;
        copied = { ...entity, id: entityIds[entity.id], centerPointId: entityIds[entity.centerPointId], radius: hasBinding(entity.radius) ? entity.radius : literal(circle.radius) };
      } else copied = { ...entity, id: entityIds[entity.id], centerPointId: entityIds[entity.centerPointId], startPointId: entityIds[entity.startPointId], endPointId: entityIds[entity.endPointId], clockwise: input.mode === "mirror" ? !entity.clockwise : entity.clockwise };
      next.entities[copied.id] = copied;
    }
    if (!moved) throw new Error("This mirror leaves the selected geometry on its source. Choose another axis; no coincident copy was created.");
    const refs = <T extends { entityIds: string[]; pointIds?: string[] }>(item: T) => ({ ...item, entityIds: item.entityIds.map((id) => entityIds[id]), ...(item.pointIds ? { pointIds: item.pointIds.map((id) => entityIds[id]) } : {}) });
    for (const constraint of constraints) {
      const id = createId("constraint"); constraintIds[constraint.id] = id;
      const type = transform.swapAxes && (constraint.type === "horizontal" || constraint.type === "vertical") ? constraint.type === "horizontal" ? "vertical" : "horizontal" : constraint.type;
      next.constraints.push({ ...refs(constraint), id, type });
    }
    for (const dimension of dimensions) {
      const id = createId("dimension"); dimensionIds[dimension.id] = id;
      const type = transform.swapAxes && (dimension.type === "horizontalDistance" || dimension.type === "verticalDistance") ? dimension.type === "horizontalDistance" ? "verticalDistance" : "horizontalDistance" : dimension.type;
      next.dimensions.push({ ...refs(dimension), id, type });
    }
    copies.push({ entityIds, constraintIds, dimensionIds });
  }
  const result = solveSketch(next, evaluation.values), error = result.errors.find((issue) => issue.severity === "error");
  if (error) throw new Error(`Copied design intent cannot solve: ${error.constraintId ?? error.entityId ?? sketchId}: ${error.message}. The source was preserved.`);
  const profiles = detectProfiles(result), baseline = detectProfiles(solved);
  const newProfileErrors = profiles.errors.filter((message) => !baseline.errors.includes(message));
  if (newProfileErrors.length || profiles.profiles.length < baseline.profiles.length) throw new Error(`Copies would lose or invalidate a closed region: ${newProfileErrors.join(" ") || "overlapping geometry"}. Change spacing or axis.`);
  // Adding inner loops changes a profile signature even when its outer boundary is
  // untouched. Repair only uniquely retained source boundaries, never choose a
  // different region or silently rely on the legacy rectangle alias.
  const boundaryKey = (profile: (typeof profiles.profiles)[number]) => JSON.stringify({
    type: profile.outerLoop.type,
    ids: [...profile.outerLoop.entityIds].sort(),
    segments: profile.outerLoop.segments,
    bounds: profile.bounds,
  });
  const repairs = new Map<string, string>();
  for (const feature of document.features) {
    if ((feature.type !== "extrude" && feature.type !== "revolve") || feature.sketchId !== sketchId) continue;
    if (profiles.profiles.some((profile) => profile.id === feature.profileId || profile.alternateIds?.includes(feature.profileId))) continue;
    const before = baseline.profiles.find((profile) => profile.id === feature.profileId || profile.alternateIds?.includes(feature.profileId));
    const matches = before ? profiles.profiles.filter((profile) => boundaryKey(profile) === boundaryKey(before)) : [];
    if (matches.length !== 1) throw new Error(`Feature ${feature.id} would lose its profile reference. Change the copy spacing or repair its selected region explicitly.`);
    repairs.set(feature.id, matches[0].id);
  }
  const candidate = upsertSketch({ ...document, features: document.features.map((feature) => repairs.has(feature.id) ? { ...feature, profileId: repairs.get(feature.id)! } : feature) }, next);
  assertProjectJsonShape(candidate);
  return { base: document, document: candidate, sketchId, selectedIds: [...selectedIds], mode: input.mode, copies, addedEntityIds: copies.flatMap((copy) => Object.values(copy.entityIds)), profileCount: profiles.profiles.length, solved: result, changes: [input.mode === "mirror" ? "Create one reflected copy; the chosen axis remains unchanged." : `Create ${input.count - 1} translated copies (${input.count} total, including source).`, `Copy ${constraints.length} internal constraints and ${dimensions.length} dimensions per instance; preserve expressions and bindings.`, ...(repairs.size ? [`Retain ${repairs.size} existing feature regions by repairing their unchanged outer-boundary references.`] : []), "Count and mirror axis are creation-time choices. Copies are ordinary, independently editable sketch geometry; no associative pattern feature is saved."] };
}
