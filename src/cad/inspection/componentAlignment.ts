import type { CadDocument, ComponentPlacement } from "../document/schema";
import { bodyComponentId } from "../document/components";
import { placementTransform, placedPoint, placedVector, validComponentPlacement } from "../document/componentPlacement";
import type { Point3 } from "../sketch/planes";
import type { RebuildResult } from "../worker/workerProtocol";
import { modelMeasurementTargets } from "./modelMeasurements";
import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";

export interface ComponentAlignmentTarget {
  id: string;
  label: string;
  componentId: string;
  bodyId: string;
  kind: "point" | "edge" | "face";
  point: Point3;
  /** Display-only tessellated centroid; exact plane origin still governs alignment. */
  displayPoint?: Point3;
  direction?: Point3;
}
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Point3, n: number): Point3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const finite = (p: Point3) => [p.x, p.y, p.z].every(Number.isFinite);
function unit(p: Point3): Point3 {
  const size = Math.hypot(p.x, p.y, p.z);
  if (!finite(p) || size < 1e-12) throw new Error("Alignment direction is missing or degenerate. Choose another supported native reference.");
  return scale(p, 1 / size);
}

/** Only current, native-validated authored references authorize alignment. */
export function componentAlignmentTargets(document: CadDocument, result: RebuildResult): ComponentAlignmentTarget[] {
  const native = new Set(result.meshes.filter(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid).map(mesh => mesh.bodyId));
  let visits = 0;
  const faceMarker = (bodyId: string, origin: Point3, normal: Point3): Point3 | undefined => {
    const mesh = result.meshes.find(mesh => mesh.bodyId === bodyId);
    if (!mesh) return;
    let area = 0, total: Point3 = { x: 0, y: 0, z: 0 };
    if (visits + Math.floor(mesh.indices.length / 3) > 250000) return;
    for (let i = 0; i + 2 < mesh.indices.length && visits < 250000; i += 3, visits++) {
      const points = [0, 1, 2].map(vertex => { const index = mesh.indices[i + vertex] * 3; return { x: mesh.positions[index], y: mesh.positions[index + 1], z: mesh.positions[index + 2] }; });
      if (!points.every(p => finite(p) && Math.abs(dot(subtract(p, origin), normal)) <= KERNEL_LINEAR_TOLERANCE * 10)) continue;
      const weight = dot(cross(subtract(points[1], points[0]), subtract(points[2], points[0])), normal);
      if (weight <= 0) continue;
      total = add(total, scale(add(add(points[0], points[1]), points[2]), weight / 3)); area += weight;
    }
    return area > 0 ? scale(total, 1 / area) : undefined;
  };
  return modelMeasurementTargets(document, result).flatMap((target): ComponentAlignmentTarget[] => {
    if (!target.bodyId || !native.has(target.bodyId)) return [];
    const componentId = bodyComponentId(document, target.bodyId);
    if (!componentId || !document.components[componentId]) return [];
    const base = { id: target.id, label: `${document.components[componentId]?.name ?? "Part"} · ${target.label}`, bodyId: target.bodyId, componentId };
    if (target.point && finite(target.point)) return [{ ...base, kind: "point", point: target.point }];
    if (target.plane && finite(target.plane.origin) && finite(target.plane.normal)) {
      if (Math.hypot(target.plane.normal.x, target.plane.normal.y, target.plane.normal.z) < 1e-12) return [];
      const direction = unit(target.plane.normal);
      return [{ ...base, kind: "face", point: target.plane.origin, direction, displayPoint: faceMarker(target.bodyId, target.plane.origin, direction) }];
    }
    const path = target.paths[0];
    if (target.kind === "curve" && target.direction && finite(target.direction) && Math.hypot(target.direction.x, target.direction.y, target.direction.z) >= 1e-12 && !target.closed && path?.length === 2 && path.every(finite))
      return [{ ...base, kind: "edge", point: scale(add(path[0], path[1]), 0.5), direction: unit(target.direction) }];
    return [];
  });
}

