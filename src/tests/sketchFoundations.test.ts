import { describe, expect, it } from "vitest";
import { validateDocument } from "../cad/document/validate";
import { Sketch } from "../cad/document/schema";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  addPoint,
  addLine,
  addArc,
  addCircleAt,
  addConstraint,
  createXySketch,
  expressionRef,
  setConstruction,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { normalizeQuantity } from "../cad/parameters/units";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import {
  resolveDocumentPlanes,
  stableFaceId,
  transformPoint,
  sketchPointToWorld,
  worldPointToSketch,
} from "../cad/sketch/planes";

function lineSketch() {
  let sketch = createXySketch();
  const a = addPoint(sketch, "0mm", "0mm");
  sketch = a.sketch;
  const b = addPoint(sketch, "8mm", "3mm");
  const line = addLine(b.sketch, a.pointId, b.pointId);
  return { sketch: line.sketch, a: a.pointId, b: b.pointId, line: line.lineId };
}
function dSketch(): Sketch {
  let sketch = createXySketch();
  const center = addPoint(sketch, "0mm", "0mm");
  sketch = center.sketch;
  const start = addPoint(sketch, "10mm", "0mm");
  sketch = start.sketch;
  const end = addPoint(sketch, "-10mm", "0mm");
  sketch = end.sketch;
  const arc = addArc(sketch, center.pointId, start.pointId, end.pointId);
  return addLine(arc.sketch, end.pointId, start.pointId).sketch;
}
function extrude(
  document: ReturnType<typeof createEmptyDocument>,
  sketch: Sketch,
  name = "Base",
) {
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({
    name,
    sketchId: sketch.id,
    profileId: profile.id,
    operation: "newBody",
    distance: expressionRef("5mm"),
    direction: "positive",
  });
  return {
    document: upsertFeature(upsertSketch(document, sketch), feature),
    feature,
  };
}

