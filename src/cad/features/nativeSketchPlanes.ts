import type { CadDocument } from "../document/schema";
import { documentTimeline, timelineItemId } from "../document/timelineOrdering";
import { stableBodyIdForFeature } from "./featureGraph";
import { faceReferenceBodyId } from "../document/faceReferences";
import { PocketFloorMismatchError, type KernelAdapter, type KernelShape } from "../kernel/KernelAdapter";
import type { RebuildError } from "../worker/workerProtocol";
import type { AvailableFace, resolveDocumentPlanes } from "../sketch/planes";

type PlaneResolution = ReturnType<typeof resolveDocumentPlanes>;

function validateFace(kernel: KernelAdapter, shape: KernelShape, face: AvailableFace, profiles: PlaneResolution["pocketFloorProfiles"]) {
  if (face.role === "pocketFloor") {
    const profile = profiles?.get(face.id);
    if (!profile || !kernel.validatePocketFloor) throw new Error("Pocket floor reference validation is unavailable. Reselect a supported upstream face.");
    kernel.validatePocketFloor(shape, face.transform, profile);
  } else {
    if (!kernel.validatePlanarFace) throw new Error("Native face reference validation is unavailable.");
    kernel.validatePlanarFace(shape, face.transform);
  }
}

function validateRetainedFace(kernel: KernelAdapter, shape: KernelShape, face: AvailableFace, profiles: PlaneResolution["pocketFloorProfiles"], retainedFloors?: ReadonlyMap<string, KernelShape>) {
  if (face.role === "pocketFloor") {
    const proved = retainedFloors?.get(face.id);
    if (!proved) throw new Error("Pocket floor was not created by its owner cut. Use a blind cut or reselect a supported upstream face.");
    if (proved === shape) return;
  }
  validateFace(kernel, shape, face, profiles);
}

