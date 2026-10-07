import { extrusionSweep } from "../features/extrusionSweep";
import { targetBodyIds } from "../document/bodyScopes";
import { KERNEL_LINEAR_TOLERANCE } from "./tolerances";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import { Quantity } from "../parameters/units";
import { solveSketch } from "./SketchSolver";
import { detectProfiles } from "./profileDetection";
import { orientedSegments } from "../kernel/profileMesh";
import {
  CadDocument,
  FacePlaneReference,
  OriginPlane,
  SketchPlaneReference,
} from "../document/schema";

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface SketchPlaneTransform {
  origin: Point3;
  u: Point3;
  v: Point3;
  normal: Point3;
}

export function originPlaneRef(plane: OriginPlane): SketchPlaneReference {
  return { type: "origin", plane };
}

export function sketchPlaneLabel(
  plane: SketchPlaneReference | OriginPlane,
): string {
  const ref = normalizeSketchPlane(plane);
  if (ref.type === "origin") return ref.plane;
  if (ref.type === "offset")
    return `${typeof ref.base === "string" ? ref.base : "Face"} offset`;
  return ref.lost ? "Lost face plane" : "Face plane";
}

export function normalizeSketchPlane(
  plane: SketchPlaneReference | OriginPlane | undefined,
): SketchPlaneReference {
  if (!plane) return originPlaneRef("XY");
  if (typeof plane === "string") return originPlaneRef(plane);
  return plane;
}

export function sketchPlaneTransform(
  plane: SketchPlaneReference | OriginPlane | undefined,
  parameters: Record<string, Quantity> = {},
  faces: Map<string, SketchPlaneTransform> = new Map(),
): SketchPlaneTransform {
  const ref = normalizeSketchPlane(plane);
  if (ref.type === "origin") return transformForOriginPlane(ref.plane);
  if (ref.type === "face") {
    const result = ref.lost ? undefined : faces.get(ref.stableFaceId);
    if (!result)
      throw new Error(
        "Sketch plane reference lost. Reselect a supported planar face to repair this sketch.",
      );
    return result;
  }
  const base =
    typeof ref.base === "string"
      ? transformForOriginPlane(ref.base)
      : sketchPlaneTransform(ref.base, parameters, faces);
  const offset = evaluateExpressionRef(ref.offset, { parameters });
  if (
    offset.error ||
    !offset.quantity ||
    offset.quantity.dimension !== "length"
  )
    throw new Error(offset.error ?? "Plane offset must resolve to a length.");
  return { ...base, origin: transformPoint(base, 0, 0, offset.quantity.value) };
}

