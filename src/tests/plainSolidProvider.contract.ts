// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { KernelShape } from "../cad/kernel/KernelAdapter";
import { initializePlainSolidRuntime } from "./fixtures/plainSolidRuntime";

// A dedicated Vitest config includes *.contract.ts; the default suite does not.
// Existing fallback and OCCT-private tests retain their original initialization.
describe("PlainSolid real WASM provider contracts", () => {
  let Provider: Awaited<ReturnType<typeof initializePlainSolidRuntime>>;
  let kernel: InstanceType<Awaited<ReturnType<typeof initializePlainSolidRuntime>>>;
  const meshOptions = { linearDeflection: 0.05, angularDeflection: 0.1 };
  beforeAll(async () => {
    Provider = await initializePlainSolidRuntime();
    kernel = new Provider();
  }, 60000);

  function proof(shape: KernelShape) {
    const mesh = kernel.tessellate(shape, meshOptions);
    expect(mesh.geometrySource).toBe("plainsolid");
    expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(mesh.indices.length).toBeGreaterThan(0);
    return mesh.geometryAssertions!;
  }

  it("executes real native geometry with independent clone ownership and world placement", () => {
    expect(Provider.isInitialized()).toBe(true);
    expect(typeof (globalThis as { plainSolidCall?: unknown }).plainSolidCall).toBe("function");
    const stock = kernel.createBox(20, 10, 8);
    const clone = kernel.cloneShape(stock);
    const placed = kernel.placeShape(stock, { translation: [30, 0, 4], rotation: [0, 0, 0] });
    try {
      expect(proof(stock).volume).toBeCloseTo(1600, 8);
      expect(proof(placed).volume).toBeCloseTo(1600, 8);
      expect(kernel.nativeBounds(placed)).toEqual({ min: [20, -5, 4], max: [40, 5, 12] });
      kernel.disposeShape(stock);
      expect(proof(clone).volume).toBeCloseTo(1600, 8);
      expect(kernel.nativeBounds(clone)).toEqual({ min: [-10, -5, 0], max: [10, 5, 8] });
    } finally {
      kernel.disposeShape(stock);
      kernel.disposeShape(clone);
      kernel.disposeShape(placed);
    }
  });

  it("rejects missed centers and late targets atomically while keeping the inputs usable", () => {
    const stock = kernel.createBox(20, 10, 8);
    const tool = kernel.createBox(2, 2, 8);
    const remote = kernel.placeShape(stock, { translation: [40, 0, 0], rotation: [0, 0, 0] });
    const missed = kernel.placeShape(tool, { translation: [80, 0, 0], rotation: [0, 0, 0] });
    let outputs: KernelShape[] = [];
    try {
      expect(() => kernel.cutScope([stock], [tool, missed])).toThrow(/Hole center 2/);
      expect(() => kernel.cutScope([stock, remote], [tool])).toThrow(/Hole target 2/);
      expect(proof(stock).volume).toBeCloseTo(1600, 8);
      expect(proof(remote).volume).toBeCloseTo(1600, 8);
      expect(proof(tool).volume).toBeCloseTo(32, 8);
      outputs = kernel.cutScope([stock], [tool]);
      expect(outputs).toHaveLength(1);
      expect(proof(outputs[0]).volume).toBeCloseTo(1568, 8);
      expect(proof(stock).volume).toBeCloseTo(1600, 8);
    } finally {
      [...outputs, stock, tool, remote, missed].forEach(shape => kernel.disposeShape(shape));
    }
  });

  it("rejects no-op cuts and disconnected joins without consuming either input", () => {
    const stock = kernel.createBox(20, 10, 8);
    const tool = kernel.createBox(2, 2, 8);
    const remote = kernel.placeShape(tool, { translation: [40, 0, 0], rotation: [0, 0, 0] });
    try {
      expect(() => kernel.cut(stock, remote)).toThrow();
      expect(() => kernel.fuse(stock, remote)).toThrow();
      expect(proof(stock).volume).toBeCloseTo(1600, 8);
      expect(proof(remote).volume).toBeCloseTo(32, 8);
    } finally {
      [stock, tool, remote].forEach(shape => kernel.disposeShape(shape));
    }
  });

  it("round-trips exact placed STEP geometry and recovers after malformed input", () => {
    const stock = kernel.createBox(20, 10, 8);
    const placed = kernel.placeShape(stock, { translation: [30, 0, 4], rotation: [0, 0, 0] });
    let restored: KernelShape | undefined;
    try {
      expect(() => kernel.importStep("not a STEP file")).toThrow();
      const exported = kernel.exportStep([placed]);
      expect(exported.units).toBe("mm");
      expect(exported.before).toHaveLength(1);
      expect(exported.after).toHaveLength(1);
      for (const value of [...exported.before, ...exported.after]) {
        expect(value).toMatchObject({ valid: true, solidCount: 1 });
        expect(value.volume).toBeCloseTo(1600, 8);
        expect(value.bounds).toEqual({ min: [20, -5, 4], max: [40, 5, 12] });
      }
      const text = new TextDecoder().decode(exported.bytes);
      expect(text).toContain("ISO-10303-21;");
      restored = kernel.importStep(text);
      expect(proof(restored).volume).toBeCloseTo(1600, 8);
      expect(kernel.nativeBounds(restored)).toEqual(kernel.nativeBounds(placed));
    } finally {
      if (restored) kernel.disposeShape(restored);
      kernel.disposeShape(stock);
      kernel.disposeShape(placed);
    }
  });
});
