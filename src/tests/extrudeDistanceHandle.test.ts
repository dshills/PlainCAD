import { expect, it } from "vitest";
import * as THREE from "three";
import { sketchPlaneTransform } from "../cad/sketch/planes";
import {
  distanceAlongExtrusionAxis,
  draggedExtrusionDistance,
  extrusionHandleEndpoint,
  literalExtrusionDistance,
} from "../viewer/extrudeDistanceHandle";
const viewport = { left: 30, top: 50, width: 700, height: 400 };
for (const plane of ["XY", "XZ", "YZ"] as const) {
  for (const direction of ["positive", "negative", "symmetric"] as const) {
    it(`projects ${plane} ${direction} dragging onto the actual world normal`, () => {
      const axis = {
          origin: { x: 3, y: -2, z: 1 },
          normal: sketchPlaneTransform(plane).normal,
          direction,
        },
        camera = new THREE.PerspectiveCamera(
          40,
          viewport.width / viewport.height,
          0.01,
          1000,
        );
      camera.up.set(0, 0, 1);
      camera.position.set(60, -80, 55);
      camera.lookAt(3, -2, 1);
      camera.updateMatrixWorld();
      const project = (distance: number) => {
        const point = extrusionHandleEndpoint(axis, distance).project(camera);
        return {
          x: viewport.left + ((point.x + 1) / 2) * viewport.width,
          y: viewport.top + ((1 - point.y) / 2) * viewport.height,
        };
      };
      const start = distanceAlongExtrusionAxis(
          camera,
          viewport,
          project(10),
          axis,
        )!,
        end = distanceAlongExtrusionAxis(camera, viewport, project(17), axis)!;
      expect(start).toBeCloseTo(direction === "symmetric" ? 5 : 10, 8);
      expect(draggedExtrusionDistance(10, start, end, direction)).toBeCloseTo(
        17,
        6,
      );
      // One signed world axis, with symmetric distance measured across both ends.
      const endpoint = extrusionHandleEndpoint(axis, 17),
        origin = new THREE.Vector3(3, -2, 1);
      expect(endpoint.distanceTo(origin)).toBeCloseTo(
        direction === "symmetric" ? 8.5 : 17,
        8,
      );
      expect(
        endpoint
          .clone()
          .sub(origin)
          .dot(new THREE.Vector3(axis.normal.x, axis.normal.y, axis.normal.z)),
      ).toBeCloseTo(
        direction === "negative" ? -17 : direction === "symmetric" ? 8.5 : 17,
        8,
      );
    });
  }
}
it("disables ambiguous parallel views and empty viewports rather than guessing a direction", () => {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000),
    axis = {
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      direction: "positive" as const,
    };
  camera.position.set(0, 0, 60);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  expect(
    distanceAlongExtrusionAxis(camera, viewport, { x: 380, y: 250 }, axis),
  ).toBeUndefined();
  expect(
    distanceAlongExtrusionAxis(
      camera,
      { ...viewport, width: 0 },
      { x: 30, y: 50 },
      axis,
    ),
  ).toBeUndefined();
  expect(draggedExtrusionDistance(10, 10, -5, "positive")).toBe(0.001);
});
it("permits literal lengths without replacing formulas or parameter bindings", () => {
  for (const value of ["10", "1.5mm", " .25 in ", "+2e1cm"])
    expect(literalExtrusionDistance(value)).toBe(true);
  for (const value of [
    "thickness",
    "thickness*2",
    "2*5mm",
    "sqrt(4)*1mm",
    "",
    "NaN",
    "-2mm",
  ])
    expect(literalExtrusionDistance(value)).toBe(false);
});
