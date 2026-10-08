import type { CadDocument, Sketch, SketchEntity, SketchProjection, ExpressionRef } from "../document/schema";
import type { ResolvedSketch } from "./SketchSolver";
import type { SketchProfile } from "./profileDetection";
import type { RebuildResult } from "../worker/workerProtocol";
import { componentPlacementsEqual } from "../document/componentPlacement";
import { featureComponentId, sketchComponentId } from "../document/components";
import { createId } from "../document/ids";
import { deleteSketchEntities } from "./entityDeletion";
import { documentTimeline, timelineItemId } from "../document/timelineOrdering";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import type { Quantity } from "../parameters/units";
import { extrusionSweep } from "../features/extrusionSweep";
import { resolveDocumentPlanes, transformPoint, type SketchPlaneTransform } from "./planes";

const length = (value: number): ExpressionRef => {
  if (!Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error("Projected coordinates must be finite and within 100,000,000 mm.");
  // The expression grammar uses decimals; avoid scientific notation while
  // retaining sub-tolerance precision, as with ordinary pointer point moves.
  return { expression: `${value.toFixed(12)}mm`, unit: "mm" };
};
export const projectionConstraintId = (id: string) => `projection:${id}:fixed`;

export function projectionSource(document: CadDocument, target: Sketch, projection: SketchProjection) {
  const source = document.features.find((feature) => feature.id === projection.sourceFeatureId);
  if (!source || source.type !== "extrude" || source.suppressed || source.operation !== "newBody" || (source.termination && source.termination.type !== "distance"))
    throw new Error("Projected boundary owner is missing or unsupported. Reselect an upstream distance-extruded cap or remove the projection.");
  const timeline = documentTimeline(document).map(timelineItemId);
  if (timeline.indexOf(source.id) >= timeline.indexOf(target.id) || source.sketchId === target.id)
    throw new Error("A projection must reference an earlier feature. Move the sketch after its source or reselect a source.");
  return source;
}

/** Resolve copied coordinates before solving. Native survival is separately
 * checked at the consumer's timeline position; this is never a topology proof. */
export function materializeSketchProjections(
  document: CadDocument, target: Sketch, solved: Map<string, ResolvedSketch>, profiles: Map<string, { profiles: SketchProfile[] }>, parameters: Record<string, Quantity>,
): Sketch {
  if (!target.projections?.length) return target;
  const planes = resolveDocumentPlanes(document, parameters, solved, true);
  const targetPlane = planes.transforms.get(target.id);
  if (!targetPlane) throw new Error(planes.errors.get(target.id) ?? "Projection destination plane is unavailable.");
  const entities = { ...target.entities };
  let constraints = [...target.constraints];
  for (const projection of target.projections) {
    const source = projectionSource(document, target, projection);
    const sourceSketch = document.sketches[source.sketchId], sourceSolved = solved.get(source.sketchId);
    const profile = profiles.get(source.sketchId)?.profiles.find((p) => p.id === source.profileId || p.alternateIds?.includes(source.profileId));
    if (!sourceSolved || sourceSolved.errors.length || !profile) throw new Error("Projected source profile is lost. Repair its sketch or reselect the boundary.");
    const sourcePlane = planes.transforms.get(source.sketchId);
    if (!sourcePlane) throw new Error("Projected source plane is unavailable. Repair its plane reference.");
    const evaluated = evaluateExpressionRef(source.termination?.type === "distance" && source.termination.distance ? source.termination.distance : source.distance, { parameters });
    if (evaluated.error || evaluated.quantity?.dimension !== "length") throw new Error(evaluated.error ?? "Projection source distance must be a length.");
    const sweep = extrusionSweep(sourcePlane, evaluated.quantity.value, source.direction);
    const cap = projection.role === "endCapPerimeter" ? { ...sweep, origin: transformPoint(sweep, 0, 0, evaluated.quantity.value) } : sweep;
    const alignment = dot(cap.normal, targetPlane.normal);
    if (Math.abs(Math.abs(alignment) - 1) > 1e-7) throw new Error("Project edges currently requires parallel planes. Choose a parallel origin, offset or cap plane.");
    const sourceCurveIds = [...profile.outerLoop.entityIds, ...profile.innerLoops.flatMap((loop) => loop.entityIds)];
    if (sourceCurveIds.some((id) => !sourceSketch.entities[id] || sourceSketch.entities[id].type === "point"))
      throw new Error("Fragmented boundaries cannot be projected. Choose a complete authored cap.");
    const required = new Set(sourceCurveIds.flatMap((id) => [id, ...supportPoints(sourceSketch.entities[id])]));
    const mapping = new Map(projection.members.map((member) => [member.sourceEntityId, member.targetEntityId]));
    if (required.size !== mapping.size || [...required].some((id) => !mapping.has(id)))
      throw new Error("Projected source boundary changed. Repair its source or remove the projection and project the new boundary.");
    const fixed: string[] = [];
    for (const [sourceId, targetId] of mapping) {
      const entity = sourceSketch.entities[sourceId], existing = target.entities[targetId];
      if (!entity || !existing || existing.type !== entity.type) throw new Error("Projected geometry was deleted or changed. Remove the link or reselect the boundary.");
      const base = { id: targetId, construction: projection.construction };
      if (entity.type === "point") {
        const point = sourceSolved.points[sourceId];
        if (!point) throw new Error("Projected source point is unavailable.");
        const p = projectPoint(cap, targetPlane, point.x, point.y);
        entities[targetId] = { ...base, type: "point", x: length(p.x), y: length(p.y) };
        fixed.push(targetId);
      } else if (entity.type === "line") entities[targetId] = { ...base, type: "line", startPointId: mapping.get(entity.startPointId)!, endPointId: mapping.get(entity.endPointId)! };
      else if (entity.type === "circle") {
        const circle = sourceSolved.circles.find((curve) => curve.id === sourceId);
        if (!circle) throw new Error("Projected source circle is unavailable.");
        entities[targetId] = { ...base, type: "circle", centerPointId: mapping.get(entity.centerPointId)!, radius: length(circle.radius) };
        fixed.push(targetId);
      } else entities[targetId] = { ...base, type: "arc", centerPointId: mapping.get(entity.centerPointId)!, startPointId: mapping.get(entity.startPointId)!, endPointId: mapping.get(entity.endPointId)!, clockwise: alignment < 0 ? !entity.clockwise : entity.clockwise };
    }
    constraints = constraints.filter((constraint) => constraint.id !== projectionConstraintId(projection.id));
    constraints.push({ id: projectionConstraintId(projection.id), type: "fixed", entityIds: fixed });
  }
  return { ...target, entities, constraints, solveMode: "driving" };
}

export function planSketchProjection(document: CadDocument, sketchId: string, sourceFeatureId: string, role: SketchProjection["role"], construction: boolean, result: RebuildResult, replaceProjectionId?: string) {
  if (!result.success || result.documentId !== document.id) throw new Error("Project edges needs a successful current native model.");
  if (!result.availableEdges?.some((edge) => edge.featureId === sourceFeatureId && edge.role === role && !edge.sourceEntityId)) throw new Error("This complete cap boundary is not available. Choose a surviving authored cap.");
  const target = document.sketches[sketchId];
  if (!target || (!replaceProjectionId && (target.projections?.length ?? 0) >= 32)) throw new Error("Projection destination is unavailable or has reached its limit.");
  const source = document.features.find((feature) => feature.id === sourceFeatureId);
  if (!source || source.type !== "extrude") throw new Error("Choose a supported extrusion cap.");
  if (!replaceProjectionId && !componentPlacementsEqual(document, featureComponentId(document, source), sketchComponentId(document, sketchId)))
    throw new Error("Components have different placements; align them before projecting. Existing links follow authored design geometry.");
  const sourceSketch = document.sketches[source.sketchId];
  const profile = result.profiles?.[source.sketchId]?.find((p) => p.id === source.profileId || p.alternateIds?.includes(source.profileId));
  if (!profile) throw new Error("Source profile is unavailable.");
  const curveIds = [...profile.outerLoop.entityIds, ...profile.innerLoops.flatMap((loop) => loop.entityIds)];
  if (curveIds.some((id) => !sourceSketch.entities[id])) throw new Error("Fragmented boundaries cannot be projected.");
  const sourceIds = [...new Set(curveIds.flatMap((id) => [id, ...supportPoints(sourceSketch.entities[id])]))];
  if (!sourceIds.length || sourceIds.length > 256) throw new Error("Projected boundary exceeds the 256-member limit.");
  const previous = replaceProjectionId ? target.projections?.find((p) => p.id === replaceProjectionId) : undefined;
  if (replaceProjectionId && (!previous || previous.members.length !== sourceIds.length || sourceIds.some((id) => !previous.members.some((m) => m.sourceEntityId === id))))
    throw new Error("Replacement has different authored entities. Delete this projection, project the new boundary, then explicitly repair downstream profile references.");
  const projection: SketchProjection = { id: previous?.id ?? createId("projection"), sourceFeatureId, role, construction, members: previous?.members ?? sourceIds.map((sourceEntityId) => ({ sourceEntityId, targetEntityId: createId("entity") })) };
  const map = new Map(projection.members.map((member) => [member.sourceEntityId, member.targetEntityId]));
  const placeholders = Object.fromEntries(projection.members.map(({ sourceEntityId, targetEntityId }) => {
    const entity = sourceSketch.entities[sourceEntityId];
    const copy: SketchEntity = entity.type === "point" ? { ...entity, id: targetEntityId } : entity.type === "line" ? { ...entity, id: targetEntityId, startPointId: map.get(entity.startPointId)!, endPointId: map.get(entity.endPointId)! } : entity.type === "circle" ? { ...entity, id: targetEntityId, centerPointId: map.get(entity.centerPointId)! } : { ...entity, id: targetEntityId, startPointId: map.get(entity.startPointId)!, endPointId: map.get(entity.endPointId)!, centerPointId: map.get(entity.centerPointId)! };
    return [targetEntityId, copy];
  }));
  const draft = { ...target, entities: { ...target.entities, ...placeholders }, projections: previous ? target.projections!.map((p) => p.id === previous.id ? projection : p) : [...(target.projections ?? []), projection] };
  const updated = materializeSketchProjections(document, draft, new Map(Object.entries(result.solvedSketches ?? {})), new Map(Object.entries(result.profiles ?? {}).map(([id, profiles]) => [id, { profiles }])), result.parameterValues ?? {});
  return { base: document, document: { ...document, sketches: { ...document.sketches, [sketchId]: updated } }, sketchId, projection };
}

export function breakSketchProjection(document: CadDocument, sketchId: string, projectionId: string, result: RebuildResult): CadDocument {
  if (!result.success || result.documentId !== document.id) throw new Error("Break link needs a successful current projected sketch. Repair its source or remove the projection first.");
  const sketch = document.sketches[sketchId], projection = sketch?.projections?.find((p) => p.id === projectionId);
  const solved = result.solvedSketches?.[sketchId];
  if (!projection || !solved || solved.errors.length) throw new Error("Current projected coordinates are unavailable. Delete the projection or repair its source first.");
  const entities = { ...sketch.entities };
  for (const { targetEntityId } of projection.members) {
    const entity = entities[targetEntityId];
    if (entity?.type === "point") {
      const p = solved.points[entity.id];
      if (p) entities[entity.id] = { ...entity, x: length(p.x), y: length(p.y) };
    } else if (entity?.type === "circle") {
      const circle = solved.circles.find((c) => c.id === entity.id);
      if (circle) entities[entity.id] = { ...entity, radius: length(circle.radius) };
    }
  }
  return { ...document, sketches: { ...document.sketches, [sketchId]: { ...sketch, entities, constraints: sketch.constraints.filter((c) => c.id !== projectionConstraintId(projectionId)), projections: sketch.projections!.filter((p) => p.id !== projectionId) } } };
}

export function deleteSketchProjection(document: CadDocument, sketchId: string, projectionId: string): CadDocument {
  const sketch = document.sketches[sketchId], projection = sketch?.projections?.find((p) => p.id === projectionId);
  if (!projection) throw new Error("Projection link is unavailable. Select a current link.");
  const ids = projection.members.map((m) => m.targetEntityId).filter((id) => sketch.entities[id]);
  const cleaned = ids.length ? deleteSketchEntities(sketch, ids, document) : sketch;
  return { ...document, sketches: { ...document.sketches, [sketchId]: { ...cleaned, constraints: cleaned.constraints.filter((c) => c.id !== projectionConstraintId(projectionId)), projections: sketch.projections!.filter((p) => p.id !== projectionId) } } };
}

function supportPoints(entity: SketchEntity) {
  return entity.type === "line" ? [entity.startPointId, entity.endPointId] : entity.type === "circle" ? [entity.centerPointId] : entity.type === "arc" ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [];
}
function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function projectPoint(source: SketchPlaneTransform, target: SketchPlaneTransform, x: number, y: number) {
  const p = transformPoint(source, x, y), delta = { x: p.x - target.origin.x, y: p.y - target.origin.y, z: p.z - target.origin.z };
  return { x: dot(delta, target.u), y: dot(delta, target.v) };
}
