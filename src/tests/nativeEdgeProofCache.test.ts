import { describe, expect, it, vi } from "vitest";
import { NativeEdgeProofCache } from "../cad/features/nativeEdgeProofCache";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import type { KernelAdapter, KernelShape } from "../cad/kernel/KernelAdapter";

describe("bounded native edge proof reuse", () => {
  it("reuses only exact inputs, clones values, and clears for a new document or adapter", () => {
    const probe = vi.fn(() => [{ role: "endCapPerimeter" as const, sourceEntityId: "edge" }]);
    const kernel = { edgeProofSignature: (shape: KernelShape) => String(shape.metadata?.input), availableExtrudeCapEdges: probe } as unknown as KernelAdapter;
    const cache = new NativeEdgeProofCache();
    const shape = { id: "new native handle each rebuild", kernelHandle: {}, metadata: { input: "original" } };
    cache.begin("doc", kernel);
    const first = cache.read(kernel, shape);
    first[0].sourceEntityId = "mutated result";
    cache.begin("doc", kernel);
    expect(cache.read(kernel, { ...shape, kernelHandle: {} })[0].sourceEntityId).toBe("edge");
    expect(cache.hits).toBe(1);
    cache.read(kernel, { ...shape, metadata: { input: "changed" } });
    expect(probe).toHaveBeenCalledTimes(2);
    cache.begin("other document", kernel);
    cache.read(kernel, shape);
    const replacement = { ...kernel };
    cache.begin("other document", replacement);
    cache.read(replacement, shape);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("does not retain unexpected failures or unsupported signatures; caches proven empty results", () => {
    const probe = vi.fn(() => []);
    const kernel = { availableExtrudeCapEdges: probe } as unknown as KernelAdapter;
    const shape = { id: "shape", kernelHandle: {} };
    const cache = new NativeEdgeProofCache();
    cache.begin("doc", kernel);
    cache.read(kernel, shape); cache.read(kernel, shape);
    expect(probe).toHaveBeenCalledTimes(2);
    kernel.edgeProofSignature = () => "exact";
    probe.mockImplementationOnce(() => { throw new Error("native failure"); });
    expect(() => cache.read(kernel, shape)).toThrow("native failure");
    expect(cache.read(kernel, shape)).toEqual([]);
    expect(cache.read(kernel, shape)).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("evicts old signatures instead of retaining unbounded native history", () => {
    const probe = vi.fn(() => []);
    const kernel = { edgeProofSignature: (shape: KernelShape) => shape.id, availableExtrudeCapEdges: probe } as unknown as KernelAdapter;
    const cache = new NativeEdgeProofCache();
    cache.begin("doc", kernel);
    for (let i = 0; i < 65; i++) cache.read(kernel, { id: String(i), kernelHandle: {} });
    cache.read(kernel, { id: "0", kernelHandle: {} });
    expect(probe).toHaveBeenCalledTimes(66);
  });

  it("excludes native handles and unsupported operation inputs from exact signatures", () => {
    const kernel = new OpenCascadeKernel();
    const handle = { kind: "extrusion", profile: { entityIds: ["original"] }, distance: 8, transform: { origin: [0, 0, 0] }, occtShape: { secret: "native" } };
    const signature = kernel.edgeProofSignature({ id: "shape", kernelHandle: handle });
    expect(signature).not.toContain("native");
    expect(kernel.edgeProofSignature({ id: "shape", kernelHandle: { ...handle, distance: 9 } })).not.toBe(signature);
    expect(kernel.edgeProofSignature({ id: "shape", kernelHandle: { ...handle, profile: { entityIds: ["replacement"] } } })).not.toBe(signature);
    expect(kernel.edgeProofSignature({ id: "shape", kernelHandle: { kind: "toFace", base: handle } })).toBeUndefined();
    expect(kernel.edgeProofSignature({ id: "shape", kernelHandle: { kind: "revolve", angle: 360 } })).toBeUndefined();
    expect(kernel.edgeProofSignature({ id: "shape", kernelHandle: { ...handle, distance: Infinity } })).toBeUndefined();
  });
});
