import { validateMesh } from "../fabrication/meshValidation";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import {
  addCircleAt,
  addCenterRectangle,
  addLine,
  addPoint,
  addCornerRectangle,
  createXySketch,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { sketchPlaneTransform } from "../cad/sketch/planes";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { TESSELLATION_LOD } from "../cad/kernel/tessellationCache";
import { getDisposableScopeMetrics } from "../cad/kernel/disposableScope";
import { resolveRevolveAxis } from "../cad/features/revolveAxis";

// Exercise the exact installed WASM bindings, with no geometry mocks.
vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const root = `${process.cwd()}/node_modules/opencascade.js/dist`;
  const filename = `${root}/opencascade.wasm.js`;
  const factory = new Function(
    "require",
    "__dirname",
    "__filename",
    readFileSync(filename, "utf8").replace(
      "export default opencascade;",
      "return opencascade;",
    ),
  )(createRequire(filename), root, filename);
  return {
    default: () =>
      factory({ wasmBinary: readFileSync(`${root}/opencascade.wasm.wasm`) }),
  };
});

const kernel = new OpenCascadeKernel();
const options = {
  ...TESSELLATION_LOD.default,
  linearDeflection: 0.05,
  angularDeflection: 0.1,
};
function rectangle(width = 20, height = 10) {
  const sketch = addCornerRectangle(
    createXySketch(),
    `${width}mm`,
    `${height}mm`,
  );
  const solved = solveSketch(sketch, {});
  return { sketch, solved, profile: detectProfiles(solved).profiles[0] };
}
function volume(shape: ReturnType<typeof kernel.createBox>, solidCount = 1) {
  const mesh = kernel.tessellate(shape, options);
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions?.valid).toBe(true);
  expect(mesh.geometryAssertions?.solidCount).toBe(solidCount);
  let signed = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3,
      b = mesh.indices[i + 1] * 3,
      c = mesh.indices[i + 2] * 3,
      p = mesh.positions;
    signed +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  expect(signed).toBeGreaterThan(0);
  expect(signed / mesh.geometryAssertions!.volume).toBeCloseTo(1, 2);
  return mesh.geometryAssertions!.volume;
}
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
beforeAll(async () => OpenCascadeKernel.initialize());
describe("native modeling geometry", () => {
  it("cuts and joins real solids and rejects disjoint, contained, and empty results", () => {
    const shapes = [kernel.createBox(20, 10, 10), kernel.createBox(10, 10, 5)];
    try {
      const cut = kernel.cut(shapes[0], shapes[1]);
      shapes.push(cut);
      expect(volume(cut)).toBeCloseTo(1500, 6);
      const taller = kernel.createBox(10, 10, 15);
      shapes.push(taller);
      const join = kernel.fuse(shapes[0], taller);
      shapes.push(join);
      expect(volume(join)).toBeCloseTo(2500, 6);
      expect(() => kernel.fuse(shapes[0], shapes[1])).toThrow(
        /added no volume/,
      );
      expect(() => kernel.cut(shapes[1], shapes[0])).toThrow(/no solid volume/);
      const plane = {
        ...sketchPlaneTransform("XY"),
        origin: { x: 100, y: 0, z: 0 },
      };
      const disjoint = kernel.extrudeProfile(rectangle().profile, 10, plane);
      shapes.push(disjoint);
      expect(() => kernel.cut(shapes[0], disjoint)).toThrow(
        /removed no volume/,
      );
      expect(() => kernel.fuse(shapes[0], disjoint)).toThrow(/connected/);
    } finally {
      shapes.forEach((s) => kernel.disposeShape(s));
    }
  });
  it("makes real fillets and symmetric chamfers with exact volume changes", () => {
    const profile = rectangle().profile;
    const base = kernel.extrudeProfile(profile, 10);
    const edge = createExtrudeEdgeRef(
      "owner",
      "endCapPerimeter",
      profile.outerLoop.segments![0].id,
    );
    const shapes = [base];
    try {
      const chamfer = kernel.chamfer(base, [edge], 1);
      shapes.push(chamfer);
      const length = Math.hypot(
        profile.outerLoop.segments![0].end.x -
          profile.outerLoop.segments![0].start.x,
        profile.outerLoop.segments![0].end.y -
          profile.outerLoop.segments![0].start.y,
      );
      expect(volume(chamfer)).toBeCloseTo(2000 - length / 2, 5);
      const fillet = kernel.fillet(base, [edge], 1);
      shapes.push(fillet);
      expect(volume(fillet)).toBeCloseTo(2000 - length * (1 - Math.PI / 4), 5);
      const metricsBefore = getDisposableScopeMetrics();
      expect(() => kernel.fillet(base, [edge], 100)).toThrow(/fillet failed/);
      const metricsAfter = getDisposableScopeMetrics();
      expect(metricsAfter.registered - metricsBefore.registered).toBe(
        metricsAfter.disposed - metricsBefore.disposed,
      );
      expect(metricsAfter.failures).toBe(metricsBefore.failures);
      expect(() =>
        kernel.chamfer(
          base,
          [{ ...edge, sourceEntityId: "missing-entity-xyz" }],
          1,
        ),
      ).toThrow(
        "Edge reference was lost or is ambiguous. Reselect the current feature-owned perimeter.",
      );
    } finally {
      shapes.forEach((s) => kernel.disposeShape(s));
    }
  });
  it("revolves around all coplanar world axes, partial angles, and an offset sketch line", () => {
    const { profile, solved } = rectangle(10, 5);
    for (const [axis, plane] of [
      ["Y", "XY"],
      ["X", "XY"],
      ["Z", "XZ"],
    ] as const) {
      const transform = sketchPlaneTransform(plane);
      const ref = { type: "origin" as const, axis };
      const resolved = resolveRevolveAxis(
        ref,
        solved,
        transform,
        profile,
        Math.PI,
      );
      const shape = kernel.revolveProfile(
        profile,
        ref,
        Math.PI,
        transform,
        resolved,
      );
      try {
        const bounds = kernel.tessellate(shape, options).bounds;
        const expected =
          axis === "X"
            ? { min: [0, -5, 0], max: [10, 5, 5] }
            : axis === "Z"
              ? { min: [-10, 0, 0], max: [10, 10, 5] }
              : { min: [-10, 0, -10], max: [10, 5, 0] };
        for (const end of ["min", "max"] as const)
          bounds[end].forEach((value, i) =>
            expect(Math.abs(value - expected[end][i])).toBeLessThan(0.05),
          );
        expect(volume(shape)).toBeCloseTo(
          axis === "X" ? (Math.PI * 25 * 10) / 2 : (Math.PI * 100 * 5) / 2,
          4,
        );
      } finally {
        kernel.disposeShape(shape);
      }
    }
  });
  it("terminates on a finite native face and rejects extension beyond its boundary", () => {
    const profile = rectangle(10, 5).profile,
      big = rectangle(30, 20).profile;
    const owner = kernel.extrudeProfile(big, 10);
    const plane = {
      ...sketchPlaneTransform("XY"),
      origin: { x: 0, y: 0, z: 10 },
    };
    try {
      const result = kernel.extrudeToFace(
        profile,
        sketchPlaneTransform("XY"),
        owner,
        plane,
      );
      try {
        expect(volume(result)).toBeCloseTo(500, 5);
      } finally {
        kernel.disposeShape(result);
      }
      expect(() =>
        kernel.extrudeToFace(
          rectangle(40, 20).profile,
          sketchPlaneTransform("XY"),
          owner,
          plane,
        ),
      ).toThrow(/outside the finite/);
    } finally {
      kernel.disposeShape(owner);
    }
  });
  it("uses stable sketch-line axes on offset planes and rejects crossing or noncoplanar axes", () => {
    const { profile, solved } = rectangle(10, 5);
    const transform = {
      ...sketchPlaneTransform("XY"),
      origin: { x: 0, y: 0, z: 20 },
    };
    const axisSketch = {
      ...solved,
      lines: [
        ...solved.lines,
        {
          id: "axis",
          construction: true,
          start: { id: "axisA", x: -5, y: 0 },
          end: { id: "axisB", x: -5, y: 10 },
        },
      ],
    };
    const ref = {
      type: "sketchLine" as const,
      sketchId: solved.id,
      lineId: "axis",
    };
    for (const angle of [Math.PI / 4, Math.PI * 1.5, Math.PI * 2]) {
      const axis = resolveRevolveAxis(
        ref,
        axisSketch,
        transform,
        profile,
        angle,
      );
      const shape = kernel.revolveProfile(profile, ref, angle, transform, axis);
      try {
        expect(volume(shape)).toBeCloseTo(
          ((15 ** 2 - 5 ** 2) * 5 * angle) / 2,
          4,
        );
      } finally {
        kernel.disposeShape(shape);
      }
    }
    expect(() =>
      resolveRevolveAxis(
        { type: "origin", axis: "Y" },
        solved,
        transform,
        profile,
        Math.PI,
      ),
    ).toThrow(/sketch plane/);
    expect(() =>
      resolveRevolveAxis(ref, axisSketch, transform, profile, Math.PI * 3),
    ).toThrow(/360/);
    const crossing = {
      ...axisSketch,
      lines: axisSketch.lines.map((l) =>
        l.id === "axis"
          ? { ...l, start: { ...l.start, x: 5 }, end: { ...l.end, x: 5 } }
          : l,
      ),
    };
    expect(() =>
      resolveRevolveAxis(ref, crossing, transform, profile, Math.PI),
    ).toThrow(/cross/);
    expect(() =>
      resolveRevolveAxis(
        { ...ref, lineId: "missing" },
        solved,
        transform,
        profile,
        Math.PI,
      ),
    ).toThrow(/lost/);
  });
  it("terminates on sloped planar faces and rejects finite face holes", () => {
    const profile = rectangle(10, 5).profile,
      big = rectangle(30, 20).profile;
    const c = Math.SQRT1_2;
    const slope = {
      origin: { x: 0, y: 0, z: 10 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: c, z: c },
      normal: { x: 0, y: -c, z: c },
    };
    const owner = kernel.extrudeProfile(big, 5, slope);
    try {
      const result = kernel.extrudeToFace(
        profile,
        sketchPlaneTransform("XY"),
        owner,
        slope,
      );
      try {
        expect(volume(result)).toBeCloseTo(625, 4);
      } finally {
        kernel.disposeShape(result);
      }
    } finally {
      kernel.disposeShape(owner);
    }
    const hole = { id: "hole", x: 5, y: 2.5, radius: 1 };
    const withHole = {
      ...big,
      holes: [hole],
      innerLoops: [{ type: "circle" as const, entityIds: [hole.id] }],
    };
    const perforated = kernel.extrudeProfile(withHole, 10);
    try {
      expect(() =>
        kernel.extrudeToFace(profile, sketchPlaneTransform("XY"), perforated, {
          ...sketchPlaneTransform("XY"),
          origin: { x: 0, y: 0, z: 10 },
        }),
      ).toThrow(
        "Extrude profile extends outside the finite target face or crosses a face hole. Reselect a covering planar face.",
      );
    } finally {
      kernel.disposeShape(perforated);
    }
  });
  it("retains valid split solids in a stable cut result", () => {
    const base = kernel.createBox(20, 10, 10),
      tool = kernel.createBox(10, 10, 10);
    try {
      const split = kernel.cut(base, tool);
      try {
        expect(volume(split, 2)).toBeCloseTo(1000, 5);
      } finally {
        kernel.disposeShape(split);
      }
    } finally {
      kernel.disposeShape(base);
      kernel.disposeShape(tool);
    }
  });
  it("revolves analytic circular profiles into real torus geometry", () => {
    const sketch = addCircleAt(createXySketch(), "10mm", "0mm", "2mm"),
      solved = solveSketch(sketch, {}),
      profile = detectProfiles(solved).profiles[0];
    const ref = { type: "origin" as const, axis: "Y" as const },
      transform = sketchPlaneTransform("XY");
    const axis = resolveRevolveAxis(
      ref,
      solved,
      transform,
      profile,
      Math.PI * 2,
    );
    const shape = kernel.revolveProfile(
      profile,
      ref,
      Math.PI * 2,
      transform,
      axis,
    );
    try {
      expect(volume(shape)).toBeCloseTo(2 * Math.PI ** 2 * 10 * 4, 4);
    } finally {
      kernel.disposeShape(shape);
    }
  });
  it("treats circular cap perimeters with real cylindrical fillet and chamfer geometry", () => {
    const sketch = addCircleAt(createXySketch(), "0mm", "0mm", "10mm"),
      profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const base = kernel.extrudeProfile(profile, 10),
      refs = [createExtrudeEdgeRef("owner", "endCapPerimeter")];
    const shapes = [base];
    try {
      const chamfer = kernel.chamfer(base, refs, 1);
      shapes.push(chamfer);
      expect(volume(chamfer)).toBeCloseTo(
        Math.PI * 1000 - Math.PI * (10 - 1 / 3),
        4,
      );
      const fillet = kernel.fillet(base, refs, 1);
      shapes.push(fillet);
      expect(volume(fillet)).toBeLessThan(Math.PI * 1000 - 10);
      expect(volume(fillet)).toBeGreaterThan(Math.PI * 1000 - 20);
    } finally {
      shapes.forEach((s) => kernel.disposeShape(s));
    }
  });
  it("rejects a mixed sharp/smooth source-corner group rather than partially treating it", () => {
    const profile = rectangle().profile,
      segment = profile.outerLoop.segments![0];
    const middle = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };
    const split = {
      ...profile,
      outerLoop: {
        ...profile.outerLoop,
        segments: [
          { ...segment, id: "partial-a", end: middle },
          { ...segment, id: "partial-b", start: middle },
          ...profile.outerLoop.segments!.slice(1),
        ],
      },
    };
    const base = kernel.extrudeProfile(split, 10);
    try {
      expect(() =>
        kernel.fillet(
          base,
          [createExtrudeEdgeRef("owner", "profileEdge", "partial-a")],
          1,
        ),
      ).toThrow(
        "Some selected edges are not sharp treatment contours. Reselect sharp edges.",
      );
    } finally {
      kernel.disposeShape(base);
    }
  });
  it("uses analytic circle extents for sloped termination instead of outside bounding-box corners", () => {
    const circle = addCircleAt(createXySketch(), "0mm", "0mm", "1mm"),
      profile = detectProfiles(solveSketch(circle, {})).profiles[0];
    const big = addCenterRectangle(createXySketch(), "20mm", "20mm"),
      targetProfile = detectProfiles(solveSketch(big, {})).profiles[0];
    const c = 1 / Math.sqrt(3),
      q = 1 / Math.sqrt(6);
    const plane = {
      origin: { x: 0, y: 0, z: 1.6 },
      u: { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 },
      v: { x: q, y: q, z: -2 * q },
      normal: { x: c, y: c, z: c },
    };
    const owner = kernel.extrudeProfile(targetProfile, 1, plane);
    try {
      const result = kernel.extrudeToFace(
        profile,
        sketchPlaneTransform("XY"),
        owner,
        plane,
      );
      try {
        expect(volume(result)).toBeCloseTo(Math.PI * 1.6, 5);
      } finally {
        kernel.disposeShape(result);
      }
    } finally {
      kernel.disposeShape(owner);
    }
  });
  it("models convex and concave corner pairs even when their volume changes cancel", () => {
    let sketch = createXySketch();
    const pointIds: string[] = [];
    for (const [x, y] of [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ]) {
      const result = addPoint(sketch, `${x}mm`, `${y}mm`);
      sketch = result.sketch;
      pointIds.push(result.pointId);
    }
    const lineIds: string[] = [];
    for (let i = 0; i < pointIds.length; i++) {
      const result = addLine(
        sketch,
        pointIds[i],
        pointIds[(i + 1) % pointIds.length],
      );
      sketch = result.sketch;
      lineIds.push(result.lineId);
    }
    const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const base = kernel.extrudeProfile(profile, 10),
      refs = [createExtrudeEdgeRef("owner", "profileEdge", lineIds[2])];
    const shapes = [base];
    try {
      const fillet = kernel.fillet(base, refs, 1);
      shapes.push(fillet);
      expect(volume(fillet)).toBeCloseTo(3000, 4);
      expect(
        kernel.tessellate(fillet, options).geometryAssertions!.surfaceArea,
      ).toBeCloseTo(1400 - 20 * (2 - Math.PI / 2), 4);
      const chamfer = kernel.chamfer(base, refs, 1);
      shapes.push(chamfer);
      expect(volume(chamfer)).toBeCloseTo(3000, 4);
      expect(
        kernel.tessellate(chamfer, options).geometryAssertions!.surfaceArea,
      ).toBeCloseTo(1400 - 20 * (2 - Math.SQRT2), 4);
    } finally {
      shapes.forEach((shape) => kernel.disposeShape(shape));
    }
  });
  it("rejects malformed circle holes and nonpositive extrusion depth explicitly", () => {
    const outline = rectangle().sketch;
    const sketch = addCircleAt(outline, "10mm", "5mm", "2mm");
    const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    expect(profile.innerLoops).toHaveLength(1);
    expect(() => kernel.extrudeProfile({ ...profile, holes: [] }, 10)).toThrow(
      /Inner circle profile is missing/,
    );
    for (const depth of [0, -10, NaN])
      expect(() => kernel.extrudeProfile(profile, depth)).toThrow(
        /positive finite/,
      );
  });
  it("validates native curved treatment meshes and export unions including contained solids", () => {
    const circle = addCircleAt(createXySketch(), "0mm", "0mm", "5mm");
    const profile = detectProfiles(solveSketch(circle, {})).profiles[0];
    const cylinder = kernel.extrudeProfile(profile, 10);
    const shapes = [cylinder];
    try {
      expect(validateMesh(kernel.tessellate(cylinder, options)).volume).toBeCloseTo(Math.PI * 250, 0);
      const round = kernel.fillet(cylinder, [createExtrudeEdgeRef("base", "endCapPerimeter")], 1);
      shapes.push(round);
      expect(validateMesh(kernel.tessellate(round, options)).volume).toBeGreaterThan(750);
      const base = kernel.extrudeProfile(rectangle().profile, 10);
      const inner = kernel.extrudeProfile(rectangle(10, 5).profile, 10);
      shapes.push(base, inner);
      const contained = kernel.unionForExport(base, inner);
      shapes.push(contained);
      expect(validateMesh(kernel.tessellate(contained, options)).volume).toBeCloseTo(2000, 4);
      const shift = { ...sketchPlaneTransform("XY"), origin: { x: 15, y: 0, z: 0 } };
      const tool = kernel.extrudeProfile(rectangle(10, 10).profile, 10, shift);
      const union = kernel.unionForExport(base, tool);
      shapes.push(tool, union);
      expect(validateMesh(kernel.tessellate(union, options)).volume).toBeCloseTo(2500, 4);
    } finally { shapes.forEach((shape) => kernel.disposeShape(shape)); }
  });

  it("keeps cloned native boolean geometry alive after every source shape is disposed", () => {
    const owned = new Set<ReturnType<OpenCascadeKernel["cloneShape"]>>();
    const own = (shape: ReturnType<OpenCascadeKernel["cloneShape"]>) => { owned.add(shape); return shape; };
    const dispose = (shape: ReturnType<OpenCascadeKernel["cloneShape"]>) => { if (owned.delete(shape)) kernel.disposeShape(shape); };
    try {
      const base = own(kernel.extrudeProfile(rectangle(20, 10).profile, 5));
      const tool = own(kernel.extrudeProfile(rectangle(5, 5).profile, 5, { ...sketchPlaneTransform("XY"), origin: { x: 5, y: 2, z: 0 } }));
      const cut = own(kernel.cut(base, tool));
      cut.metadata = { labels: ["authored"] };
      const sourceMesh = kernel.tessellate(cut, options), sourceProof = kernel.edgeProofSignature(cut);
      const copy = own(kernel.cloneShape(cut));
      (cut.metadata.labels as string[])[0] = "changed source metadata";
      dispose(cut); dispose(tool); dispose(base);
      expect(volume(copy)).toBeCloseTo(875, 6);
      expect(kernel.tessellate(copy, options).bounds).toEqual(sourceMesh.bounds);
      expect(kernel.edgeProofSignature(copy)).toBe(sourceProof);
      expect(copy.metadata).toEqual({ labels: ["authored"] });
      expect(kernel.availableExtrudeCapEdges(copy).some(edge => edge.role === "endCapPerimeter")).toBe(true);
      const second = own(kernel.cloneShape(copy));
      dispose(second);
      expect(volume(copy)).toBeCloseTo(875, 6);
    } finally {
      for (const shape of owned) dispose(shape);
    }
  });


});