/** Transform a reference from the captured pose to a transient rigid pose. */
export function placedAlignmentTarget(target: ComponentAlignmentTarget, captured: ComponentPlacement, current: ComponentPlacement): ComponentAlignmentTarget {
  const before = placementTransform(captured), after = placementTransform(current);
  const inverse = (p: Point3): Point3 => ({ x: dot(p, before.u), y: dot(p, before.v), z: dot(p, before.normal) });
  return { ...target, point: placedPoint(after, inverse(subtract(target.point, before.origin))),
    ...(target.displayPoint ? { displayPoint: placedPoint(after, inverse(subtract(target.displayPoint, before.origin))) } : {}),
    ...(target.direction ? { direction: placedVector(after, inverse(target.direction)) } : {}) };
}

function shortestRotation(first: Point3, second: Point3): (p: Point3) => Point3 {
  const a = unit(first), b = unit(second), cosine = Math.max(-1, Math.min(1, dot(a, b))), axis = cross(a, b);
  const sine = Math.hypot(axis.x, axis.y, axis.z);
  if (sine < 1e-12 && cosine > 0) return p => p;
  const n = sine < 1e-12 ? unit(cross(a, Math.abs(a.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 })) : scale(axis, 1 / sine);
  return p => add(add(scale(p, cosine), scale(cross(n, p), sine)), scale(n, dot(n, p) * (1 - cosine)));
}
function euler(u: Point3, v: Point3, normal: Point3): ComponentPlacement["rotation"] {
  const y = Math.asin(Math.max(-1, Math.min(1, -u.z)));
  const values: ComponentPlacement["rotation"] = Math.abs(Math.cos(y)) > 1e-10
    ? [Math.atan2(v.z, normal.z), y, Math.atan2(u.y, u.x)]
    : [0, y, Math.atan2(-v.x, v.y)];
  return values.map(value => Math.abs(value) < 1e-12 ? 0 : value) as ComponentPlacement["rotation"];
}

/** Face alignment preserves tangential translation; edges match midpoints, points coincide.
 * This produces a placement snapshot, never a persistent mate or a geometry edit. */
export function alignComponentGeometry(source: ComponentAlignmentTarget, target: ComponentAlignmentTarget, captured: ComponentPlacement, current: ComponentPlacement, clearance = 0, opposite = true): ComponentPlacement {
  if (source.componentId === target.componentId || source.kind !== target.kind)
    throw new Error("Choose matching points, straight edges or planar faces on two different components.");
  if (!Number.isFinite(clearance) || Math.abs(clearance) > 1e8 || (source.kind !== "face" && clearance !== 0))
    throw new Error("Clearance accepts finite millimeters for planar faces only, within ±100,000,000 mm.");
  const moved = placedAlignmentTarget(source, captured, current);
  let rotation = current.rotation;
  if (source.kind !== "point") {
    if (!moved.direction || !target.direction) throw new Error("Alignment needs two supported native directions.");
    const rotate = shortestRotation(moved.direction, scale(target.direction, opposite ? -1 : 1)), frame = placementTransform(current);
    rotation = euler(rotate(frame.u), rotate(frame.v), rotate(frame.normal));
  }
  const rotated: ComponentPlacement = { translation: [...current.translation], rotation: [...rotation] };
  const point = placedAlignmentTarget(source, captured, rotated).point;
  const delta = subtract(target.point, point);
  const shift = source.kind === "face" ? scale(unit(target.direction!), dot(delta, unit(target.direction!)) + clearance) : delta;
  const origin = add({ x: current.translation[0], y: current.translation[1], z: current.translation[2] }, shift);
  const next: ComponentPlacement = { translation: [origin.x, origin.y, origin.z], rotation: [...rotation] };
  if (!validComponentPlacement(next)) throw new Error("Aligned placement exceeds the supported position or rotation limits.");
  return next;
}
