import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { resolveDocumentPlanes, transformPoint, type Point3 } from "../cad/sketch/planes";
import { evaluateExpressionRef } from "../cad/parameters/expressionEvaluator";
import { extrusionSweep } from "../cad/features/extrusionSweep";
import { placePlane } from "../cad/document/componentPlacement";
import { featureComponentId, sketchComponentId } from "../cad/document/components";
import type { SketchProjectionChoice } from "../ui/commands/sketchProjectionCommand";

export interface ProjectionBoundaryTarget extends SketchProjectionChoice {
  curves: Point3[][];
  disabledReason?: string;
  /** Only the sampled picking overlay is unavailable; a named boundary remains modelable. */
  displayLimited?: boolean;
}
export function projectionBoundaryBlockingReason(target: ProjectionBoundaryTarget | undefined) {
  return target?.displayLimited ? undefined : target?.disabledReason;
}

/** Sampled lines are display/pick affordances only. Native complete-cap proof
 * and the projection planner remain authoritative for geometry and Apply. */
export function projectionBoundaryTargets(document: CadDocument, sketchId: string, proof: RebuildResult, choices: readonly SketchProjectionChoice[], replaceProjectionId?: string): ProjectionBoundaryTarget[] {
  if (!proof.success || proof.documentId !== document.id) return [];
  const previous = document.sketches[sketchId]?.projections?.find((link) => link.id === replaceProjectionId);
  if (replaceProjectionId && !previous) return choices.map(choice => ({ ...choice, curves: [], disabledReason: "Projection link was lost. Reopen repair for a current linked boundary." }));
  const parameters = proof.parameterValues ?? {};
  const planes = resolveDocumentPlanes(document, parameters, new Map(Object.entries(proof.solvedSketches ?? {})), true);
  const world = !previous || previous.coordinateSpace === "world";
  const authoredDestination = planes.transforms.get(sketchId);
  const destination = authoredDestination && (world ? placePlane(authoredDestination, document.components[sketchComponentId(document, sketchId)]?.placement) : authoredDestination);
  const compatibility = new Map(choices.map((choice) => {
    const feature = document.features.find((item) => item.id === choice.featureId);
    if (feature?.type !== "extrude") return [choice.id, "Choose a supported distance extrusion."] as const;
    if (featureComponentId(document, feature) !== sketchComponentId(document, feature.sketchId)) return [choice.id, "Source feature and sketch must belong to the same component. Repair source ownership."] as const;
    if (!destination) return [choice.id, planes.errors.get(sketchId) ?? "Destination sketch plane is unavailable. Repair its plane."] as const;
    const authoredSource = planes.transforms.get(feature.sketchId);
    const normal = authoredSource && (world ? placePlane(authoredSource, document.components[featureComponentId(document, feature)]?.placement) : authoredSource).normal;
    if (!normal) return [choice.id, "Source sketch plane is unavailable. Repair its source."] as const;
    const alignment = normal.x * destination.normal.x + normal.y * destination.normal.y + normal.z * destination.normal.z;
    return [choice.id, Math.abs(Math.abs(alignment) - 1) > 1e-7 ? "Project edges currently requires parallel planes. Choose a parallel origin, offset or cap plane." : undefined] as const;
  }));
  // Reserve the bounded display capacity for usable sources before diagnostic
  // outlines, but preserve the authored choice order in the returned controls.
  const displayOrder = [...choices].sort((a, b) => Number(Boolean(compatibility.get(a.id))) - Number(Boolean(compatibility.get(b.id))));
  let vertexCount = 0;
  const built = displayOrder.map((choice) => {
    const target: ProjectionBoundaryTarget = { ...choice, curves: [], disabledReason: compatibility.get(choice.id) };
    const feature = document.features.find((item) => item.id === choice.featureId);
    if (!proof.availableEdges?.some((edge) => edge.featureId === choice.featureId && edge.role === choice.role && !edge.sourceEntityId)) return { ...target, disabledReason: "This complete native boundary is no longer available." };
    if (feature?.type !== "extrude" || feature.operation !== "newBody" || feature.suppressed || (feature.termination && feature.termination.type !== "distance")) return { ...target, disabledReason: "Choose a supported distance extrusion." };
    const source = proof.solvedSketches?.[feature.sketchId];
    const profile = proof.profiles?.[feature.sketchId]?.find((item) => item.id === feature.profileId || item.alternateIds?.includes(feature.profileId));
    const designSourcePlane = planes.transforms.get(feature.sketchId);
    // The overlay identifies the actual native source body in the world-space
    // source view, even when a legacy repair follows authored design coordinates.
    const sourcePlane = proof.sketchPlanes?.[feature.sketchId] ?? (designSourcePlane && placePlane(designSourcePlane, document.components[featureComponentId(document, feature)]?.placement));
    if (!source || source.errors.length || !profile || !sourcePlane) return { ...target, disabledReason: "Source sketch geometry or plane is unavailable. Repair its source." };
    const distance = evaluateExpressionRef(feature.termination?.type === "distance" ? (feature.termination.distance ?? feature.distance) : feature.distance, { parameters });
    if (distance.error || distance.quantity?.dimension !== "length" || (!Number.isFinite(distance.quantity.value) || distance.quantity.value <= 0)) return { ...target, disabledReason: "Source extrusion distance is invalid." };
    const sweep = extrusionSweep(sourcePlane, distance.quantity.value, feature.direction);
    const cap = choice.role === "endCapPerimeter" ? { ...sweep, origin: transformPoint(sweep, 0, 0, distance.quantity.value) } : sweep;
    const ids = [...profile.outerLoop.entityIds, ...profile.innerLoops.flatMap((loop) => loop.entityIds)];
    const sourceSketch = document.sketches[feature.sketchId];
    const members = new Set(ids.flatMap((id) => {
      const entity = sourceSketch?.entities[id];
      return !entity || entity.type === "point" ? [id] : entity.type === "line" ? [id, entity.startPointId, entity.endPointId] : entity.type === "circle" ? [id, entity.centerPointId] : [id, entity.centerPointId, entity.startPointId, entity.endPointId];
    }));
    if (members.size > 256) return { ...target, disabledReason: "Boundary exceeds the 256-member projection limit." };
    const count = ids.reduce((total, id) => {
      if (source.lines.some((item) => item.id === id)) return total + 2;
      const arc = source.arcs.find((item) => item.id === id);
      return total + (arc ? Math.max(8, Math.ceil(Math.abs(arc.sweep) / (Math.PI * 2) * 96)) + 1 : 97);
    }, 0);
    if (vertexCount + count > 32768) return { ...target, curves: [], displayLimited: !target.disabledReason, disabledReason: target.disabledReason ?? "Source preview has reached its display limit. Choose this boundary by name." };
    for (const id of ids) {
      const line = source.lines.find((item) => item.id === id);
      if (line) target.curves.push([transformPoint(cap, line.start.x, line.start.y), transformPoint(cap, line.end.x, line.end.y)]);
      else {
        const arc = source.arcs.find((item) => item.id === id), circle = arc ?? source.circles.find((item) => item.id === id);
        if (!circle) return { ...target, curves: [], disabledReason: "Fragmented boundaries cannot be projected. Choose a complete authored cap." };
        const start = arc?.startAngle ?? 0, sweepAngle = arc?.sweep ?? Math.PI * 2;
        const steps = Math.max(8, Math.ceil(Math.abs(sweepAngle) / (Math.PI * 2) * 96));
        target.curves.push(Array.from({ length: steps + 1 }, (_, i) => {
          const angle = start + sweepAngle * i / steps;
          return transformPoint(cap, circle.center.x + circle.radius * Math.cos(angle), circle.center.y + circle.radius * Math.sin(angle));
        }));
      }
    }
    if (!target.curves.flat().every((point) => Object.values(point).every(Number.isFinite))) return { ...target, curves: [], disabledReason: "Boundary coordinates are invalid." };
    vertexCount += count;
    return target;
  });
  const byId = new Map(built.map((target) => [target.id, target]));
  return choices.map((choice) => byId.get(choice.id)!);
}
