import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import { ModelMeshes } from "../viewer/modelMeshes";

function mesh(bodyId = "body"): RenderMesh {
  return { id: bodyId, bodyId, positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [10, 10, 0] } };
}
function body(cache: ModelMeshes, index = 0) { return cache.group.children[index] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; }

describe("viewer body buffer ownership", () => {
  it("reuses buffers and edge geometry for identical cloned payloads and appearance changes", () => {
    const cache = new ModelMeshes(), source = mesh();
    try {
      cache.update([source]);
      cache.setEdgesVisible(true);
      const original = body(cache), edges = original.children[0];
      const dispose = vi.spyOn(original.geometry, "dispose");
      cache.update([{ ...source, positions: [...Array.from(source.positions)], normals: [...Array.from(source.normals)], indices: [...source.indices], color: "#ff0000" }]);
      cache.setEdgesVisible(false);
      expect(body(cache)).toBe(original);
      expect(body(cache).children[0]).toBe(edges);
      expect(edges.visible).toBe(false);
      expect(original.material.color.getHexString()).toBe("ff0000");
      cache.setEdgesVisible(true);
      expect(original.children[0]).toBe(edges);
      expect(edges.visible).toBe(true);
      expect(dispose).not.toHaveBeenCalled();
    } finally { cache.dispose(); }
  });
  it.each(["positions", "normals", "indices"] as const)("replaces changed %s even with the same body ID and disposes old buffers once", (field) => {
    const cache = new ModelMeshes(), source = mesh();
    cache.update([source]);
    cache.setEdgesVisible(true);
    const old = body(cache), edge = old.children[0] as THREE.LineSegments;
    const geometry = vi.spyOn(old.geometry, "dispose"), material = vi.spyOn(old.material, "dispose"), edgeGeometry = vi.spyOn(edge.geometry, "dispose");
    try {
      const values = Array.from(source[field]);
      values[0] = field === "indices" ? 2 : 1;
      cache.update([{ ...source, [field]: values }]);
      cache.setEdgesVisible(true);
      expect(body(cache)).not.toBe(old);
      const attribute = field === "indices" ? body(cache).geometry.index! : body(cache).geometry.getAttribute(field === "normals" ? "normal" : "position");
      expect(Array.from(attribute.array)).toEqual(values);
      expect(geometry).toHaveBeenCalledOnce();
      expect(material).toHaveBeenCalledOnce();
      expect(edgeGeometry).toHaveBeenCalledOnce();
    } finally { cache.dispose(); }
    expect(geometry).toHaveBeenCalledOnce();
  });
  it("updates one of many bodies, retains native ordering, creates edges only on demand and disposes removed bodies", () => {
    const cache = new ModelMeshes(), first = mesh("first"), second = mesh("second");
    try {
      cache.update([first, second]);
      const a = body(cache), b = body(cache, 1), disposed = vi.spyOn(b.geometry, "dispose");
      const unrelated = new THREE.Object3D();
      a.add(unrelated);
      cache.setEdgesVisible(false);
      expect(a.children).toHaveLength(1);
      expect(unrelated.visible).toBe(true);
      cache.setEdgesVisible(true);
      expect(a.children).toHaveLength(2);
      cache.setEdgesVisible(false);
      expect(unrelated.visible).toBe(true);
      cache.update([second, { ...first, positions: [0, 0, 0, 20, 0, 0, 0, 10, 0] }]);
      expect(body(cache)).toBe(b);
      expect(body(cache, 1)).not.toBe(a);
      expect(body(cache, 1).geometry.getAttribute("position").getX(1)).toBe(20);
      cache.update([first]);
      expect(disposed).toHaveBeenCalledOnce();
      cache.dispose();
      cache.dispose();
      expect(cache.group.children).toHaveLength(0);
      expect(disposed).toHaveBeenCalledOnce();
    } finally { cache.dispose(); }
  });
  it("rejects duplicate IDs without leaking newly created buffers or replacing the visible model", () => {
    const cache = new ModelMeshes();
    cache.update([mesh("kept")]);
    const kept = body(cache), keptDisposed = vi.fn();
    kept.geometry.addEventListener("dispose", keptDisposed);
    const disposed = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    try {
      expect(() => cache.update([mesh("new"), mesh("new")])).toThrow(/duplicate body/);
      expect(body(cache)).toBe(kept);
      expect(keptDisposed).not.toHaveBeenCalled();
      expect(disposed).toHaveBeenCalledOnce();
    } finally { cache.dispose(); disposed.mockRestore(); }
  });
});
