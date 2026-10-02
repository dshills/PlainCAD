import { describe, expect, it } from "vitest";
import { createBoxMesh } from "../cad/kernel/meshConversion";
import { validateMesh } from "../fabrication/meshValidation";
import { buildStlExport } from "../fabrication/exportPlan";
import { crc32 } from "../fabrication/zip";
import { safeFilename, uniqueFilenames } from "../persistence/filenames";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
const box = () => createBoxMesh("body:box", 4, 4, 4);
function move(mesh: RenderMesh, x: number, y: number, z: number): RenderMesh {
  return {
    ...mesh,
    positions: Array.from(mesh.positions, (v, i) => v + [x, y, z][i % 3]),
  };
}
function combine(a: RenderMesh, b: RenderMesh): RenderMesh {
  return {
    ...a,
    positions: [...Array.from(a.positions), ...Array.from(b.positions)],
    indices: [
      ...a.indices,
      ...b.indices.map((i) => i + a.positions.length / 3),
    ],
  };
}
function unzipStored(bytes: ArrayBuffer) {
  const view = new DataView(bytes),
    files: Array<{ name: string; bytes: ArrayBuffer }> = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const n = view.getUint16(offset + 26, true),
      extra = view.getUint16(offset + 28, true),
      size = view.getUint32(offset + 18, true),
      start = offset + 30 + n + extra,
      name = new TextDecoder().decode(new Uint8Array(bytes, offset + 30, n)),
      data = bytes.slice(start, start + size);
    expect(crc32(new Uint8Array(data))).toBe(view.getUint32(offset + 14, true));
    files.push({ name, bytes: data });
    offset = start + size;
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  return files;
}
describe("fabrication validation", () => {
  it("validates closed geometry and rejects open boundaries, winding, nonfinite coordinates and bad indices", () => {
    expect(validateMesh(box()).volume).toBeCloseTo(64);
    expect(validateMesh(box()).shells).toBe(1);
    expect(() =>
      validateMesh({ ...box(), indices: box().indices.slice(3) }),
    ).toThrow(/open boundary/);
    const indices = [...box().indices];
    [indices[0], indices[1]] = [indices[1], indices[0]];
    expect(() => validateMesh({ ...box(), indices })).toThrow(/winding/);
    expect(() =>
      validateMesh({
        ...box(),
        positions: [Infinity, ...Array.from(box().positions).slice(1)],
      }),
    ).toThrow(/nonfinite/);
    expect(() =>
      validateMesh({ ...box(), indices: [999, ...box().indices.slice(1)] }),
    ).toThrow(/out of range/);
    expect(() =>
      validateMesh({
        ...box(),
        indices: [...box().indices, ...box().indices.slice(0, 3)],
      }),
    ).toThrow(/duplicate/);
  });
  it("detects self-intersections, point-touch non-manifold vertices and disjoint inward shells", () => {
    expect(() =>
      validateMesh(combine(box(), move(box(), 1.2, 0.3, 0.5))),
    ).toThrow(/self-intersection/);
    expect(() => validateMesh(combine(box(), move(box(), 4, 4, 4)))).toThrow(
      /non-manifold vertex/,
    );
    const small = move(createBoxMesh("small", 2, 2, 2), 10, 0, 0);
    expect(() =>
      validateMesh(
        combine(box(), { ...small, indices: [...small.indices].reverse() }),
      ),
    ).toThrow(/inward shell/);
  });
  it("accepts correctly oriented enclosed cavities and welds native face seams in float32 output", () => {
    const inside = move(createBoxMesh("cavity", 2, 2, 2), 0, 0, 1);
    const cavity = validateMesh(
      combine(box(), { ...inside, indices: [...inside.indices].reverse() }),
    );
    expect(cavity.volume).toBeCloseTo(56);
    expect(cavity.shells).toBe(2);
    const source = box(),
      positions = source.indices.flatMap((i, index) =>
        Array.from(source.positions)
          .slice(i * 3, i * 3 + 3)
          .map((v) => v + (index % 2) * 1e-9),
      );
    const check = validateMesh({
      ...source,
      positions,
      indices: source.indices.map((_, i) => i),
    });
    expect(check.volume).toBeCloseTo(64);
    expect(
      new Set(Array.from(check.mesh.positions).filter((_, i) => i % 3 === 0))
        .size,
    ).toBe(2);
  });
  it("bounds per-body and total allocations before validating triangles", () => {
    expect(() =>
      validateMesh({
        ...box(),
        indices: Array(
          (MODEL_RESOURCE_LIMITS.maxTrianglesPerBody + 1) * 3,
        ).fill(0),
      }),
    ).toThrow(/resource limit/);
    const large = {
      ...box(),
      indices: Array(MODEL_RESOURCE_LIMITS.maxTrianglesPerBody * 3).fill(0),
    };
    expect(() =>
      buildStlExport([large, large, large], [], "large", "shells"),
    ).toThrow(/total triangle/);
  });
  it("preserves coordinates in separate ZIP files and warns about overlapping shells", () => {
    const a = box(),
      b = { ...move(box(), 10, 0, 0), bodyId: "body:other" };
    const output = buildStlExport(
      [a, b],
      [
        { id: a.bodyId, name: "Part" },
        { id: b.bodyId, name: "part" },
      ],
      "../../CON",
      "separate",
    );
    const files = unzipStored(output.file.bytes);
    expect(files.map((f) => f.name)).toEqual(["Part.stl", "part-2.stl"]);
    const view = new DataView(files[1].bytes);
    expect(view.getUint32(80, true)).toBe(12);
    expect(view.getFloat32(96, true)).toBe(8);
    const overlap = { ...move(box(), 1, 0, 0), bodyId: "body:other" };
    expect(
      buildStlExport([a, overlap], [], "assembly", "shells").warnings[0],
    ).toMatch(/intersect/);
    expect(buildStlExport([a, b], [], "assembly", "shells").warnings).toEqual(
      [],
    );
    expect(() => buildStlExport([a, b], [], "assembly", "merged")).toThrow(
      /native union/,
    );
  });
  it("detects containment and reports explicitly skipped expensive checks", () => {
    const inner = move(createBoxMesh("inner", 2, 2, 2), 0, 0, 1);
    expect(
      buildStlExport([box(), inner], [], "nested", "shells").warnings[0],
    ).toMatch(/contain/);
    expect(
      buildStlExport([box()], [], "single", "separate", false).warnings[0],
    ).toMatch(/skipped/);
  });
  it("hardens names and keeps suffixes unique after truncation", () => {
    for (const name of [
      "CON",
      "CON.txt",
      "aux",
      "nul",
      "LPT9",
      "COM1",
      "../../",
      "c:\\bad\0name.",
      "  ",
      "é",
    ]) {
      const file = safeFilename(name, ".stl");
      expect(file).not.toMatch(/[\\/\x00-\x20:]/);
      expect(file.length).toBeLessThanOrEqual(180);
      expect(file).not.toMatch(/^(con|aux|nul|lpt9|com1)(\.|$)/i);
    }
    const names = uniqueFilenames([
      "x".repeat(300),
      "X".repeat(300),
      "x".repeat(300),
    ]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    expect(names[2]).toMatch(/-3.stl$/);
    expect(names.every((n) => n.length <= 180)).toBe(true);
  });
});
