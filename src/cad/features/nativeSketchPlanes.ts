import type { CadDocument } from "../document/schema";
import { documentTimeline, timelineItemId } from "../document/timelineOrdering";
import { stableBodyIdForFeature } from "./featureGraph";
import type { KernelAdapter, KernelShape } from "../kernel/KernelAdapter";
import type { RebuildError } from "../worker/workerProtocol";
import type { AvailableFace, resolveDocumentPlanes } from "../sketch/planes";

type PlaneResolution = ReturnType<typeof resolveDocumentPlanes>;

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
        const bodyId = stableBodyIdForFeature(ref.featureId),
          body = bodies.get(bodyId),
          face = planes.faces.find(
            (face) =>
              face.id === ref.stableFaceId && face.featureId === ref.featureId,
          );
        if (!body || failedBodies.has(bodyId) || !face)
          throw new Error(
            "Sketch plane owner failed to build or was absorbed. Reselect a surviving upstream planar face.",
          );
        if (!kernel.validatePlanarFace)
          throw new Error("Native face reference validation is unavailable.");
        kernel.validatePlanarFace(body.shape, face.transform);
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
    beforeFeature: (id: string) => {
      const position = rank.get(id);
      if (position !== undefined) validateUntil(position);
    },
    finish: () => validateUntil(Infinity),
  };
}

export function currentNativeFaces(
  faces: AvailableFace[],
  kernel: KernelAdapter,
  bodies: ReadonlyMap<string, { shape: KernelShape }>,
  failedBodies: ReadonlySet<string>,
): AvailableFace[] {
  if (!kernel.validatePlanarFace) return [];
  const validate = kernel.validatePlanarFace.bind(kernel);
  return faces.filter((face) => {
    const id = stableBodyIdForFeature(face.featureId),
      body = bodies.get(id);
    if (!body || failedBodies.has(id)) return false;
    try {
      validate(body.shape, face.transform);
      return true;
    } catch {
      // Lost or ambiguous faces are not offered for selection.
      return false;
    }
  });
}