describe("driving sketch foundations", () => {
  it("solves horizontal + fixed start + parameter-driven length and reports local DOF", () => {
    let { sketch, a, b, line } = lineSketch();
    sketch = addConstraint(sketch, "fixed", { pointIds: [a] });
    sketch = addConstraint(sketch, "horizontal", { entityIds: [line] });
    sketch = {
      ...sketch,
      dimensions: [
        {
          id: "width",
          type: "length",
          entityIds: [line],
          expression: expressionRef("width"),
        },
      ],
    };
    const first = solveSketch(sketch, { width: normalizeQuantity(20, "mm") });
    expect(first.errors).toEqual([]);
    expect(first.status).toBe("fullyConstrained");
    expect(first.degreesOfFreedom).toBe(0);
    expect(first.points[b].x).toBeCloseTo(20, 6);
    expect(first.points[b].y).toBeCloseTo(0, 6);
    const second = solveSketch(
      sketch,
      { width: normalizeQuantity(30, "mm") },
      { seed: first },
    );
    expect(second.errors).toEqual([]);
    expect(second.points[b].x).toBeCloseTo(30, 6);
    expect(second.seedUsed).toBe(true);
    expect(
      solveSketch(
        sketch,
        { width: normalizeQuantity(30, "mm") },
        { seed: first, reset: true },
      ).seedUsed,
    ).toBe(false);
    expect(sketch.entities[b]).toMatchObject({ x: expressionRef("8mm") });
  });
  it.each(["horizontalDistance", "verticalDistance", "distance"] as const)(
    "drives %s between points",
    (type) => {
      const { sketch, a, b } = lineSketch();
      const fixed = addConstraint(sketch, "fixed", { pointIds: [a] });
      const solved = solveSketch(
        {
          ...fixed,
          dimensions: [
            {
              id: "distance",
              type,
              entityIds: [],
              pointIds: [a, b],
              expression: expressionRef("20mm"),
            },
          ],
        },
        {},
      );
      expect(solved.errors).toEqual([]);
      const p = solved.points[b];
      expect(
        type === "horizontalDistance"
          ? Math.abs(p.x)
          : type === "verticalDistance"
            ? Math.abs(p.y)
            : Math.hypot(p.x, p.y),
      ).toBeCloseTo(20, 6);
    },
  );
  it.each(["radius", "diameter"] as const)("drives circle %s", (type) => {
    const sketch = addCircleAt(createXySketch(), "0mm", "0mm", "5mm"),
      circle = Object.values(sketch.entities).find((e) => e.type === "circle")!;
    const solved = solveSketch(
      {
        ...sketch,
        dimensions: [
          {
            id: "size",
            type,
            entityIds: [circle.id],
            expression: expressionRef("20mm"),
          },
        ],
      },
      {},
    );
    expect(solved.errors).toEqual([]);
    expect(solved.circles[0].radius).toBeCloseTo(
      type === "radius" ? 20 : 10,
      6,
    );
  });
  it("drives an obtuse angle without flipping the seeded side", () => {
    const base = lineSketch();
    const c = addPoint(base.sketch, "-2mm", "8mm"),
      other = addLine(c.sketch, base.a, c.pointId);
    let sketch = addConstraint(other.sketch, "fixed", {
      entityIds: [base.line],
    });
    sketch = {
      ...sketch,
      dimensions: [
        {
          id: "angle",
          type: "angle",
          entityIds: [base.line, other.lineId],
          expression: expressionRef("135deg", "deg"),
        },
      ],
    };
    const solved = solveSketch(sketch, {});
    expect(solved.errors).toEqual([]);
    const a = solved.lines.find((l) => l.id === base.line)!,
      b = solved.lines.find((l) => l.id === other.lineId)!;
    const u = { x: a.end.x - a.start.x, y: a.end.y - a.start.y },
      v = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
    expect(
      Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y),
    ).toBeCloseTo((3 * Math.PI) / 4, 6);
    expect(u.x * v.y - u.y * v.x).toBeGreaterThan(0);
  });
  it("fails conflicts, redundant constraints, invalid references, and iteration exhaustion with source IDs", () => {
    const { sketch, a, b, line } = lineSketch();
    const fixed = addConstraint(sketch, "fixed", { pointIds: [a, b] });
    const conflict = solveSketch(
      {
        ...fixed,
        dimensions: [
          {
            id: "badLength",
            type: "length",
            entityIds: [line],
            expression: expressionRef("30mm"),
          },
        ],
      },
      {},
    );
    expect(conflict.errors.some((e) => e.constraintId === "badLength")).toBe(
      true,
    );
    expect(detectProfiles(conflict).profiles).toHaveLength(0);
    let redundant = addConstraint(sketch, "horizontal", { entityIds: [line] });
    redundant = addConstraint(redundant, "horizontal", { entityIds: [line] });
    expect(solveSketch(redundant, {}).status).toBe("overconstrained");
    expect(
      solveSketch(
        addConstraint(sketch, "horizontal", { entityIds: ["missing"] }),
        {},
      ).errors[0].message,
    ).toContain("Unresolved");
    const exhausted = solveSketch(
      addConstraint(sketch, "horizontal", { entityIds: [line] }),
      {},
      { maxIterations: 0 },
    );
    expect(exhausted.status).toBe("nonConverged");
    expect(exhausted.errors.some((e) => e.message.includes("budget"))).toBe(
      true,
    );
  });
  it("extracts true mixed arc/line boundaries, stable identity, and excludes construction", () => {
    let sketch = dSketch();
    const source = Object.values(sketch.entities).find(
      (e) => e.type === "arc",
    )!;
    const extra = addPoint(sketch, "0mm", "15mm");
    sketch = extra.sketch;
    const center = Object.values(sketch.entities).find(
      (e) => e.type === "point",
    )!;
    const helper = addLine(sketch, center.id, extra.pointId);
    sketch = setConstruction(helper.sketch, helper.lineId, true);
    const solved = solveSketch(sketch, {});
    expect(solved.errors).toEqual([]);
    expect(solved.arcs[0].sweep).toBeCloseTo(Math.PI);
    const profile = detectProfiles(solved).profiles[0];
    expect(profile.outerLoop.entityIds).toHaveLength(2);
    expect(profile.outerLoop.segments?.some((e) => e.type === "arc")).toBe(
      true,
    );
    expect(profile.outerLoop.entityIds).toContain(source.id);
    const edited = {
      ...sketch,
      dimensions: [
        {
          id: "radius",
          type: "radius" as const,
          entityIds: [source.id],
          expression: expressionRef("20mm"),
        },
      ],
    };
    const next = solveSketch(edited, {});
    expect(next.errors).toEqual([]);
    expect(next.arcs[0].radius).toBeCloseTo(20, 6);
    expect(detectProfiles(next).profiles[0].id).toBe(profile.id);
    const roundTrip = importProjectText(
      serializeProject(upsertSketch(createEmptyDocument(), edited)),
    );
    expect(
      roundTrip.sketches[sketch.id].entities[helper.lineId].construction,
    ).toBe(true);
    expect(roundTrip.sketches[sketch.id].entities[source.id].type).toBe("arc");
  });
  it("rejects zero-sweep arcs and construction-only extrusions", () => {
    let sketch = dSketch();
    const arc = Object.values(sketch.entities).find((e) => e.type === "arc")!;
    if (arc.type !== "arc") throw new Error("Expected arc");
    sketch = {
      ...sketch,
      entities: {
        ...sketch.entities,
        [arc.id]: { ...arc, endPointId: arc.startPointId },
      },
    };
    expect(
      solveSketch(sketch, {}).errors.some(
        (e) => e.entityId === arc.id && e.message.includes("degenerate"),
      ),
    ).toBe(true);
    let construction = dSketch();
    for (const e of Object.values(construction.entities))
      construction = setConstruction(construction, e.id, true);
    expect(detectProfiles(solveSketch(construction, {})).profiles).toHaveLength(
      0,
    );
  });
  it("migrates schema 6 validation intent without moving old dimensions", () => {
    const { sketch, line } = lineSketch();
    const doc = upsertSketch(createEmptyDocument(), {
      ...sketch,
      dimensions: [
        {
          id: "old",
          type: "length",
          entityIds: [line],
          expression: expressionRef("20mm"),
        },
      ],
    });
    const imported = importProjectText(
      JSON.stringify({ ...doc, schemaVersion: 6 }),
    );
    expect(imported.schemaVersion).toBe(7);
    expect(imported.sketches[sketch.id].solveMode).toBe("validate");
    expect(
      solveSketch(imported.sketches[sketch.id], {}).errors[0].message,
    ).toContain("length dimension");
  });
});

