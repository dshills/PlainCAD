import { rectangularShellDimensions, requireShellOpening } from "../features/shellFeature";
import type { ShellFeature } from "../document/schema";
import type { SketchProfile } from "../sketch/profileDetection";
import { type SketchPlaneTransform, transformPoint } from "../sketch/planes";
import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";
import { withDisposableScope } from "./disposableScope";
import { measureShape, planarFaces, volumeTolerance } from "./occtGeometry";
import type { GeometryAssertions } from "./KernelAdapter";

export function nativeShellAvailable(oc?: Record<string, any>): boolean {
  return typeof oc?.BRepOffsetAPI_MakeThickSolid_1 === "function" &&
    typeof oc.BRepOffsetAPI_MakeThickSolid?.prototype.MakeThickSolidByJoin === "function" &&
    typeof oc.TopTools_ListOfShape_1 === "function" &&
    typeof oc.TopTools_ListOfShape?.prototype.Append_1 === "function" &&
    !!oc.BRepOffset_Mode?.BRepOffset_Skin && !!oc.GeomAbs_JoinType?.GeomAbs_Intersection;
}

/** Transfers exactly one validated result handle to the caller's ownership. */
export function createNativeShell(
  oc: Record<string, any>,
  source: any,
  profile: SketchProfile,
  depth: number,
  plane: SketchPlaneTransform,
  opening: ShellFeature["opening"],
  wall: number,
  before: GeometryAssertions,
): { native: any; proof: GeometryAssertions } {
  if (!nativeShellAvailable(oc)) throw new Error("This OpenCascade build does not support native Shell.");
  requireShellOpening(opening);
  const dimensions = rectangularShellDimensions(profile);
  if (!dimensions || !Number.isFinite(depth) || depth <= 0)
    throw new Error("Shell requires a straight, axis-aligned rectangular profile without holes and a positive distance extrusion.");
  const [width, height] = dimensions;
  const minimum = 10 * KERNEL_LINEAR_TOLERANCE;
  if (!Number.isFinite(wall) || wall < minimum)
    throw new Error("Wall thickness must be at least 0.000001 mm.");
  if (Math.min(width - 2 * wall, height - 2 * wall, depth - wall) <= minimum)
    throw new Error("Wall thickness collapses the cavity. Use less than half the smaller side and less than the extrusion depth.");
  const original = width * height * depth;
  const removed = (width - 2 * wall) * (height - 2 * wall) * (depth - wall);
  const expected = original - removed;
  if (before.solidCount !== 1 || Math.abs(before.volume - original) > Math.max(1e-7, original * 1e-8) ||
      removed <= volumeTolerance(before.volume) || expected <= volumeTolerance(before.volume))
    throw new Error("Shell requires one unchanged rectangular solid with measurable wall and cavity volumes.");
  const cap = { ...plane, origin: transformPoint(plane, 0, 0, opening === "endCap" ? depth : 0) };
  return withDisposableScope(scope => {
    const faces = planarFaces(oc, source, cap, scope);
    if (faces.length !== 1) throw new Error("Shell opening cap was lost or became ambiguous.");
    const closing = scope.use(new oc.TopTools_ListOfShape_1());
    closing.Append_1(faces[0]);
    const builder = scope.use(new oc.BRepOffsetAPI_MakeThickSolid_1());
    builder.MakeThickSolidByJoin(
      source, closing, -wall, KERNEL_LINEAR_TOLERANCE,
      oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false,
    );
    if (!builder.IsDone()) throw new Error("OpenCascade could not build the wall. Reduce the thickness.");
    const native = scope.use(builder.Shape());
    const proof = measureShape(oc, native);
    if (proof.solidCount !== 1 || before.volume - proof.volume <= volumeTolerance(before.volume) ||
        Math.abs(proof.volume - expected) > Math.max(1e-7, expected * 1e-8))
      throw new Error("Shell did not produce the expected single solid and cavity volume. Reduce the wall thickness.");
    return { native: scope.release(native), proof };
  });
}
