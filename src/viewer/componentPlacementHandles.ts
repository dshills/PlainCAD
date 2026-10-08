import * as THREE from "three";
import type { ComponentPlacement } from "../cad/document/schema";
import { MAX_COMPONENT_ROTATION, MAX_COMPONENT_TRANSLATION, placementTransform } from "../cad/document/componentPlacement";
import { distanceAlongExtrusionAxis } from "./extrudeDistanceHandle";
export type PlacementAxis = 0 | 1 | 2;
export type PlacementMode = "translation" | "rotation";
export interface PlacementRing { origin: THREE.Vector3; normal: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }
export function componentPlacementMatrix(placement: ComponentPlacement) {
  const p = placementTransform(placement);
  return new THREE.Matrix4().set(p.u.x, p.v.x, p.normal.x, p.origin.x, p.u.y, p.v.y, p.normal.y, p.origin.y, p.u.z, p.v.z, p.normal.z, p.origin.z, 0, 0, 0, 1);
}
export function placementAxis(axis: PlacementAxis) { return new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0); }
/** Rz*Ry*Rx Euler fields rotate around these instantaneous axes. */
export function placementRotationRing(placement: ComponentPlacement, axis: PlacementAxis): PlacementRing {
  const [, ry, rz] = placement.rotation;
  const normal = axis === 0 ? new THREE.Vector3(Math.cos(rz) * Math.cos(ry), Math.sin(rz) * Math.cos(ry), -Math.sin(ry)) : axis === 1 ? new THREE.Vector3(-Math.sin(rz), Math.cos(rz), 0) : placementAxis(2);
  const auxiliary = Math.abs(normal.z) < 0.9 ? placementAxis(2) : placementAxis(1);
  const u = auxiliary.clone().cross(normal).normalize(), v = normal.clone().cross(u).normalize();
  return { origin: new THREE.Vector3(...placement.translation), normal, u, v };
}
export function placementDragDistance(camera: THREE.Camera, viewport: DOMRect, client: { x: number; y: number }, placement: ComponentPlacement, axis: PlacementAxis) {
  const normal = placementAxis(axis);
  return distanceAlongExtrusionAxis(camera, viewport, client, { origin: { x: placement.translation[0], y: placement.translation[1], z: placement.translation[2] }, normal: { x: normal.x, y: normal.y, z: normal.z }, direction: "positive" });
}
export function placementDragAngle(camera: THREE.Camera, viewport: DOMRect, client: { x: number; y: number }, ring: PlacementRing) {
  if (!(viewport.width > 0 && viewport.height > 0)) return;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((client.x - viewport.left) / viewport.width * 2 - 1, 1 - (client.y - viewport.top) / viewport.height * 2), camera);
  if (Math.abs(ray.ray.direction.dot(ring.normal)) < 0.05) return;
  const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(ring.normal, ring.origin), new THREE.Vector3());
  if (!hit) return;
  const delta = hit.sub(ring.origin);
  if (delta.lengthSq() < 1e-12) return;
  return Math.atan2(delta.dot(ring.v), delta.dot(ring.u));
}
export function wrappedRotationDelta(from: number, to: number) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); }
export function changedPlacementField(placement: ComponentPlacement, mode: PlacementMode, axis: PlacementAxis, value: number): ComponentPlacement {
  if (!Number.isFinite(value)) return placement;
  const limit = mode === "translation" ? MAX_COMPONENT_TRANSLATION : MAX_COMPONENT_ROTATION;
  const result: ComponentPlacement = { translation: [...placement.translation], rotation: [...placement.rotation] };
  result[mode][axis] = Math.max(-limit, Math.min(limit, Math.round(value * 1e6) / 1e6));
  return result;
}