describe("stable planar faces and offsets", () => {
  it("tracks cap/side planes through edits, offsets a face, loses a suppressed owner, and explicitly repairs", () => {
    const base = extrude(createEmptyDocument(), dSketch());
    const face = {
      type: "face" as const,
      featureId: base.feature.id,
      stableFaceId: stableFaceId(base.feature.id, "endCap"),
    };
    const child = {
      ...dSketch(),
      plane: {
        type: "offset" as const,
        base: face,
        offset: expressionRef("3mm"),
      },
    };
    let document = upsertSketch(base.document, child);
    let planes = resolveDocumentPlanes(document, {});
    expect(planes.errors.size).toBe(0);
    expect(transformPoint(planes.transforms.get(child.id)!, 2, 3)).toEqual({
      x: 2,
      y: 3,
      z: 8,
    });
    document = upsertFeature(document, {
      ...base.feature,
      distance: expressionRef("12mm"),
    });
    planes = resolveDocumentPlanes(document, {});
    expect(planes.transforms.get(child.id)!.origin.z).toBe(15);
    document = upsertFeature(document, { ...base.feature, suppressed: true });
    expect(resolveDocumentPlanes(document, {}).errors.get(child.id)).toContain(
      "lost",
    );
    expect(rebuildDocument(document).success).toBe(false);
    expect(Object.keys(document.sketches[child.id].entities)).toHaveLength(5);
    document = upsertSketch(document, {
      ...document.sketches[child.id],
      plane: { type: "origin", plane: "XZ" },
    });
    expect(resolveDocumentPlanes(document, {}).errors.size).toBe(0);
    expect(rebuildDocument(document).success).toBe(true);
  });
  it("rejects cyclic/forward references and mismatched stable face identity", () => {
    const base = extrude(createEmptyDocument(), dSketch());
    const child = {
      ...dSketch(),
      plane: {
        type: "face" as const,
        featureId: base.feature.id,
        stableFaceId: "extrude:wrong:endCap",
      },
    };
    expect(
      resolveDocumentPlanes(upsertSketch(base.document, child), {}).errors.get(
        child.id,
      ),
    ).toContain("named face");
    const self = {
      ...base.document.sketches[base.feature.sketchId],
      plane: {
        type: "face" as const,
        featureId: base.feature.id,
        stableFaceId: stableFaceId(base.feature.id, "endCap"),
      },
    };
    expect(
      resolveDocumentPlanes(upsertSketch(base.document, self), {}).errors.get(
        self.id,
      ),
    ).toContain("precede");
  });
});

