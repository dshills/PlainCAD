import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { changedPlacementField, componentPlacementMatrix, placementDragAngle, placementDragDistance, placementRotationRing, wrappedRotationDelta } from "../viewer/componentPlacementHandles";
import type { ComponentPlacement } from "../cad/document/schema";
const placement: ComponentPlacement = { translation: [10, 20, 30], rotation: [0.3, 0.4, 0.5] };
describe("placement gesture geometry", () => {
  it.each([0, 1, 2] as const)("Euler %i ring follows the exact saved rotation field", (axis) => {
    const ring = placementRotationRing(placement, axis), delta = 0.2;
    const original = new THREE.Vector3(4, 5, 6).applyMatrix4(componentPlacementMatrix(placement));
    const expected = original.clone().sub(ring.origin).applyAxisAngle(ring.normal, delta).add(ring.origin);
    const actual = new THREE.Vector3(4, 5, 6).applyMatrix4(componentPlacementMatrix(changedPlacementField(placement, "rotation", axis, placement.rotation[axis] + delta)));
    expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
    expect(ring.u.dot(ring.v)).toBeCloseTo(0, 12); expect(ring.u.clone().cross(ring.v).distanceTo(ring.normal)).toBeLessThan(1e-12);
  });
  it("preserves winding and lengths under live old-pose to new-pose display transforms", () => {
    const next = changedPlacementField(placement, "translation", 0, 70);
    const delta = componentPlacementMatrix(next).multiply(componentPlacementMatrix(placement).invert());
    expect(delta.determinant()).toBeCloseTo(1, 12);
    const point = new THREE.Vector3(1, 2, 3), placed = point.clone().applyMatrix4(componentPlacementMatrix(placement)).applyMatrix4(delta);
    expect(placed.distanceTo(point.applyMatrix4(componentPlacementMatrix(next)))).toBeLessThan(1e-10);
  });
  it("uses world-axis ray distances and refuses a parallel view", () => {
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000); camera.position.set(100, -100, 100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const viewport = { left: 0, top: 0, width: 400, height: 400 } as DOMRect;
    const pose: ComponentPlacement = { translation: [0, 0, 0], rotation: [0, 0, 0] };
    const project = (x: number) => { const p = new THREE.Vector3(x, 0, 0).project(camera); return { x: (p.x + 1) * 200, y: (1 - p.y) * 200 }; };
    expect(placementDragDistance(camera, viewport, project(15), pose, 0)! - placementDragDistance(camera, viewport, project(0), pose, 0)!).toBeCloseTo(15, 8);
    camera.position.set(100, 0, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    expect(placementDragDistance(camera, viewport, { x: 200, y: 200 }, pose, 0)).toBeUndefined();
  });
  it("unwraps rotation across the angle seam and caps finite placements", () => {
    expect(wrappedRotationDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(changedPlacementField(placement, "translation", 0, Infinity)).toBe(placement);
    expect(changedPlacementField(placement, "translation", 0, 1e9).translation[0]).toBe(1e8);
    expect(changedPlacementField(placement, "rotation", 0, 20).rotation[0]).toBe(Math.PI * 2);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000); camera.position.set(100, 0, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const ring = placementRotationRing({ translation: [0, 0, 0], rotation: [0, 0, 0] }, 2);
    expect(placementDragAngle(camera, { left: 0, top: 0, width: 400, height: 400 } as DOMRect, { x: 200, y: 200 }, ring)).toBeUndefined();
  });
});
