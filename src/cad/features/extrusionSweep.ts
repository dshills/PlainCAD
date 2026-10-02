import { ExtrudeFeature } from "../document/schema";
import { RenderMesh } from "../kernel/KernelAdapter";
import { SketchPlaneTransform } from "../sketch/planes";

export function extrusionSweep(
  transform: SketchPlaneTransform,
  distance: number,
  direction: ExtrudeFeature["direction"],
): SketchPlaneTransform {
  if (!Number.isFinite(distance) || distance <= 0)
    throw new Error("Extrude distance must be a positive finite length.");
  const start =
    direction === "negative"
      ? -distance
      : direction === "symmetric"
        ? -distance / 2
        : 0;
  const origin = {
    x: transform.origin.x + start * transform.normal.x,
    y: transform.origin.y + start * transform.normal.y,
    z: transform.origin.z + start * transform.normal.z,
  };
  if (!Object.values(origin).every(Number.isFinite))
    throw new Error("Extrusion coordinates exceed the finite geometry range.");
  // Always build a positive prism from the shifted start plane; preserve the right-handed basis.
  return { ...transform, origin };
}

export function throughAllDistance(
  bounds: RenderMesh["bounds"],
  transform: SketchPlaneTransform,
  direction: ExtrudeFeature["direction"] = "positive",
): number | undefined {
  const length = Math.hypot(
    transform.normal.x,
    transform.normal.y,
    transform.normal.z,
  );
  if (!Number.isFinite(length) || length <= 1e-9) return undefined;
  let min = Infinity,
    max = -Infinity;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const position =
          ((x - transform.origin.x) * transform.normal.x +
            (y - transform.origin.y) * transform.normal.y +
            (z - transform.origin.z) * transform.normal.z) /
          length;
        if (!Number.isFinite(position)) return undefined;
        min = Math.min(min, position);
        max = Math.max(max, position);
      }
  const extent =
    direction === "negative"
      ? -min
      : direction === "symmetric"
        ? 2 * Math.max(Math.abs(min), Math.abs(max))
        : max;
  return extent > 0
    ? extent + (direction === "symmetric" ? 2e-7 : 1e-7)
    : undefined;
}