describe("constraint solving and bounded failures", () => {
  it.each(["parallel", "perpendicular", "equalLength"] as const)(
    "moves a second line to satisfy %s",
    (type) => {
      let { sketch, a, b, line } = lineSketch();
      const c = addPoint(sketch, "0mm", "15mm"),
        d = addPoint(c.sketch, "8mm", "19mm"),
        other = addLine(d.sketch, c.pointId, d.pointId);
      sketch = addConstraint(other.sketch, "fixed", {
        entityIds: [line],
        pointIds: [c.pointId],
      });
      sketch = addConstraint(sketch, type, { entityIds: [line, other.lineId] });
      const solved = solveSketch(sketch, {});
      expect(solved.errors).toEqual([]);
      const u = {
          x: solved.points[b].x - solved.points[a].x,
          y: solved.points[b].y - solved.points[a].y,
        },
        v = {
          x: solved.points[d.pointId].x - solved.points[c.pointId].x,
          y: solved.points[d.pointId].y - solved.points[c.pointId].y,
        };
      expect(
        type === "parallel"
          ? u.x * v.y - u.y * v.x
          : type === "perpendicular"
            ? u.x * v.x + u.y * v.y
            : Math.hypot(u.x, u.y) - Math.hypot(v.x, v.y),
      ).toBeCloseTo(0, 6);
    },
  );
  it("moves a midpoint and symmetric point with fixed reference geometry", () => {
    const base = lineSketch(),
      p = addPoint(base.sketch, "2mm", "7mm");
    const sketch = addConstraint(
      addConstraint(p.sketch, "fixed", { entityIds: [base.line] }),
      "midpoint",
      { entityIds: [base.line], pointIds: [p.pointId] },
    );
    const solved = solveSketch(sketch, {});
    expect(solved.errors).toEqual([]);
    expect(solved.points[p.pointId].x).toBeCloseTo(4, 6);
    expect(solved.points[p.pointId].y).toBeCloseTo(1.5, 6);
    const axisA = addPoint(p.sketch, "0mm", "0mm"),
      axisB = addPoint(axisA.sketch, "0mm", "10mm"),
      mirror = addPoint(axisB.sketch, "-1mm", "4mm");
    const symmetric = addConstraint(
      addConstraint(mirror.sketch, "fixed", {
        pointIds: [p.pointId, axisA.pointId, axisB.pointId],
      }),
      "symmetric",
      { pointIds: [p.pointId, mirror.pointId, axisA.pointId, axisB.pointId] },
    );
    const result = solveSketch(symmetric, {});
    expect(result.errors).toEqual([]);
    expect(result.points[mirror.pointId].x).toBeCloseTo(-2, 6);
    expect(result.points[mirror.pointId].y).toBeCloseTo(7, 6);
  });
  it("drives equal circle radii", () => {
    let sketch = addCircleAt(
      addCircleAt(createXySketch(), "0mm", "0mm", "5mm"),
      "20mm",
      "0mm",
      "8mm",
    );
    const ids = Object.values(sketch.entities)
      .filter((e) => e.type === "circle")
      .map((e) => e.id);
    sketch = addConstraint(
      addConstraint(sketch, "fixed", { entityIds: [ids[0]] }),
      "equalRadius",
      { entityIds: ids },
    );
    const solved = solveSketch(sketch, {});
    expect(solved.errors).toEqual([]);
    expect(solved.circles.every((c) => Math.abs(c.radius - 5) < 1e-7)).toBe(
      true,
    );
  });
  it("supports finite arc tangency and rejects contact outside the sweep", () => {
    const base = dSketch(),
      arc = Object.values(base.entities).find((e) => e.type === "arc")!;
    const testAt = (y: string) => {
      const p = addPoint(base, "-20mm", y),
        q = addPoint(p.sketch, "20mm", y),
        l = addLine(q.sketch, p.pointId, q.pointId);
      return solveSketch(
        addConstraint(
          addConstraint(l.sketch, "fixed", { entityIds: [arc.id] }),
          "tangent",
          { entityIds: [arc.id, l.lineId] },
        ),
        {},
      );
    };
    expect(testAt("10mm").errors).toEqual([]);
    expect(
      testAt("-10mm").errors.some((e) =>
        e.message.includes("outside the arc sweep"),
      ),
    ).toBe(true);
  });
  it("preserves mirrored distance seeds and resets to the authored branch", () => {
    const { sketch, a, b } = lineSketch();
    let dimensioned = addConstraint(sketch, "fixed", { pointIds: [a] });
    dimensioned = {
      ...dimensioned,
      dimensions: [
        {
          id: "dx",
          type: "horizontalDistance",
          entityIds: [],
          pointIds: [a, b],
          expression: expressionRef("20mm"),
        },
      ],
    };
    const canonical = solveSketch(dimensioned, {}),
      seed = {
        ...canonical,
        points: {
          ...canonical.points,
          [b]: { ...canonical.points[b], x: -20 },
        },
      };
    expect(solveSketch(dimensioned, {}, { seed }).points[b].x).toBeCloseTo(
      -20,
      6,
    );
    expect(
      solveSketch(dimensioned, {}, { seed, reset: true }).points[b].x,
    ).toBeCloseTo(20, 6);
  });
  it("diagnoses large sketches and intersecting circular boundaries", () => {
    let large = createXySketch();
    for (let i = 0; i < 81; i++)
      large = addPoint(large, `${i}mm`, "0mm").sketch;
    expect(solveSketch(large, {}).status).toBe("nonConverged");
    const overlapping = addCircleAt(
      addCircleAt(createXySketch(), "0mm", "0mm", "10mm"),
      "15mm",
      "0mm",
      "10mm",
    );
    expect(detectProfiles(solveSketch(overlapping, {})).errors[0]).toContain(
      "intersect",
    );
  });
});

