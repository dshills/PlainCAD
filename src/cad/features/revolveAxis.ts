import { RevolveAxisReference } from "../document/schema";
import { ResolvedRevolveAxis } from "../kernel/KernelAdapter";
import { dot, subtract } from "../kernel/occtGeometry";
import { linearProfileExtents } from "../sketch/profileExtents";
import { SketchPlaneTransform, transformPoint } from "../sketch/planes";
import { SketchProfile } from "../sketch/profileDetection";
import { ResolvedSketch } from "../sketch/SketchSolver";
import {
  ANGULAR_TOLERANCE,
  KERNEL_LINEAR_TOLERANCE,
} from "../sketch/tolerances";

export class RevolveAxisValidationError extends Error {
  name = "RevolveAxisValidationError";
}

const REVOLVE_ANGLE_TOLERANCE = 1e-9;

export function resolveRevolveAxis(
  ref: RevolveAxisReference,
  solved: ResolvedSketch,
  plane: SketchPlaneTransform,
  profile: SketchProfile,
  angle: number,
): ResolvedRevolveAxis {
  if (
    !Number.isFinite(angle) ||
    angle <= 0 ||
    angle > Math.PI * 2 + REVOLVE_ANGLE_TOLERANCE
  )
    throw new RevolveAxisValidationError(
      "Revolve angle must be greater than 0 and at most 360 degrees.",
    );
  let axis: ResolvedRevolveAxis;
  if (ref.type === "origin")
    axis = {
      origin: { x: 0, y: 0, z: 0 },
      direction: {
        x: ref.axis === "X" ? 1 : 0,
        y: ref.axis === "Y" ? 1 : 0,
        z: ref.axis === "Z" ? 1 : 0,
      },
    };
  else {
    if (ref.sketchId !== solved.id)
      throw new RevolveAxisValidationError(
        "Revolve axis must be a line in the profile sketch. Repair the axis reference.",
      );
    const line = solved.lines.find((l) => l.id === ref.lineId);
    if (!line)
      throw new RevolveAxisValidationError(
        "Revolve axis line was lost. Reselect a sketch line.",
      );
    const origin = transformPoint(plane, line.start.x, line.start.y),
      end = transformPoint(plane, line.end.x, line.end.y);
    const delta = subtract(end, origin),
      length = Math.hypot(delta.x, delta.y, delta.z);
    if (length <= KERNEL_LINEAR_TOLERANCE)
      throw new RevolveAxisValidationError(
        "Revolve axis line must have non-zero length.",
      );
    axis = {
      origin,
      direction: {
        x: delta.x / length,
        y: delta.y / length,
        z: delta.z / length,
      },
    };
  }
  if (
    Math.abs(dot(axis.direction, plane.normal)) > ANGULAR_TOLERANCE ||
    Math.abs(dot(subtract(axis.origin, plane.origin), plane.normal)) >
      KERNEL_LINEAR_TOLERANCE
  )
    throw new RevolveAxisValidationError(
      `${ref.type === "origin" ? `Origin ${ref.axis}` : "Sketch line"} axis must lie in the sketch plane.`,
    );
  const a = dot(axis.direction, plane.v),
    b = -dot(axis.direction, plane.u);
  const localOrigin = subtract(axis.origin, plane.origin);
  const shift = a * dot(localOrigin, plane.u) + b * dot(localOrigin, plane.v);
  const extents = linearProfileExtents(profile, a, b);
  const minimum = extents.min - shift,
    maximum = extents.max - shift;
  if (Math.max(Math.abs(minimum), Math.abs(maximum)) <= KERNEL_LINEAR_TOLERANCE)
    throw new RevolveAxisValidationError(
      "Revolve profile must have a non-zero radius from the axis.",
    );
  if (minimum < -KERNEL_LINEAR_TOLERANCE && maximum > KERNEL_LINEAR_TOLERANCE)
    throw new RevolveAxisValidationError(
      "Revolve profile must not cross the selected axis.",
    );
  return axis;
}
