import * as THREE from "three";
import type { ExtrudeFeature } from "../cad/document/schema";
import type { Point3 } from "../cad/sketch/planes";

export interface DistanceAxis {
  origin: Point3;
  normal: Point3;
  direction: ExtrudeFeature["direction"];
}
export function extrusionHandleAxis(axis: DistanceAxis) {
  return new THREE.Vector3(axis.normal.x, axis.normal.y, axis.normal.z)
    .normalize()
    .multiplyScalar(axis.direction === "negative" ? -1 : 1);
}
export function extrusionHandleScale(direction: ExtrudeFeature["direction"]) {
  return direction === "symmetric" ? 0.5 : 1;
}
export function extrusionHandleEndpoint(axis: DistanceAxis, distance: number) {
  return new THREE.Vector3(
    axis.origin.x,
    axis.origin.y,
    axis.origin.z,
  ).addScaledVector(
    extrusionHandleAxis(axis),
    distance * extrusionHandleScale(axis.direction),
  );
}
/** Closest ray/axis approach. Near parallel views require orbiting, never an arbitrary screen-axis fallback. */
export function distanceAlongExtrusionAxis(
  camera: THREE.Camera,
  viewport: { left: number; top: number; width: number; height: number },
  client: { x: number; y: number },
  axis: DistanceAxis,
): number | undefined {
  if (!(viewport.width > 0 && viewport.height > 0)) return;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((client.x - viewport.left) / viewport.width) * 2 - 1,
      -((client.y - viewport.top) / viewport.height) * 2 + 1,
    ),
    camera,
  );
  const direction = extrusionHandleAxis(axis),
    relative = new THREE.Vector3(
      axis.origin.x,
      axis.origin.y,
      axis.origin.z,
    ).sub(ray.ray.origin),
    cosine = direction.dot(ray.ray.direction),
    denominator = 1 - cosine * cosine;
  if (denominator < 0.0025) return;
  const value =
    (cosine * ray.ray.direction.dot(relative) - direction.dot(relative)) /
    denominator;
  return Number.isFinite(value) ? value : undefined;
}
export const MIN_EXTRUSION_DISTANCE_MM = 0.001;
function roundedDistanceMm(value: number) {
  return Math.max(MIN_EXTRUSION_DISTANCE_MM, Math.round(value * 1000) / 1000);
}
/** Keyboard arrows change total depth, including symmetric mode. */
export function steppedExtrusionDistance(
  distance: number,
  sign: number,
  largeStep: boolean,
) {
  return roundedDistanceMm(distance + sign * (largeStep ? 10 : 1));
}
export function draggedExtrusionDistance(
  original: number,
  startAxis: number,
  currentAxis: number,
  direction: ExtrudeFeature["direction"],
) {
  // Positive distance magnitudes retain the selected direction. Symmetric uses total depth.
  return roundedDistanceMm(
    original + (currentAxis - startAxis) / extrusionHandleScale(direction),
  );
}
export function literalExtrusionDistance(expression: string) {
  return /^\s*\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*(?:mm|cm|m|in|ft)?\s*$/i.test(
    expression,
  );
}