describe("review regression coverage", () => {
  it("does not seed over edited constant coordinates", () => {
    const { sketch, b } = lineSketch(),
      first = solveSketch(sketch, {}),
      point = sketch.entities[b];
    if (point.type !== "point") throw new Error("Expected point");
    const edited = {
      ...sketch,
      entities: {
        ...sketch.entities,
        [b]: { ...point, x: expressionRef("21mm") },
      },
    };
    const solved = solveSketch(edited, {}, { seed: first });
    expect(solved.points[b].x).toBe(21);
    expect(solved.seedUsed).toBe(false);
  });
  it("matches close vertices across spatial-cell boundaries without moving authored points", () => {
    let sketch = createXySketch();
    const coords = [
      [4.9e-9, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5.1e-9, 0],
    ];
    const ids = coords.map(([x, y]) => {
      const point = addPoint(
        sketch,
        `${x.toFixed(12)}mm`,
        `${y.toFixed(12)}mm`,
      );
      sketch = point.sketch;
      return point.pointId;
    });
    for (let i = 0; i < 4; i++)
      sketch = addLine(sketch, ids[i], ids[i + 1]).sketch;
    const solved = solveSketch(sketch, {}),
      profiles = detectProfiles(solved);
    expect(profiles.errors).toEqual([]);
    expect(profiles.profiles).toHaveLength(1);
    expect(solved.points[ids[0]].x).toBe(4.9e-9);
    expect(solved.points[ids[4]].x).toBe(5.1e-9);
  });
  it("reports malformed arrays and rejects malformed plane payloads on import", () => {
    const document = upsertSketch(createEmptyDocument(), dSketch()),
      id = Object.keys(document.sketches)[0];
    const malformed = {
      ...document,
      sketches: { [id]: { ...document.sketches[id], constraints: undefined } },
    } as unknown as typeof document;
    expect(
      validateDocument(malformed).some((e) =>
        e.message.includes("must be arrays"),
      ),
    ).toBe(true);
    expect(() =>
      importProjectText(
        JSON.stringify({
          ...document,
          sketches: {
            [id]: {
              ...document.sketches[id],
              plane: { type: "surprise", runtimeHandle: { secret: "discard" } },
            },
          },
        }),
      ),
    ).toThrow(/plane/);
  });
  it("enforces equal radius across more than two circles", () => {
    let sketch = createXySketch();
    for (let i = 0; i < 3; i++)
      sketch = addCircleAt(sketch, `${20 * i}mm`, "0mm", `${5 + i}mm`);
    const ids = Object.values(sketch.entities)
      .filter((e) => e.type === "circle")
      .map((e) => e.id);
    sketch = addConstraint(
      addConstraint(sketch, "fixed", { entityIds: [ids[0]] }),
      "equalRadius",
      { entityIds: ids },
    );
    const solved = solveSketch(sketch, {});
    expect(solved.errors).toEqual([]);
    expect(solved.circles.every((c) => Math.abs(c.radius - 5) < 1e-7)).toBe(
      true,
    );
  });
});