// Plane metadata is resolved before modeling. Confirm references against the
// actual upstream shape at each sketch's timeline position, including sketches
// without a downstream feature. A later modifier does not invalidate an earlier sketch.
export function nativeSketchPlaneValidator(
  document: CadDocument,
  planes: PlaneResolution,
  kernel: KernelAdapter,
  bodies: ReadonlyMap<string, { shape: KernelShape }>,
  failedBodies: ReadonlySet<string>,
  errors: RebuildError[],
) {
  const timeline = documentTimeline(document);
  const rank = new Map(
    timeline.map((item, index) => [timelineItemId(item), index]),
  );
  const pending = timeline
    .flatMap((item) => (item.kind === "sketch" ? [item.sketch] : []))
    .filter(
      (sketch) =>
        sketch.plane.type === "face" ||
        (sketch.plane.type === "offset" &&
          typeof sketch.plane.base !== "string"),
    );
  const invalidSketchIds = new Set<string>();
  const retainedFloors = new Map<string, KernelShape>(), lostFloorErrors = new Map<string, string>();
  const floors = planes.faces.filter(face => face.role === "pocketFloor");
  const floorsByOwner = new Map(floors.map(face => [face.featureId, face]));
  const floorsById = new Map(floors.map(face => [face.id, face]));
  let pocketInput: { featureId: string; shape: KernelShape } | undefined;
  let next = 0;
  const validateUntil = (limit: number) => {
    while (next < pending.length && rank.get(pending[next].id)! < limit) {
      const sketch = pending[next++],
        ref =
          sketch.plane.type === "face"
            ? sketch.plane
            : sketch.plane.type === "offset" &&
                typeof sketch.plane.base !== "string"
              ? sketch.plane.base
              : undefined;
      if (!ref) continue;
      try {
        const bodyId = faceReferenceBodyId(document, ref),
          body = bodyId && bodies.get(bodyId),
          face = planes.faces.find(
            (face) =>
              face.id === ref.stableFaceId && face.featureId === ref.featureId,
          );
        if (!bodyId || !body || failedBodies.has(bodyId) || !face)
          throw new Error(
            "Sketch plane owner failed to build or was absorbed. Reselect a surviving upstream planar face.",
          );
        const lostFloor = lostFloorErrors.get(face.id);
        if (lostFloor) throw new Error(lostFloor);
        validateRetainedFace(kernel, body.shape, face, planes.pocketFloorProfiles, retainedFloors);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        invalidSketchIds.add(sketch.id);
        planes.transforms.delete(sketch.id);
        planes.errors.set(sketch.id, message);
        errors.push({
          id: `sketch:${sketch.id}:native-plane`,
          source: "sketch",
          sourceId: sketch.id,
          message,
        });
      }
    }
  };
  return {
    invalidSketchIds,
    retainedFloors,
    afterFeature: (id: string, affectedBodyIds: readonly string[]) => {
      // Once a successful modifier destroys a floor, a later lookalike cannot
      // revive its identity. Earlier sketches have already been validated.
      for (const [floorId, previous] of retainedFloors) {
        const floor = floorsById.get(floorId);
        if (!floor?.bodyId || !affectedBodyIds.includes(floor.bodyId)) continue;
        const current = bodies.get(floor.bodyId)?.shape;
        if (current === previous) continue;
        try {
          if (!current) throw new Error("Pocket floor target was removed or absorbed. Reselect a supported upstream face.");
          validateFace(kernel, current, floor, planes.pocketFloorProfiles);
          retainedFloors.set(floorId, current);
        } catch (error) {
          retainedFloors.delete(floorId);
          lostFloorErrors.set(floorId, error instanceof Error ? error.message : "Pocket floor was lost. Reselect a supported upstream face.");
        }
      }
      const face = floorsByOwner.get(id);
      const body = face?.bodyId ? bodies.get(face.bodyId) : undefined;
      const previous = pocketInput?.featureId === id ? pocketInput.shape : undefined;
      if (!face || !body || !previous || previous === body.shape) return;
      try {
        // Re-prove at this exact stage even when the cut shape came from the native cache.
        validateFace(kernel, body.shape, face, planes.pocketFloorProfiles);
      } catch { return; /* Through-depth and incomplete cuts do not create a usable floor. */ }
      try {
        validateFace(kernel, previous, face, planes.pocketFloorProfiles);
        lostFloorErrors.set(face.id, "This pocket floor already existed before its cut. Reselect the original supported face.");
      } catch (error) {
        // A definite mismatch establishes creation. Ambiguity, resource limits
        // and incomplete native inspection cannot authorize a new identity.
        if (error instanceof PocketFloorMismatchError) retainedFloors.set(face.id, body.shape);
        else lostFloorErrors.set(face.id, "Could not verify that this cut created the pocket floor. Reselect a supported upstream face.");
      }
    },
    beforeFeature: (id: string) => {
      const position = rank.get(id);
      if (position !== undefined) validateUntil(position);
      const bodyId = floorsByOwner.get(id)?.bodyId;
      const shape = bodyId && !failedBodies.has(bodyId) ? bodies.get(bodyId)?.shape : undefined;
      // This wrapper remains owned by the rebuild, including on cache hits.
      pocketInput = shape ? { featureId: id, shape } : undefined;
    },
    finish: () => validateUntil(Infinity),
  };
}

export function currentNativeFaces(
  faces: AvailableFace[],
  kernel: KernelAdapter,
  bodies: ReadonlyMap<string, { shape: KernelShape }>,
  failedBodies: ReadonlySet<string>,
  profiles?: PlaneResolution["pocketFloorProfiles"],
  retainedFloors?: ReadonlyMap<string, KernelShape>,
): AvailableFace[] {
  if (!kernel.validatePlanarFace) return [];
  return faces.filter((face) => {
    const id = face.bodyId ?? stableBodyIdForFeature(face.featureId),
      body = bodies.get(id);
    if (!body || failedBodies.has(id)) return false;
    try {
      validateRetainedFace(kernel, body.shape, face, profiles, retainedFloors);
      return true;
    } catch {
      // Lost or ambiguous faces are not offered for selection.
      return false;
    }
  });
}
