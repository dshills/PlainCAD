import * as THREE from "three";
import { cameraClipRange } from "../cad/inspection/cameraViews";

/** Fit the complete bounds in the narrower frustum dimension without changing orientation. */
export function fitCameraBounds(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  bounds: THREE.Box3,
) {
  if (bounds.isEmpty()) return false;
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const vertical = THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2);
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  const angle = Math.min(vertical, horizontal);
  if (!Number.isFinite(angle) || angle <= 0) return false;
  const radius = Math.max(sphere.radius, 1e-5);
  const distance = radius / Math.sin(angle) * 1.18;
  const direction = camera.position.clone().sub(target);
  if (direction.lengthSq() < 1e-12) direction.set(1, -1, 1);
  direction.normalize();
  target.copy(sphere.center);
  camera.position.copy(target).addScaledVector(direction, distance);
  Object.assign(camera, cameraClipRange(distance, radius * 2));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return true;
}