it("checks owner identity even after multiple face owners were published", () => {
  const a = extrude(createEmptyDocument(), dSketch(), "A"),
    b = extrude(a.document, dSketch(), "B");
  const consumerA = {
    ...dSketch(),
    plane: {
      type: "face" as const,
      featureId: a.feature.id,
      stableFaceId: stableFaceId(a.feature.id, "endCap"),
    },
  };
  const consumerB = {
    ...dSketch(),
    plane: {
      type: "face" as const,
      featureId: b.feature.id,
      stableFaceId: stableFaceId(b.feature.id, "endCap"),
    },
  };
  const mismatched = {
    ...dSketch(),
    plane: {
      type: "face" as const,
      featureId: a.feature.id,
      stableFaceId: stableFaceId(b.feature.id, "endCap"),
    },
  };
  const document = upsertSketch(
    upsertSketch(upsertSketch(b.document, consumerA), consumerB),
    mismatched,
  );
  expect(
    resolveDocumentPlanes(document, {}).errors.get(mismatched.id),
  ).toContain("named face");
});
it("keeps analytic arcs single at an all-arc loop seam", () => {
  let sketch = dSketch();
  const arc = Object.values(sketch.entities).find((e) => e.type === "arc")!;
  if (arc.type !== "arc") throw new Error("Expected arc");
  sketch = {
    ...sketch,
    entities: Object.fromEntries(
      Object.entries(sketch.entities).filter(
        ([, entity]) => entity.type !== "line",
      ),
    ),
  };
  sketch = addArc(
    sketch,
    arc.centerPointId,
    arc.endPointId,
    arc.startPointId,
    false,
  ).sketch;
  const profiles = detectProfiles(solveSketch(sketch, {}));
  expect(profiles.errors).toEqual([]);
  expect(profiles.profiles).toHaveLength(1);
  const segments = profiles.profiles[0].outerLoop.segments!;
  expect(segments).toHaveLength(2);
  expect(new Set(segments.map((segment) => segment.id)).size).toBe(2);
  expect(
    segments.every(
      (segment) => segment.type === "arc" && Math.abs(segment.sweep) > 3,
    ),
  ).toBe(true);
});

