import type { ExtrudeFeature, Feature, ShellFeature } from "../document/schema";
import type { SketchProfile } from "../sketch/profileDetection";
import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";

export function isShellSource(feature: Feature | undefined): feature is ExtrudeFeature {
  return feature?.type === "extrude" && !feature.suppressed &&
    feature.operation === "newBody" && feature.direction === "positive" &&
    (!feature.termination || feature.termination.type === "distance");
}

export function requireShellOpening(opening: unknown): ShellFeature["opening"] {
  if (opening === "startCap" || opening === "endCap") return opening;
  throw new Error("Choose the start or end cap as the Shell opening.");
}

/** Recognize actual straight orthogonal sides, never infer a rectangle from its bounds alone. */
export function rectangularShellDimensions(profile: SketchProfile): [number, number] | undefined {
  const edges = profile.outerLoop.segments;
  if (profile.outerLoop.type !== "polygon" || !edges || edges.length !== 4 ||
      profile.innerLoops.length || profile.holes.length) return;
  const { minX, maxX, minY, maxY } = profile.bounds;
  const width = maxX - minX, height = maxY - minY;
  const tolerance = KERNEL_LINEAR_TOLERANCE;
  if (![width, height].every(n => Number.isFinite(n) && n > 10 * tolerance)) return;
  const corner = ({ x, y }: { x: number; y: number }) => {
    const i = Math.abs(x - minX) <= tolerance ? 0 : Math.abs(x - maxX) <= tolerance ? 1 : -1;
    const j = Math.abs(y - minY) <= tolerance ? 0 : Math.abs(y - maxY) <= tolerance ? 1 : -1;
    return i < 0 || j < 0 ? -1 : i + 2 * j;
  };
  const sides = new Set<number>();
  for (const edge of edges) {
    if (edge.type !== "line") return;
    const a = corner(edge.start), b = corner(edge.end);
    if (a < 0 || b < 0 || ((a ^ b) !== 1 && (a ^ b) !== 2)) return;
    sides.add(Math.min(a, b) * 4 + Math.max(a, b));
  }
  if (sides.size === 4) return [width, height];
}
