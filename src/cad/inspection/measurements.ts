import type { CadDocument, UnitSettings } from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import { transformPoint, type Point3 } from "../sketch/planes";

export class MeasurementError extends Error {}

export interface SketchMeasurementRef {
  sketchId: string;
  entityId: string;
}
export interface DistanceMeasurement {
  start: Point3;
  end: Point3;
  delta: Point3;
  length: number;
}
export interface EntityMeasurement {
  length: number;
  radius?: number;
  diameter?: number;
  sweepDegrees?: number;
}

function resolved(
  document: CadDocument,
  result: RebuildResult,
  ref: SketchMeasurementRef,
) {
  if (!result.success || result.documentId !== document.id)
    throw new MeasurementError(
      "Measurements require a successful rebuild of the current project.",
    );
  const sketch = document.sketches[ref.sketchId],
    entity = sketch?.entities[ref.entityId];
  const solved = result.solvedSketches?.[ref.sketchId],
    plane = result.sketchPlanes?.[ref.sketchId];
  if (
    !entity ||
    !solved ||
    !plane ||
    solved.errors.some((error) => error.severity === "error")
  )
    throw new MeasurementError(
      "Measurement reference is unavailable. Reselect solved sketch geometry.",
    );
  return { entity, solved, plane };
}
function finite(...values: number[]) {
  if (!values.every(Number.isFinite))
    throw new MeasurementError("Measurement geometry is not finite.");
}
export function measureWorldPoint(
  document: CadDocument,
  result: RebuildResult,
  ref: SketchMeasurementRef,
): Point3 {
  const { entity, solved, plane } = resolved(document, result, ref);
  const point = solved.points[ref.entityId];
  if (entity.type !== "point" || !point)
    throw new MeasurementError("Select an available sketch point.");
  const world = transformPoint(plane, point.x, point.y);
  finite(world.x, world.y, world.z);
  return world;
}
export function pointDistance(start: Point3, end: Point3): DistanceMeasurement {
  finite(start.x, start.y, start.z, end.x, end.y, end.z);
  const delta = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  finite(length);
  return { start, end, delta, length };
}
export function measureSketchEntity(
  document: CadDocument,
  result: RebuildResult,
  ref: SketchMeasurementRef,
): EntityMeasurement {
  const { entity, solved, plane } = resolved(document, result, ref);
  const line = solved.lines.find((line) => line.id === ref.entityId);
  if (entity.type === "line" && line)
    return {
      length: pointDistance(
        transformPoint(plane, line.start.x, line.start.y),
        transformPoint(plane, line.end.x, line.end.y),
      ).length,
    };
  const arc =
    entity.type === "arc"
      ? solved.arcs.find((arc) => arc.id === ref.entityId)
      : undefined;
  const curve =
    arc ??
    (entity.type === "circle"
      ? solved.circles.find((circle) => circle.id === ref.entityId)
      : undefined);
  if (!curve || curve.radius <= 0)
    throw new MeasurementError(
      "Select an available sketch line, circle, or arc.",
    );
  const sweep = arc?.sweep ?? 2 * Math.PI;
  finite(curve.radius, sweep);
  const length = curve.radius * Math.abs(sweep);
  finite(length, curve.radius * 2);
  return {
    length,
    radius: curve.radius,
    diameter: 2 * curve.radius,
    ...(entity.type === "arc"
      ? { sweepDegrees: (Math.abs(sweep) * 180) / Math.PI }
      : {}),
  };
}
const MM_PER_UNIT = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
export function formatMeasuredLength(
  mm: number,
  unit: UnitSettings["length"],
): string {
  finite(mm);
  const rounded = Number((mm / MM_PER_UNIT[unit]).toFixed(4));
  return `${(rounded === 0 ? 0 : rounded).toFixed(4)} ${unit}`;
}