it("rejects a dimension whose required expression is missing before solving", () => {
  const { sketch, line } = lineSketch();
  const malformed = {
    ...sketch,
    dimensions: [
      { id: "missing-expression", type: "length", entityIds: [line] },
    ],
  } as unknown as Sketch;
  const document = upsertSketch(createEmptyDocument(), malformed);
  expect(validateDocument(document)).toContainEqual(
    expect.objectContaining({
      sourceId: sketch.id,
      message: "Dimension requires an expression and unit.",
    }),
  );
  expect(rebuildDocument(document).success).toBe(false);
  expect(() => importProjectText(JSON.stringify(document))).toThrow(
    /Dimension requires/,
  );
});

it("does not expose placeholder geometry or reuse a seed after an expression fails", () => {
  const { sketch, a } = lineSketch();
  const seed = solveSketch(sketch, {});
  const p = sketch.entities[a];
  if (p.type !== "point") throw new Error("Expected point");
  const invalid = {
    ...sketch,
    entities: {
      ...sketch.entities,
      [a]: { ...p, x: expressionRef("unknown_coordinate") },
    },
  };
  const result = solveSketch(invalid, {}, { seed });
  expect(result.errors).toContainEqual(
    expect.objectContaining({ entityId: a }),
  );
  expect(result).toMatchObject({
    points: {},
    lines: [],
    circles: [],
    arcs: [],
    seedUsed: false,
    status: "conflicting",
  });
  expect(detectProfiles(result).profiles).toEqual([]);
});

it("maps parameter-driven face offsets both ways using the resolved face context", () => {
  const face = {
    type: "face" as const,
    featureId: "owner",
    stableFaceId: "extrude:owner:endCap",
  };
  const plane = {
    type: "offset" as const,
    base: face,
    offset: expressionRef("spacing"),
  };
  const parameters = { spacing: normalizeQuantity(3, "mm") };
  const faces = new Map([
    [
      face.stableFaceId,
      {
        origin: { x: 0, y: 20, z: 0 },
        u: { x: 1, y: 0, z: 0 },
        v: { x: 0, y: 0, z: 1 },
        normal: { x: 0, y: -1, z: 0 },
      },
    ],
  ]);
  const world = sketchPointToWorld(plane, 2, 4, 5, parameters, faces);
  expect(world).toEqual({ x: 2, y: 12, z: 4 });
  expect(worldPointToSketch(plane, world, parameters, faces)).toEqual({
    x: 2,
    y: 4,
    z: 5,
  });
});

it("rejects numeric point references even when object-key coercion could resolve them", () => {
  const { sketch, a, b, line } = lineSketch();
  const start = sketch.entities[a];
  const edge = sketch.entities[line];
  if (edge.type !== "line") throw new Error("Expected line");
  const malformed = {
    ...sketch,
    entities: {
      "0": { ...start, id: "0" },
      [b]: sketch.entities[b],
      [line]: { ...edge, startPointId: 0 },
    },
  } as unknown as Sketch;
  const document = upsertSketch(createEmptyDocument(), malformed);
  expect(() => importProjectText(JSON.stringify(document))).toThrow(
    /missing start point/,
  );
});
