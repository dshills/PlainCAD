import { orientedSegments } from "../kernel/profileMesh";
import type { SketchProfile } from "./profileDetection";
import { ANGULAR_TOLERANCE } from "./tolerances";

/** Exact extrema of a*x+b*y on a profile's outer analytic boundary. */
export function linearProfileExtents(
  profile: SketchProfile,
  a: number,
  b: number,
): { min: number; max: number } {
  if (profile.outerLoop.type === "circle") {
    const center =
      (a * (profile.bounds.minX + profile.bounds.maxX)) / 2 +
      (b * (profile.bounds.minY + profile.bounds.maxY)) / 2;
    const extent =
      ((profile.bounds.maxX - profile.bounds.minX) / 2) * Math.hypot(a, b);
    return { min: center - extent, max: center + extent };
  }
  let min = Infinity,
    max = -Infinity;
  const include = (x: number, y: number) => {
    const value = a * x + b * y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  };
  for (const segment of orientedSegments(profile.outerLoop, false)) {
    include(segment.start.x, segment.start.y);
    include(segment.end.x, segment.end.y);
    if (segment.type !== "arc") continue;
    for (const theta of [Math.atan2(b, a), Math.atan2(b, a) + Math.PI]) {
      const signed =
        segment.sweep >= 0
          ? theta - segment.startAngle
          : segment.startAngle - theta;
      const progress = ((signed % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (progress <= Math.abs(segment.sweep) + ANGULAR_TOLERANCE)
        include(
          segment.center.x + segment.radius * Math.cos(theta),
          segment.center.y + segment.radius * Math.sin(theta),
        );
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max))
    throw new Error("Profile has no finite analytic boundary.");
  return { min, max };
}
