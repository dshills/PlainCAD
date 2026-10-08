import { describe, expect, it, vi } from "vitest";
import { NativeFeatureCache, type CachedRuntimeBody } from "../cad/features/nativeFeatureCache";
import type { KernelAdapter, KernelShape } from "../cad/kernel/KernelAdapter";

function fixture() {
  let id = 0;
  const dispose = vi.fn((shape: KernelShape) => { (shape.kernelHandle as { deleted: boolean }).deleted = true; });
  const clone = vi.fn((shape: KernelShape) => {
    if ((shape.kernelHandle as { deleted: boolean }).deleted) throw new Error("use after dispose");
    return { ...shape, id: `copy:${++id}`, kernelHandle: { deleted: false } };
  });
  const kernel = { cloneShape: clone, disposeShape: dispose } as unknown as KernelAdapter;
  const body: CachedRuntimeBody = { shape: { id: "original", kernelHandle: { deleted: false } }, name: "Base", featureId: "base", planeKey: "XY", mesh: { id: "mesh", bodyId: "body:base", positions: [0, 0, 0], normals: [0, 0, 1], indices: [0, 0, 0], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 1, surfaceArea: 6, solidCount: 1 } } };
  return { kernel, body, clone, dispose };
}

describe("native feature cache ownership", () => {
  it("clones admission and retrieval, survives runtime disposal, and isolates mesh mutations", () => {
    const { kernel, body, dispose } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel, 1);
    const version = cache.stage("exact", [["body:base", body]], ["absorbed"]);
    cache.finish(true);
    dispose(body.shape);
    const first = cache.read("exact")!;
    expect(first.version).toBe(version);
    expect(first.removedIds).toEqual(["absorbed"]);
    first.bodies[0][1].mesh!.indices[0] = 17;
    first.bodies[0][1].mesh!.bounds.max[0] = 99;
    dispose(first.bodies[0][1].shape);
    expect(cache.read("exact")!.bodies[0][1].mesh).toMatchObject({ indices: [0, 0, 0], bounds: { max: [1, 1, 1] } });
    expect(cache.hits).toBe(2);
  });

  it("disposes pending native outputs after failure and never reuses them", () => {
    const { kernel, body, dispose } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel, 1);
    cache.stage("failed", [["body:base", body]], []);
    cache.finish(false);
    expect(cache.read("failed")).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.retainedShapes).toBe(0);
    expect((body.shape.kernelHandle as { deleted: boolean }).deleted).toBe(false);
  });

  it("clears handles on document, adapter and epoch changes, while same epoch remains warm", () => {
    const { kernel, body, dispose } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel, 1); cache.stage("one", [["body", body]], []); cache.finish(true);
    cache.begin("doc", kernel, 1); const read = cache.read("one"); expect(read).toBeDefined();
    for (const [, copy] of read!.bodies) kernel.disposeShape!(copy.shape);
    cache.begin("doc", kernel, 2); expect(cache.read("one")).toBeUndefined();
    cache.stage("two", [["body", body]], []); cache.finish(true);
    cache.begin("other", kernel, 2); expect(cache.read("two")).toBeUndefined();
    cache.stage("three", [["body", body]], []); cache.finish(true);
    cache.begin("other", { ...kernel }, 2); expect(cache.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(4);
  });

  it("bounds combined committed and pending handles and evicts with disposal", () => {
    const { kernel, body, dispose } = fixture(), cache = new NativeFeatureCache({ entries: 2, shapes: 2, bytes: 4096 });
    cache.begin("doc", kernel);
    for (const key of ["a", "b"]) { cache.stage(key, [[key, body]], []); cache.finish(true); }
    cache.stage("c", [["c", body]], []);
    expect(cache.retainedShapes).toBe(2);
    expect(cache.retainedBytes).toBeLessThanOrEqual(4096);
    expect(cache.read("a")).toBeUndefined();
    cache.finish(true);
    cache.clear();
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(cache.retainedShapes).toBe(0);
  });

  it("refuses fallback, oversized signatures and entries without native validation", () => {
    const { kernel, body, clone } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel);
    expect(cache.stage("fallback", [["body", { ...body, mesh: { ...body.mesh!, geometrySource: "fallback" } }]], [])).toBeUndefined();
    cache.stage("unvalidated", [["body", { ...body, mesh: { ...body.mesh!, geometryAssertions: undefined } }]], []);
    expect(cache.stage("x".repeat(262145), [["body", body]], [])).toBeUndefined();
    cache.finish(true);
    expect(clone).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it("clones fallible mesh data before allocating owned native copies", () => {
    const { kernel, body, clone } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel);
    Object.defineProperty(body.mesh!.positions, Symbol.iterator, { value: () => { throw new Error("mesh copy failed"); } });
    expect(() => cache.stage("invalid mesh", [["a", body]], [])).toThrow("mesh copy failed");
    expect(clone).not.toHaveBeenCalled();
    expect(cache.retainedShapes).toBe(0);
  });

  it("rolls back partial clone failures and invalidates a broken retained entry", () => {
    const { kernel, body, clone, dispose } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel);
    clone.mockImplementationOnce(() => ({ ...body.shape, id: "admitted", kernelHandle: { deleted: false } })).mockImplementationOnce(() => { throw new Error("copy failed"); });
    expect(() => cache.stage("partial", [["a", body], ["b", body]], [])).toThrow("copy failed");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.retainedShapes).toBe(0);
    cache.stage("valid", [["a", body]], []); cache.finish(true);
    clone.mockImplementationOnce(() => { throw new Error("retrieval failed"); });
    expect(() => cache.read("valid")).toThrow("retrieval failed");
    expect(cache.size).toBe(0);
  });

  it("reports disposal failures during epoch eviction instead of hiding them", () => {
    const { kernel, body, dispose } = fixture(), cache = new NativeFeatureCache();
    cache.begin("doc", kernel, 1); cache.stage("one", [["body", body]], []); cache.finish(true);
    dispose.mockImplementationOnce(() => { throw new Error("dispose failed"); });
    cache.begin("doc", kernel, 2);
    expect(cache.disposalFailures).toBe(1);
    expect(cache.size).toBe(0);
  });
});