export function stableFaceId(
  featureId: string,
  role: "startCap" | "endCap" | "side",
  entityId?: string,
): string {
  return `extrude:${featureId}:${role}${entityId ? `:${entityId}` : ""}`;
}
export interface AvailableFace {
  id: string;
  featureId: string;
  label: string;
  transform: SketchPlaneTransform;
}
export function faceOwnerModifiedBefore(
  document: CadDocument,
  ownerId: string,
  consumer: Pick<CadDocument["sketches"][string], "timelineStep">,
): boolean {
  return document.features.some(
    (f) =>
      !f.suppressed &&
      f.id !== ownerId &&
      (consumer.timelineStep === undefined ||
        f.timelineStep === undefined ||
        f.timelineStep < consumer.timelineStep) &&
      (((f.type === "extrude" || f.type === "revolve") &&
        f.operation !== "newBody" &&
        f.targetBodyIds?.includes(`body:${ownerId}`)) ||
        (f.type === "hole" && targetBodyIds(f).includes(`body:${ownerId}`)) ||
        (f.type === "pattern" && targetBodyIds(f).includes(`body:${ownerId}`)) ||
        ((f.type === "fillet" || f.type === "chamfer") &&
          f.targetEdgeRefs?.some((ref) => ref.featureId === ownerId))),
  );
}
export function resolveDocumentPlanes(
  document: CadDocument,
  parameters: Record<string, Quantity>,
  solvedSketches?: Map<string, ReturnType<typeof solveSketch>>,
  // Metadata alone cannot establish that a modified face survives. Native rebuilds validate it at the consumer’s timeline position.
  allowModifiedFaces = false,
): {
  transforms: Map<string, SketchPlaneTransform>;
  errors: Map<string, string>;
  faces: AvailableFace[];
} {
  const transforms = new Map<string, SketchPlaneTransform>(),
    errors = new Map<string, string>();
  const published = new Set<string>();
  const solveCache = new Map(solvedSketches);
  const profileCache = new Map<string, ReturnType<typeof detectProfiles>>();
  const faces: AvailableFace[] = [],
    faceMap = new Map<string, SketchPlaneTransform>(),
    visiting = new Set<string>();
  const resolve = (sketchId: string): SketchPlaneTransform => {
    const cached = transforms.get(sketchId);
    if (cached) return cached;
    const sketch = document.sketches[sketchId];
    if (!sketch) throw new Error("Sketch plane owner sketch was not found.");
    if (visiting.has(sketchId))
      throw new Error(
        "Cyclic sketch plane reference. Reselect an upstream planar face.",
      );
    visiting.add(sketchId);
    try {
      const ref =
        sketch.plane.type === "face"
          ? sketch.plane
          : sketch.plane.type === "offset" &&
              typeof sketch.plane.base !== "string"
            ? sketch.plane.base
            : undefined;
      if (ref) publishOwner(ref, sketchId);
      const result = sketchPlaneTransform(sketch.plane, parameters, faceMap);
      transforms.set(sketchId, result);
      return result;
    } finally {
      visiting.delete(sketchId);
    }
  };
  const publishOwner = (ref: FacePlaneReference, consumerId?: string) => {
    const owner = document.features.find((f) => f.id === ref.featureId);
    if (
      !owner ||
      owner.type !== "extrude" ||
      owner.suppressed ||
      owner.operation !== "newBody" ||
      (owner.termination && owner.termination.type !== "distance")
    )
      throw new Error(
        "Sketch plane reference lost: owner is missing, suppressed, or no longer a supported distance extrusion. Reselect a planar face.",
      );
    if (consumerId) {
      const consumer = document.sketches[consumerId];
      if (
        consumer.timelineStep !== undefined &&
        owner.timelineStep !== undefined &&
        owner.timelineStep >= consumer.timelineStep
      )
        throw new Error(
          "Face plane owner must precede the sketch in the timeline.",
        );
      // Modified feature faces are not guessed back onto the original surface.
      const modified = faceOwnerModifiedBefore(document, owner.id, consumer);
      if (modified && !allowModifiedFaces)
        throw new Error(
          "Sketch plane reference requires repair: its owner body was modified. Reselect an unmodified feature-owned planar face.",
        );
    }
    if (published.has(owner.id)) {
      if (
        !faceMap.has(ref.stableFaceId) ||
        !ref.stableFaceId.startsWith(`extrude:${owner.id}:`)
      )
        throw new Error(
          "Sketch plane reference lost: the named face no longer exists. Reselect a supported planar face.",
        );
      return;
    }
    const authoredBase = resolve(owner.sketchId),
      ownerSketch = document.sketches[owner.sketchId];
    const solved =
        solvedSketches?.get(ownerSketch.id) ??
        solveSketch(ownerSketch, parameters),
      detected = profileCache.get(ownerSketch.id) ?? detectProfiles(solved);
    profileCache.set(ownerSketch.id, detected);
    solveCache.set(ownerSketch.id, solved);
    const profile = detected.profiles.find(
      (p) =>
        p.id === owner.profileId || p.alternateIds?.includes(owner.profileId),
    );
    if (!profile || solved.errors.length || detected.errors.length)
      throw new Error(
        "Sketch plane reference lost: the owner profile failed to rebuild.",
      );
    const size = evaluateExpressionRef(
      owner.termination?.type === "distance"
        ? (owner.termination.distance ?? owner.distance)
        : owner.distance,
      { parameters },
    );
    if (
      size.error ||
      !size.quantity ||
      size.quantity.dimension !== "length" ||
      size.quantity.value <= 0
    )
      throw new Error(
        "Sketch plane reference lost: the owner extrusion distance is invalid.",
      );
    const base = extrusionSweep(
      authoredBase,
      size.quantity.value,
      owner.direction,
    );
    const add = (
      id: string,
      label: string,
      transform: SketchPlaneTransform,
    ) => {
      if (!faceMap.has(id))
        faces.push({
          id,
          featureId: owner.id,
          label: `${owner.name} — ${label}`,
          transform,
        });
      faceMap.set(id, transform);
    };
    add(stableFaceId(owner.id, "startCap"), "start cap", {
      ...base,
      v: scale(base.v, -1),
      normal: scale(base.normal, -1),
    });
    add(stableFaceId(owner.id, "endCap"), "end cap", {
      ...base,
      origin: transformPoint(base, 0, 0, size.quantity.value),
    });
    for (const segment of orientedSegments(profile.outerLoop, false)) {
      if (segment.type !== "line") continue;
      const length = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      );
      if (length < KERNEL_LINEAR_TOLERANCE) continue;
      const u = sketchVectorToWorld(
        base,
        (segment.end.x - segment.start.x) / length,
        (segment.end.y - segment.start.y) / length,
      );
      add(stableFaceId(owner.id, "side", segment.id), `side ${segment.id}`, {
        origin: transformPoint(base, segment.start.x, segment.start.y),
        u,
        v: base.normal,
        normal: cross(u, base.normal),
      });
    }
    published.add(owner.id);
    if (
      !faceMap.has(ref.stableFaceId) ||
      !ref.stableFaceId.startsWith(`extrude:${owner.id}:`)
    )
      throw new Error(
        "Sketch plane reference lost: the named face no longer exists. Reselect a supported planar face.",
      );
  };
  for (const sketch of Object.values(document.sketches)) {
    try {
      resolve(sketch.id);
    } catch (error) {
      errors.set(
        sketch.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  for (const feature of document.features)
    if (feature.type === "extrude") {
      try {
        publishOwner({
          type: "face",
          featureId: feature.id,
          stableFaceId: stableFaceId(feature.id, "endCap"),
        });
      } catch {
        /* Unsupported or failed owners are not selectable. */
      }
    }
  return { transforms, errors, faces };
}
function scale(p: Point3, s: number): Point3 {
  return { x: p.x * s, y: p.y * s, z: p.z * s };
}
function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function sketchPointToWorld(
  plane: SketchPlaneReference | OriginPlane | undefined,
  x: number,
  y: number,
  z = 0,
  parameters: Record<string, Quantity> = {},
  faces: Map<string, SketchPlaneTransform> = new Map(),
): Point3 {
  const transform = sketchPlaneTransform(plane, parameters, faces);
  return transformPoint(transform, x, y, z);
}

export function transformPoint(
  transform: SketchPlaneTransform,
  x: number,
  y: number,
  z = 0,
): Point3 {
  const vector = sketchVectorToWorld(transform, x, y, z);
  return {
    x: transform.origin.x + vector.x,
    y: transform.origin.y + vector.y,
    z: transform.origin.z + vector.z,
  };
}

export function sketchVectorToWorld(
  transform: SketchPlaneTransform,
  x: number,
  y: number,
  z = 0,
): Point3 {
  return {
    x: transform.u.x * x + transform.v.x * y + transform.normal.x * z,
    y: transform.u.y * x + transform.v.y * y + transform.normal.y * z,
    z: transform.u.z * x + transform.v.z * y + transform.normal.z * z,
  };
}

export function worldPointToSketch(
  plane: SketchPlaneReference | OriginPlane | undefined,
  point: Point3,
  parameters: Record<string, Quantity> = {},
  faces: Map<string, SketchPlaneTransform> = new Map(),
): { x: number; y: number; z: number } {
  const transform = sketchPlaneTransform(plane, parameters, faces);
  const relative = subtract(point, transform.origin);
  return {
    x: dot(relative, transform.u),
    y: dot(relative, transform.v),
    z: dot(relative, transform.normal),
  };
}

function transformForOriginPlane(plane: OriginPlane): SketchPlaneTransform {
  if (plane === "XZ") {
    return {
      origin: vector(0, 0, 0),
      u: vector(1, 0, 0),
      v: vector(0, 0, 1),
      normal: vector(0, -1, 0),
    };
  }
  if (plane === "YZ") {
    return {
      origin: vector(0, 0, 0),
      u: vector(0, 1, 0),
      v: vector(0, 0, 1),
      normal: vector(1, 0, 0),
    };
  }
  return {
    origin: vector(0, 0, 0),
    u: vector(1, 0, 0),
    v: vector(0, 1, 0),
    normal: vector(0, 0, 1),
  };
}

function vector(x: number, y: number, z: number): Point3 {
  return { x, y, z };
}

function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
