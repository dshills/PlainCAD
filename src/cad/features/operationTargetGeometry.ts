import { ShapeUtils, Vector2 } from "three";
import type { CadDocument, Sketch } from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import { loopPoints } from "../kernel/profileMesh";
import { transformPoint, type Point3 } from "../sketch/planes";
import {
  evaluateExpressionRef,
  evaluateParameters,
} from "../parameters/expressionEvaluator";
import { extrusionSweep } from "./extrusionSweep";
import { sampleArc, type SketchProfile } from "../sketch/profileDetection";

export const OPERATION_OVERLAY_VERTEX_BUDGET = 8192;
export interface OperationTargetGeometry {
  loops: Point3[][];
  filled: boolean;
  /** Individual line/arc overlays are open paths, unlike complete perimeters. */
  closed?: boolean;
  indices?: number[];
}
function localProfileLoops(
  sketchId: string,
  profileId: string,
  result: RebuildResult,
  maxVertices: number,
) {
  const profile = result.profiles?.[sketchId]?.find(
    (p) => p.id === profileId || p.alternateIds?.includes(profileId),
  );
  if (!profile) throw new Error("The closed profile geometry is unavailable.");
  const loops = [profile.outerLoop, ...profile.innerLoops];
  let count = 0;
  for (const loop of loops) {
    // Match loopPoints' 128-point circles and sampleArc's pi/64 subdivision,
    // excluding each arc's final endpoint, before allocating sampled contours.
    if (loop.type === "circle") count += 128;
    else
      for (const segment of loop.segments ?? []) {
        count +=
          segment.type === "line"
            ? 1
            : Math.max(2, Math.ceil(Math.abs(segment.sweep) / (Math.PI / 64)));
        if (!Number.isFinite(count) || count > maxVertices) break;
      }
    if (!Number.isFinite(count) || count > maxVertices)
      throw new Error(
        "This detailed profile exceeds the viewer overlay budget. Use its explicit target card.",
      );
  }
  return loops.map((loop) => loopPoints(loop, profile));
}
export function profileOperationGeometry(
  sketchId: string,
  profileId: string,
  result: RebuildResult,
  maxVertices = OPERATION_OVERLAY_VERTEX_BUDGET,
): OperationTargetGeometry {
  const transform = result.sketchPlanes?.[sketchId];
  if (!transform)
    throw new Error("The closed profile placement is unavailable.");
  const local = localProfileLoops(sketchId, profileId, result, maxVertices);
  // loopPoints emits open contours (each segment contributes its start only),
  // so triangulation indices and returned loop vertices share identical offsets.
  const indices = ShapeUtils.triangulateShape(
    local[0].map((p) => new Vector2(p.x, p.y)),
    local.slice(1).map((loop) => loop.map((p) => new Vector2(p.x, p.y))),
  ).flat();
  return {
    filled: true,
    indices,
    loops: local.map((loop) =>
      loop.map((p) => transformPoint(transform, p.x, p.y)),
    ),
  };
}
export function capOperationGeometry(
  ownerId: string,
  end: boolean,
  document: CadDocument,
  result: RebuildResult,
  maxVertices = OPERATION_OVERLAY_VERTEX_BUDGET,
): OperationTargetGeometry {
  const owner = document.features.find((f) => f.id === ownerId);
  if (owner?.type !== "extrude")
    throw new Error("The cap perimeter owner is unavailable.");
  const transform = result.sketchPlanes?.[owner.sketchId];
  const distance = evaluateExpressionRef(owner.distance, {
    parameters: evaluateParameters(document.parameters).values,
  });
  if (!transform || distance.error || distance.quantity?.dimension !== "length")
    throw new Error(
      distance.error ??
        (!transform
          ? "The sketch plane placement is unavailable."
          : "The extrusion distance must be a length."),
    );
  const sweep = extrusionSweep(
    transform,
    distance.quantity.value,
    owner.direction,
  );
  const local = localProfileLoops(
    owner.sketchId,
    owner.profileId,
    result,
    maxVertices,
  );
  // extrusionSweep shifts only the source origin for negative/symmetric starts;
  // the full positive distance from that start is the end cap in every direction.
  return {
    filled: false,
    loops: local.map((loop) =>
      loop.map((point) =>
        transformPoint(
          sweep,
          point.x,
          point.y,
          end ? distance.quantity!.value : 0,
        ),
      ),
    ),
  };
}

function resolveExtrudeCapProfile(ownerId: string, document: CadDocument, result: RebuildResult) {
  const owner = document.features.find((feature) => feature.id === ownerId);
  if (owner?.type !== "extrude") return undefined;
  const sketch = document.sketches[owner.sketchId];
  const profile = result.profiles?.[owner.sketchId]?.find((item) => item.id === owner.profileId || item.alternateIds?.includes(owner.profileId));
  return profile && sketch ? { owner, sketch, profile } : undefined;
}
function completeCapBoundaryIds(sketch: Sketch, profile: SketchProfile) {
  return [...new Set([profile.outerLoop, ...profile.innerLoops].flatMap((loop) => {
    if (loop.type === "circle") return loop.entityIds.filter((id) => sketch.entities[id]?.type === "circle");
    return (loop.segments ?? []).flatMap((segment) => {
      const source = sketch.entities[segment.id];
      return source?.type === segment.type ? [segment.id] : [];
    });
  }))];
}
/** Only a complete authored boundary maps to an individual durable cap edge. */
export function capEdgeSourceIds(ownerId: string, document: CadDocument, result: RebuildResult) {
  const resolved = resolveExtrudeCapProfile(ownerId, document, result);
  return resolved ? completeCapBoundaryIds(resolved.sketch, resolved.profile) : [];
}

export function individualCapOperationGeometry(ownerId: string, end: boolean, sourceEntityId: string,
  document: CadDocument, result: RebuildResult, maxVertices = OPERATION_OVERLAY_VERTEX_BUDGET): OperationTargetGeometry {
  const resolved = resolveExtrudeCapProfile(ownerId, document, result);
  if (!resolved) throw new Error("The authored cap edge owner, sketch or closed profile is unavailable. Rebuild or repair its profile reference.");
  const { owner, sketch, profile } = resolved;
  if (!completeCapBoundaryIds(sketch, profile).includes(sourceEntityId))
    throw new Error("This edge is split, changed or not a complete authored cap boundary. Choose a supported edge.");
  const loop = [profile.outerLoop, ...profile.innerLoops].find((item) => item.entityIds.includes(sourceEntityId));
  if (!loop) throw new Error("The authored edge boundary is unavailable. Rebuild or choose a supported edge.");
  const segment = loop.segments?.find((item) => item.id === sourceEntityId);
  const local = loop.type === "circle" ? loopPoints(loop, profile) : segment?.type === "arc" ? sampleArc(segment) : segment ? [segment.start, segment.end] : [];
  if (!local.length || local.length > maxVertices) throw new Error("This edge exceeds the viewer overlay budget. Use its explicit card.");
  const transform = result.sketchPlanes?.[owner.sketchId];
  const distance = evaluateExpressionRef(owner.distance, { parameters: evaluateParameters(document.parameters).values });
  if (!transform || distance.error || distance.quantity?.dimension !== "length") throw new Error("The native edge placement is unavailable.");
  const sweep = extrusionSweep(transform, distance.quantity.value, owner.direction);
  return { filled: false, closed: loop.type === "circle", loops: [local.map((point) => transformPoint(sweep, point.x, point.y, end ? distance.quantity!.value : 0))] };
}
