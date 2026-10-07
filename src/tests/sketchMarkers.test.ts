import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { addSketchMarkers, inspectSketchMarkers } from "../viewer/sketchMarkers";

describe("batched sketch markers", () => {
  it("keeps all IDs and world positions with one instance batch and a correct culling bound", () => {
    const geometry = new THREE.SphereGeometry(1.4, 12, 8), material = new THREE.MeshBasicMaterial();
    const group = new THREE.Group();
    const markers = Array.from({ length: 400 }, (_, index) => ({ id: `p${index}`, position: [index * 10, index % 2 ? -100 : 50, index % 3] as [number, number, number] }));
    try {
      addSketchMarkers(group, markers, geometry, material);
      const batch = group.children[0] as THREE.InstancedMesh;
      expect(group.children).toHaveLength(1);
      expect(batch.count).toBe(400);
      expect(inspectSketchMarkers(group)).toEqual(markers);
      for (const marker of markers) expect(batch.boundingSphere!.containsPoint(new THREE.Vector3(...marker.position))).toBe(true);
      group.position.set(1, 2, 3);
      expect(inspectSketchMarkers(group)[399].position).toEqual(markers[399].position.map((value, index) => value + index + 1));
      // Instance buffers are owned by the batch; shared geometry/material stay with the viewer.
      const dispose = vi.spyOn(geometry, "dispose"), disposeMaterial = vi.spyOn(material, "dispose");
      batch.dispose();
      expect(dispose).not.toHaveBeenCalled();
      expect(disposeMaterial).not.toHaveBeenCalled();
    } finally { geometry.dispose(); material.dispose(); }
  });
  it("creates separate batches for normal/error colors and allocates nothing for hidden/empty points", () => {
    const group = new THREE.Group(), geometry = new THREE.SphereGeometry(1.4, 12, 8);
    const normal = new THREE.MeshBasicMaterial({ color: "#245c87" }), error = new THREE.MeshBasicMaterial({ color: "#c53a35" });
    try {
      addSketchMarkers(group, [], geometry, normal);
      expect(group.children).toHaveLength(0);
      addSketchMarkers(group, [{ id: "normal", position: [1, 2, 3] }], geometry, normal);
      addSketchMarkers(group, [{ id: "error", position: [-1, -2, -3] }], geometry, error);
      expect(group.children.map((object) => (object as THREE.InstancedMesh).material)).toEqual([normal, error]);
      expect(inspectSketchMarkers(group).map((point) => point.id)).toEqual(["normal", "error"]);
    } finally { group.children.forEach((object) => (object as THREE.InstancedMesh).dispose()); geometry.dispose(); normal.dispose(); error.dispose(); }
  });
});
