import { expect, it } from "vitest";
import * as THREE from "three";
import { fitCameraBounds } from "../viewer/cameraFit";

it.each([0.2, 0.6, 1, 2.5])("fits all bounds corners at aspect %s while retaining orientation", (aspect) => {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(120, -140, 110);
  const target = new THREE.Vector3();
  const direction = camera.position.clone().sub(target).normalize();
  const bounds = new THREE.Box3(new THREE.Vector3(-100, -20, -4), new THREE.Vector3(80, 60, 35));
  expect(fitCameraBounds(camera, target, bounds)).toBe(true);
  expect(camera.position.clone().sub(target).normalize().distanceTo(direction)).toBeLessThan(1e-12);
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    expect(Math.abs(point.x)).toBeLessThan(1);
    expect(Math.abs(point.y)).toBeLessThan(1);
    expect(Math.abs(point.z)).toBeLessThan(1);
  }
});

it("leaves an empty camera unchanged and fits tiny or coincident bounds safely", () => {
  const camera = new THREE.PerspectiveCamera(40, 1);
  const target = new THREE.Vector3();
  expect(fitCameraBounds(camera, target, new THREE.Box3())).toBe(false);
  expect(camera.position.toArray()).toEqual([0, 0, 0]);
  expect(fitCameraBounds(camera, target, new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()))).toBe(true);
  expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  expect(camera.position.distanceTo(target)).toBeGreaterThan(0);
});

it("frames a submillimeter part at its own scale", () => {
  const camera = new THREE.PerspectiveCamera(45, 1);
  camera.position.set(1, -1, 1);
  const target = new THREE.Vector3();
  const bounds = new THREE.Box3(new THREE.Vector3(-0.01, -0.01, -0.01), new THREE.Vector3(0.01, 0.01, 0.01));
  expect(fitCameraBounds(camera, target, bounds)).toBe(true);
  expect(camera.position.distanceTo(target)).toBeLessThan(0.1);
  const points = [bounds.min.clone().project(camera), bounds.max.clone().project(camera)];
  expect(Math.max(...points.map((point) => Math.abs(point.y)))).toBeGreaterThan(0.25);
  expect(points.every((point) => Math.abs(point.z) < 1)).toBe(true);
});
