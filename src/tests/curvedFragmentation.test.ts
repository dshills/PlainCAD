import { fragmentCurvedProfiles } from "../cad/sketch/curvedFragmentation";
import { describe, expect, it } from "vitest";
import {
  detectProfiles,
  sampleArc,
  type SketchProfile,
} from "../cad/sketch/profileDetection";
import {
  solveSketch,
  type ResolvedCircle,
  type ResolvedArc,
  type ResolvedLine,
} from "../cad/sketch/SketchSolver";
import { createXySketch } from "../cad/sketch/SketchModel";
function line(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ResolvedLine {
  return {
    id,
    start: { id: `${id}:a`, x: x1, y: y1 },
    end: { id: `${id}:b`, x: x2, y: y2 },
  };
}
function circle(id = "circle", radius = 10, x = 0, y = 0): ResolvedCircle {
  return { id, center: { id: `${id}:center`, x, y }, radius };
}
function detect(lines: ResolvedLine[], circles = [circle()]) {
  return detectProfiles({
    ...solveSketch(createXySketch(), {}),
    id: "curved",
    lines,
    circles,
  });
}
function area(profile: SketchProfile) {
  return (
    profile.outerLoop.segments!.reduce(
      (sum, s) =>
        sum +
        (s.type === "line"
          ? s.start.x * s.end.y - s.end.x * s.start.y
          : s.radius * s.radius * s.sweep +
            s.center.x * (s.end.y - s.start.y) -
            s.center.y * (s.end.x - s.start.x)),
      0,
    ) / 2
  );
}
describe("bounded analytic circle divider fragmentation", () => {
  it("splits a circle into analytic semicircles with exact bounds and source lineage", () => {
    const result = detect([line("diameter", -10, 0, 10, 0)]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    for (const p of result.profiles) {
      expect(area(p)).toBeCloseTo(50 * Math.PI, 8);
      expect(
        p.outerLoop.segments!.filter((s) => s.type === "arc"),
      ).toHaveLength(1);
      expect(p.outerLoop.lineageIds).toEqual(["circle", "diameter"]);
      expect(p.bounds.minX).toBeCloseTo(-10, 8);
      expect(p.bounds.maxX).toBeCloseTo(10, 8);
      expect(
        p.outerLoop.segments!.every(
          (s, i, all) =>
            Math.hypot(
              s.end.x - all[(i + 1) % all.length].start.x,
              s.end.y - all[(i + 1) % all.length].start.y,
            ) < 1e-8,
        ),
      ).toBe(true);
    }
    expect(
      result.profiles
        .map((p) => [p.bounds.minY, p.bounds.maxY])
        .sort((a, b) => a[0] - b[0]),
    ).toEqual([
      [-10, 0],
      [0, 10],
    ]);
  });
  it("supports crossing chords and stable IDs through scaling, ordering, winding and translation", () => {
    const original = detect([
      line("h", -10, 0, 10, 0),
      line("v", 0, -10, 0, 10),
    ]);
    expect(original.errors).toEqual([]);
    expect(original.profiles).toHaveLength(4);
    for (const p of original.profiles)
      expect(area(p)).toBeCloseTo(25 * Math.PI, 8);
    const movedLines = [line("h", -20, 0, 20, 0), line("v", 0, -20, 0, 20)]
      .reverse()
      .map((l) => ({
        ...l,
        start: { ...l.end, x: l.end.x + 1000, y: l.end.y - 500 },
        end: { ...l.start, x: l.start.x + 1000, y: l.start.y - 500 },
      }));
    const moved = detect(movedLines, [circle("circle", 20, 1000, -500)]);
    expect(moved.errors).toEqual([]);
    expect(moved.profiles.map((p) => p.id)).toEqual(
      original.profiles.map((p) => p.id),
    );
    for (const p of moved.profiles)
      expect(area(p)).toBeCloseTo(100 * Math.PI, 7);
  });
  it("retains IDs when multiple dividers meet on a circular boundary", () => {
    const lines = [
      line("diameter", -10, 0, 10, 0),
      line("diagonal", -10, 0, 0, 10),
    ];
    const result = detect(lines);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      100 * Math.PI,
      8,
    );
    const reversed = detect(
      [...lines].reverse().map((l) => ({ ...l, start: l.end, end: l.start })),
    );
    expect(reversed.errors).toEqual([]);
    expect(reversed.profiles.map((p) => p.id)).toEqual(
      result.profiles.map((p) => p.id),
    );
  });
  it("retains untouched circle identities and classifies circular holes inside divided regions", () => {
    const circles = [
      circle(),
      circle("hole", 1, 0, 5),
      circle("outside", 2, 40, 40),
    ];
    const result = detect([line("h", -10, 0, 10, 0)], circles);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    expect(
      result.profiles
        .find((p) => Math.abs(p.bounds.minY) < 1e-8)!
        .holes.map((h) => h.id),
    ).toEqual(["hole"]);
    const rectangle = [
      line("b", 30, 0, 40, 0),
      line("r", 40, 0, 40, 10),
      line("t", 40, 10, 30, 10),
      line("l", 30, 10, 30, 0),
    ];
    const disjoint = detect([line("h", -10, 0, 10, 0), ...rectangle]);
    expect(disjoint.errors).toEqual([]);
    expect(disjoint.profiles).toHaveLength(3);
    expect(disjoint.profiles.some((p) => Math.abs(area(p) - 100) < 1e-8)).toBe(
      true,
    );
    const untouched = detect([], [circles[2]]).profiles[0];
    expect(result.profiles.find((p) => p.outerLoop.type === "circle")!.id).toBe(
      untouched.id,
    );
  });
  it("clips intersecting closed line boundaries at exact circle contacts", () => {
    const lines = [
      line("bottom", 0, -12, 12, -12),
      line("right", 12, -12, 12, 12),
      line("top", 12, 12, 0, 12),
      line("left", 0, 12, 0, -12),
    ];
    const result = detect(lines);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      288 + 50 * Math.PI,
      7,
    );
    expect(
      result.profiles
        .flatMap((p) => p.outerLoop.segments!)
        .some((s) => s.type === "arc"),
    ).toBe(true);
  });
  it("rejects tangencies, dangling chords and overlapping boundaries explicitly", () => {
    expect(
      detect([line("tangent", -10, 10, 10, 10)]).errors.join(" "),
    ).toContain("tangential");
    expect(detect([line("tail", -20, 0, 20, 0)]).errors.join(" ")).toContain(
      "open profile endpoint",
    );
    expect(
      detect([line("near", 10 + 5e-9, 0, 10.1 + 5e-9, 1)]).errors.join(" "),
    ).toContain("ambiguous");
    expect(detect([line("half", 0, 0, 10, 0)]).errors.join(" ")).toContain(
      "one boundary contact",
    );
    expect(
      detect([
        line("h", -10, 0, 10, 0),
        line("overlap", -5, 0, 5, 0),
      ]).errors.join(" "),
    ).toContain("overlap");
    expect(
      detect(
        [line("h", -10, 0, 10, 0)],
        [circle(), circle("other", 10, 20, 0)],
      ).errors.join(" "),
    ).toContain("tangential");
  });
  it("ignores construction dividers and never rewrites resolved source entities", () => {
    const source = [line("h", -10, 0, 10, 0)],
      circles = [circle()];
    const before = structuredClone({ source, circles });
    expect(detect(source, circles).errors).toEqual([]);
    expect({ source, circles }).toEqual(before);
    expect(
      detect([{ ...source[0], construction: true }]).profiles[0].outerLoop.type,
    ).toBe("circle");
  });
  it("fails oversized curve graphs with bounded diagnostics", () => {
    const circles = Array.from({ length: 70 }, (_, i) =>
      circle(`c${i}`, 10, i * 40, 0),
    );
    const lines = circles.map((c, i) =>
      line(`l${i}`, c.center.x - 10, 0, c.center.x + 10, 0),
    );
    expect(detect(lines, circles).errors.join(" ")).toContain(
      "8192 graph-segment limit",
    );
  });
});

function semicircle(radius = 10): ResolvedArc {
  return {
    ...circle("arc", radius),
    start: { id: "arc:start", x: radius, y: 0 },
    end: { id: "arc:end", x: -radius, y: 0 },
    startAngle: 0,
    sweep: Math.PI,
  };
}
function detectArcs(
  lines: ResolvedLine[],
  arcs = [semicircle()],
  circles: ResolvedCircle[] = [],
) {
  return detectProfiles({
    ...solveSketch(createXySketch(), {}),
    id: "curved",
    lines,
    circles,
    arcs,
  });
}
describe("analytic straight dividers in mixed arc profiles", () => {
  it("splits a semicircle into exact native-ready quarter boundaries with source lineage", () => {
    const lines = [
      line("diameter", -10, 0, 10, 0),
      line("divider", 0, 0, 0, 10),
    ];
    const arc = semicircle();
    const source = structuredClone({ lines, arc });
    const result = detectArcs(lines, [arc]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    for (const p of result.profiles) {
      expect(area(p)).toBeCloseTo(25 * Math.PI, 8);
      expect(p.outerLoop.lineageIds).toEqual(["arc", "diameter", "divider"]);
      expect(
        p.outerLoop.segments!.filter((s) => s.type === "arc"),
      ).toHaveLength(1);
    }
    expect({ lines, arc }).toEqual(source);
  });
  it("preserves IDs through radius changes, source arc winding and line order", () => {
    const original = detectArcs([
      line("diameter", -10, 0, 10, 0),
      line("divider", 0, 0, 0, 10),
    ]);
    const arc = semicircle(20);
    const reversed = {
      ...arc,
      start: arc.end,
      end: arc.start,
      startAngle: Math.PI,
      sweep: -Math.PI,
    };
    const changed = detectArcs(
      [line("divider", 0, 0, 0, 20), line("diameter", -20, 0, 20, 0)].map(
        (l) => ({ ...l, start: l.end, end: l.start }),
      ),
      [reversed],
    );
    expect(changed.errors).toEqual([]);
    expect(changed.profiles.map((p) => p.id)).toEqual(
      original.profiles.map((p) => p.id),
    );
    for (const p of changed.profiles)
      expect(area(p)).toBeCloseTo(100 * Math.PI, 8);
  });
  it("normalizes start angles beyond one turn for both source windings", () => {
    const lines = [
      line("diameter", -10, 0, 10, 0),
      line("divider", 0, 0, 0, 10),
    ];
    const baseline = detectArcs(lines);
    for (const turns of [-4, 4]) {
      for (const clockwise of [false, true]) {
        const arc = semicircle();
        const shifted = {
          ...arc,
          start: clockwise ? arc.end : arc.start,
          end: clockwise ? arc.start : arc.end,
          startAngle: (clockwise ? Math.PI : 0) + turns * Math.PI * 2,
          sweep: clockwise ? -Math.PI : Math.PI,
        };
        const result = detectArcs(lines, [shifted]);
        expect(result.errors).toEqual([]);
        expect(result.profiles.map((p) => p.id)).toEqual(
          baseline.profiles.map((p) => p.id),
        );
        for (const p of result.profiles)
          expect(area(p)).toBeCloseTo(25 * Math.PI, 8);
      }
    }
  });
  it("preserves unsplit legacy arc profiles and ignores construction dividers", () => {
    const baseline = detectArcs([line("diameter", -10, 0, 10, 0)]);
    expect(baseline.errors).toEqual([]);
    expect(baseline.profiles).toHaveLength(1);
    expect(baseline.profiles[0].id).toBe("curved:profile:pas35uw");
    const ignored = detectArcs([
      line("diameter", -10, 0, 10, 0),
      { ...line("divider", 0, 0, 0, 10), construction: true },
    ]);
    expect(ignored.profiles.map((p) => p.id)).toEqual(
      baseline.profiles.map((p) => p.id),
    );
    expect(area(ignored.profiles[0])).toBeCloseTo(50 * Math.PI, 8);
  });
  it("handles divider junctions at authored arc endpoints and permits ordinary tangent endpoint joins", () => {
    const arc = {
      ...semicircle(),
      end: { id: "arc:end", x: 0, y: 10 },
      sweep: Math.PI / 2,
    };
    const lines = [
      line("top", 0, 10, -10, 10),
      line("left", -10, 10, -10, 0),
      line("bottom", -10, 0, 10, 0),
      line("divider", 0, 0, 0, 10),
    ];
    const result = detectArcs(lines, [arc]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    const areas = result.profiles.map(area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(25 * Math.PI, 8);
    expect(areas[1]).toBeCloseTo(100, 8);
  });
  it("restores major arcs across the angular seam without replacing them by sampled chords", () => {
    const arc = {
      ...semicircle(),
      end: { id: "arc:end", x: 0, y: -10 },
      sweep: (3 * Math.PI) / 2,
    };
    const x = Math.sqrt(50);
    const result = detectArcs(
      [line("closing", 0, -10, 10, 0), line("divider", 10, 0, x, x)],
      [arc],
    );
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      75 * Math.PI + 50,
      8,
    );
    expect(
      result.profiles.some((p) =>
        p.outerLoop.segments!.some(
          (s) => s.type === "arc" && Math.abs(s.sweep) > Math.PI,
        ),
      ),
    ).toBe(true);
  });
  it("recognizes closed mixed-loop ownership during straight-line self-intersection checks", () => {
    const lines = [
      line("a", -10, 0, 10, -10),
      line("b", 10, -10, -10, -10),
      line("c", -10, -10, 10, 0),
    ];
    expect(detectArcs(lines).errors.join(" ")).toContain("self-intersect");
  });
  it("diagnoses an authored mixed-loop self-intersection rather than inventing regions", () => {
    const lines = [
      line("a", 10, 0, -10, 0),
      line("b", -10, 0, 0, 12),
      line("c", 0, 12, 0, -2),
    ];
    const arc = {
      ...semicircle(),
      end: { id: "end", x: 0, y: -10 },
      sweep: (3 * Math.PI) / 2,
    };
    lines.push(line("d", 0, -2, 0, -10));
    expect(detectArcs(lines, [arc]).errors.join(" ")).toContain(
      "self-intersect",
    );
  });
  it("diagnoses curved overlaps, tangencies and dangling tails", () => {
    const base = [
      line("diameter", -10, 0, 10, 0),
      line("divider", 0, 0, 0, 10),
    ];
    expect(
      detectArcs([...base, line("tangent", -5, 10, 5, 10)]).errors.join(" "),
    ).toContain("tangential");
    expect(
      detectArcs([
        line("diameter", -10, 0, 10, 0),
        line("tail", 0, 0, 0, 20),
      ]).errors.join(" "),
    ).toContain("open profile endpoint");
    expect(
      detectArcs(base, [
        semicircle(),
        { ...semicircle(), id: "duplicate" },
      ]).errors.join(" "),
    ).toContain("overlap");
  });
});

const lensArea = (radius: number, separation: number) =>
  2 * radius * radius * Math.acos(separation / (2 * radius)) -
  (separation * Math.sqrt(4 * radius * radius - separation * separation)) / 2;
describe("analytic circle/circle regions", () => {
  it("creates two crescents and an exact two-arc lens without mutating circles", () => {
    const circles = [circle("a"), circle("b", 10, 10, 0)];
    const before = structuredClone(circles),
      result = detect([], circles);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    const areas = result.profiles.map(area).sort((a, b) => a - b);
    const lens = lensArea(10, 10);
    expect(areas[0]).toBeCloseTo(lens, 8);
    for (const value of areas.slice(1))
      expect(value).toBeCloseTo(100 * Math.PI - lens, 8);
    for (const p of result.profiles) {
      expect(p.outerLoop.lineageIds).toEqual(["a", "b"]);
      expect(p.outerLoop.segments).toHaveLength(2);
      expect(p.outerLoop.segments!.every((s) => s.type === "arc")).toBe(true);
    }
    expect(circles).toEqual(before);
  });
  it("preserves IDs through scaling, rotation, translation and circle order", () => {
    const original = detect([], [circle("a"), circle("b", 10, 10, 0)]);
    const edited = detect(
      [],
      [circle("b", 20, 100, 220), circle("a", 20, 100, 200)],
    );
    expect(edited.errors).toEqual([]);
    expect(edited.profiles.map((p) => p.id)).toEqual(
      original.profiles.map((p) => p.id),
    );
    expect(edited.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      4 * (200 * Math.PI - lensArea(10, 10)),
      7,
    );
  });
  it("combines crossing circles and a straight divider through shared intersection contacts", () => {
    const result = detect(
      [line("divider", 5, -Math.sqrt(75), 5, Math.sqrt(75))],
      [circle("a"), circle("b", 10, 10, 0)],
    );
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(4);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      200 * Math.PI - lensArea(10, 10),
      8,
    );
  });
  it("classifies holes and retains untouched nested and disjoint circle IDs", () => {
    const base = [circle("a"), circle("b", 10, 10, 0)];
    const result = detect(
      [],
      [...base, circle("hole", 1, 5, 0), circle("island", 2, 40, 0)],
    );
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(4);
    expect(
      result.profiles.find((p) => p.innerLoops.length)!.holes.map((h) => h.id),
    ).toEqual(["hole"]);
    expect(
      result.profiles.find((p) => p.outerLoop.entityIds[0] === "island")!.id,
    ).toBe(detect([], [circle("island", 2, 40, 0)]).profiles[0].id);
    const nested = detect([], [circle("outer", 10), circle("inner", 5)]);
    expect(nested.errors).toEqual([]);
    expect(nested.profiles).toHaveLength(1);
    expect(nested.profiles[0].holes.map((h) => h.id)).toEqual(["inner"]);
  });
  it("rejects duplicate, external/internal tangent and tolerance-ambiguous circles", () => {
    for (const b of [
      circle("b"),
      circle("b", 10, 20, 0),
      circle("b", 5, 5, 0),
      circle("b", 10, 20 + 5e-9, 0),
    ]) {
      const result = detect([], [circle("a"), b]);
      expect(result.profiles).toEqual([]);
      expect(result.errors.join(" ")).toMatch(/overlap|tangential|ambiguous/);
    }
    expect(
      detect(
        [],
        [circle("a"), { ...circle("b", 10, 10, 0), construction: true }],
      ).profiles[0].outerLoop.type,
    ).toBe("circle");
  });
  it("partitions unequal radii into exact analytic regions", () => {
    const r = 8,
      s = 5,
      d = 7;
    const lens =
      r * r * Math.acos((d * d + r * r - s * s) / (2 * d * r)) +
      s * s * Math.acos((d * d + s * s - r * r) / (2 * d * s)) -
      Math.sqrt((-d + r + s) * (d + r - s) * (d - r + s) * (d + r + s)) / 2;
    const result = detect([], [circle("a", r), circle("b", s, d, 0)]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    const intersection = result.profiles.find(
      (p) =>
        Math.abs(p.bounds.minX - 2) < 1e-8 &&
        Math.abs(p.bounds.maxX - 8) < 1e-8,
    )!;
    expect(area(intersection)).toBeCloseTo(lens, 8);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      Math.PI * (r * r + s * s) - lens,
      8,
    );
  });
  it("partitions three mutually crossing circles and rejects excess contact work", () => {
    const circles = [
      circle("a"),
      circle("b", 10, 10, 0),
      circle("c", 10, 5, 5 * Math.sqrt(3)),
    ];
    const result = detect([], circles);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(7);
    expect(result.profiles.every((p) => area(p) > 0)).toBe(true);
    expect(
      detect([], [...circles].reverse()).profiles.map((p) => p.id),
    ).toEqual(result.profiles.map((p) => p.id));
    const dense = Array.from({ length: 48 }, (_, i) =>
      circle(`c${i}`, 10, i * 0.1, 0),
    );
    expect(detect([], dense).errors.join(" ")).toContain("2048 contact limit");
  });
  it("enforces the combined curve source limit before pair traversal", () => {
    const circles = Array.from({ length: 751 }, (_, i) =>
      circle(`c${i}`, 1, i * 4, 0),
    );
    expect(detect([], circles).errors.join(" ")).toContain(
      "750 source-curve limit",
    );
  });
});

function unequalLensArea(r: number, s: number, d: number) {
  return (
    r * r * Math.acos((d * d + r * r - s * s) / (2 * d * r)) +
    s * s * Math.acos((d * d + s * s - r * r) / (2 * d * s)) -
    Math.sqrt((-d + r + s) * (d + r - s) * (d - r + s) * (d + r + s)) / 2
  );
}
describe("analytic circle/arc contacts", () => {
  it("partitions a closed semicircle and crossing circle into exact regions", () => {
    const arc = semicircle(),
      circles = [circle("cap", 5, 0, 10)],
      lines = [line("diameter", -10, 0, 10, 0)];
    const before = structuredClone({ arc, circles, lines }),
      result = detectArcs(lines, [arc], circles);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    const lens = unequalLensArea(10, 5, 10);
    const intersection = result.profiles.find(
      (p) =>
        Math.abs(p.bounds.minY - 5) < 1e-8 &&
        Math.abs(p.bounds.maxY - 10) < 1e-8,
    )!;
    expect(area(intersection)).toBeCloseTo(lens, 8);
    expect(intersection.outerLoop.segments).toHaveLength(2);
    expect(
      intersection.outerLoop.segments!.every((s) => s.type === "arc"),
    ).toBe(true);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      75 * Math.PI - lens,
      8,
    );
    expect({ arc, circles, lines }).toEqual(before);
  });
  it("preserves profile IDs through scaling and reversed arc/line winding", () => {
    const result = detectArcs(
      [line("diameter", -10, 0, 10, 0)],
      [semicircle()],
      [circle("cap", 5, 0, 10)],
    );
    const arc = semicircle(20);
    const edited = detectArcs(
      [line("diameter", -20, 0, 20, 0)].map((l) => ({
        ...l,
        start: l.end,
        end: l.start,
      })),
      [
        {
          ...arc,
          start: arc.end,
          end: arc.start,
          startAngle: Math.PI,
          sweep: -Math.PI,
        },
      ],
      [circle("cap", 10, 0, 20)],
    );
    expect(edited.errors).toEqual([]);
    expect(edited.profiles.map((p) => p.id)).toEqual(
      result.profiles.map((p) => p.id),
    );
    for (const p of edited.profiles)
      expect(area(p)).toBeCloseTo(
        4 * area(result.profiles.find((x) => x.id === p.id)!),
        8,
      );
  });
  it("does not split arcs at roots outside their authored sweep", () => {
    const arc = semicircle();
    const result = detectArcs(
      [line("diameter", -10, 0, 10, 0)],
      [arc],
      [circle("below", 5, 0, -10)],
    );
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(
      result.profiles.some((p) => p.outerLoop.entityIds.includes("arc")),
    ).toBe(true);
    // A full-circle tangency below the authored semicircle is also irrelevant.
    expect(
      detectArcs(
        [line("diameter", -10, 0, 10, 0)],
        [arc],
        [circle("below", 5, 0, -15)],
      ).errors,
    ).toEqual([]);
  });
  it("supports a partial arc divider whose endpoints meet a full circle", () => {
    const x = Math.sqrt(75),
      arc = {
        ...semicircle(),
        start: { id: "start", x: 5, y: -x },
        end: { id: "end", x: 5, y: x },
        startAngle: -Math.PI / 3,
        sweep: (2 * Math.PI) / 3,
      };
    const result = detectArcs([], [arc], [circle("boundary", 10, 10, 0)]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      100 * Math.PI,
      8,
    );
    expect(
      result.profiles.every((p) =>
        p.outerLoop.segments!.every((s) => s.type === "arc"),
      ),
    ).toBe(true);
  });
  it("rejects sweep-local tangencies, coincident boundaries and dangling arcs", () => {
    expect(
      detectArcs(
        [line("diameter", -10, 0, 10, 0)],
        [semicircle()],
        [circle("tangent", 5, 0, 15)],
      ).errors.join(" "),
    ).toContain("tangential");
    expect(
      detectArcs(
        [line("diameter", -10, 0, 10, 0)],
        [semicircle()],
        [circle("same")],
      ).errors.join(" "),
    ).toContain("overlap");
    expect(
      detectArcs([], [semicircle()], [circle("cap", 5, 0, 10)]).errors.join(
        " ",
      ),
    ).toContain("open profile endpoint");
    const construction = { ...circle("cap", 5, 0, 10), construction: true };
    expect(
      detectArcs(
        [line("diameter", -10, 0, 10, 0)],
        [semicircle()],
        [construction],
      ).profiles,
    ).toHaveLength(1);
  });

  it("diagnoses near-concentric ambiguous circle/arc boundaries", () => {
    expect(
      detectArcs(
        [line("diameter", -10, 0, 10, 0)],
        [semicircle()],
        [circle("near", 10 + 1.5e-8, 0.75e-8, 0)],
      ).errors.join(" "),
    ).toContain("near-concentric");
  });
  it("rejects open arc/arc crossings until a valid closed network is completed", () => {
    const b = {
      ...semicircle(),
      id: "b",
      center: { id: "b:center", x: 10, y: 0 },
      start: { id: "b:start", x: 20, y: 0 },
      end: { id: "b:end", x: 0, y: 0 },
    };
    expect(detectArcs([], [semicircle(), b]).errors.join(" ")).toContain(
      "open profile endpoint",
    );
  });
});

function diskArcs(id: string, radius = 10, x = 0, y = 0): ResolvedArc[] {
  const center = { id: `${id}:center`, x, y },
    right = { id: `${id}:right`, x: x + radius, y },
    left = { id: `${id}:left`, x: x - radius, y };
  return [
    {
      id: `${id}:upper`,
      center,
      radius,
      start: right,
      end: left,
      startAngle: 0,
      sweep: Math.PI,
    },
    {
      id: `${id}:lower`,
      center,
      radius,
      start: left,
      end: right,
      startAngle: Math.PI,
      sweep: Math.PI,
    },
  ];
}
describe("analytic arc/arc contacts", () => {
  it("partitions two arc-only disks into exact lens and crescent regions", () => {
    const arcs = [...diskArcs("a"), ...diskArcs("b", 10, 10, 0)],
      before = structuredClone(arcs);
    const result = detectArcs([], arcs);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(3);
    const lens = lensArea(10, 10),
      areas = result.profiles.map(area).sort((a, b) => a - b);
    const intersection = result.profiles.find(
      (p) =>
        Math.abs(p.bounds.minX) < 1e-8 && Math.abs(p.bounds.maxX - 10) < 1e-8,
    )!;
    expect(intersection.outerLoop.segments).toHaveLength(4);
    expect([...intersection.outerLoop.lineageIds!].sort()).toEqual([
      "a:lower",
      "a:upper",
      "b:lower",
      "b:upper",
    ]);
    expect(
      intersection.outerLoop.segments!.every(
        (segment, i, all) =>
          Math.hypot(
            segment.end.x - all[(i + 1) % all.length].start.x,
            segment.end.y - all[(i + 1) % all.length].start.y,
          ) < 1e-8,
      ),
    ).toBe(true);

    expect(areas[0]).toBeCloseTo(lens, 8);
    for (const a of areas.slice(1))
      expect(a).toBeCloseTo(100 * Math.PI - lens, 8);
    expect(
      result.profiles.every((p) =>
        p.outerLoop.segments!.every((s) => s.type === "arc"),
      ),
    ).toBe(true);
    expect(arcs).toEqual(before);
  });
  it("preserves IDs through scaling, rotation, order and authored winding changes", () => {
    const original = detectArcs(
      [],
      [...diskArcs("a"), ...diskArcs("b", 10, 10, 0)],
    );
    const arcs = [...diskArcs("a", 20), ...diskArcs("b", 20, 20, 0)]
      .map((arc) => ({
        ...arc,
        center: {
          ...arc.center,
          x: -arc.center.y + 100,
          y: arc.center.x + 200,
        },
        start: { ...arc.end, x: -arc.end.y + 100, y: arc.end.x + 200 },
        end: { ...arc.start, x: -arc.start.y + 100, y: arc.start.x + 200 },
        startAngle: arc.startAngle + arc.sweep + Math.PI / 2,
        sweep: -arc.sweep,
      }))
      .reverse();
    const edited = detectArcs([], arcs);
    expect(edited.errors).toEqual([]);
    expect(edited.profiles.map((p) => p.id)).toEqual(
      original.profiles.map((p) => p.id),
    );
    for (const p of edited.profiles)
      expect(area(p)).toBeCloseTo(
        4 * area(original.profiles.find((x) => x.id === p.id)!),
        7,
      );
  });
  it("retains unfragmented legacy arc-only disk IDs and allows shared tangent endpoints", () => {
    const disk = detectArcs([], diskArcs("a"));
    expect(disk.errors).toEqual([]);
    expect(disk.profiles).toHaveLength(1);
    // Pin the legacy ID: saved feature references must survive this new traversal.
    expect(disk.profiles[0].id).toBe("curved:profile:pe2bnmo");
    const changed = detectArcs(
      [],
      diskArcs("a").map((a) => ({
        ...a,
        start: a.end,
        end: a.start,
        startAngle: a.startAngle + a.sweep,
        sweep: -a.sweep,
      })),
    );
    expect(changed.profiles.map((p) => p.id)).toEqual(
      disk.profiles.map((p) => p.id),
    );
    expect(area(disk.profiles[0])).toBeCloseTo(100 * Math.PI, 8);
    // Two quarter arcs with distinct centers meet smoothly at the origin.
    const a = {
      ...diskArcs("a", 10, -10, 0)[0],
      start: { id: "top", x: -10, y: 10 },
      end: { id: "join", x: 0, y: 0 },
      startAngle: Math.PI / 2,
      sweep: -Math.PI / 2,
    };
    const b = {
      ...diskArcs("b", 10, 10, 0)[0],
      start: { id: "join", x: 0, y: 0 },
      end: { id: "bottom", x: 10, y: -10 },
      startAngle: Math.PI,
      sweep: Math.PI / 2,
    };
    const result = detectArcs(
      [
        line("right", 10, -10, 20, -10),
        line("up", 20, -10, 20, 10),
        line("top", 20, 10, -10, 10),
      ],
      [a, b],
    );
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(1);
  });
  it("rejects a proper arc crossing in the same authored closed component", () => {
    const a = diskArcs("a")[0],
      b = diskArcs("b", 10, 10, 0)[0];
    const lines = [
      line("a1", -10, 0, -10, -5),
      line("a2", -10, -5, 20, -5),
      line("a3", 20, -5, 20, 0),
      line("b1", 0, 0, 0, -10),
      line("b2", 0, -10, 10, -10),
      line("b3", 10, -10, 10, 0),
    ];
    expect(detectArcs(lines, [a, b]).errors.join(" ")).toContain(
      "self-intersect in an authored closed loop",
    );
  });
  it("filters roots outside sweeps and diagnoses coincident overlaps and interior tangencies", () => {
    const a = diskArcs("a")[0],
      b = diskArcs("b", 10, 10, 0)[1];
    const lines = [line("base", -10, 0, 20, 0)];
    const result = detectArcs(lines, [a, b]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      100 * Math.PI,
      8,
    );
    expect(
      detectArcs([], [a, { ...a, id: "duplicate" }]).errors.join(" "),
    ).toContain("overlap");
    expect(
      detectArcs(
        [],
        [...diskArcs("a"), ...diskArcs("b", 10, 0, 20)],
      ).errors.join(" "),
    ).toContain("tangential");
  });
});

describe("partial arc/arc dividers", () => {
  it("partitions an arc-only disk with a finite divider ending on its boundaries", () => {
    const y = Math.sqrt(75),
      divider = {
        ...diskArcs("divider")[0],
        start: { id: "divider:start", x: 5, y: -y },
        end: { id: "divider:end", x: 5, y },
        startAngle: -Math.PI / 3,
        sweep: (2 * Math.PI) / 3,
      };
    const result = detectArcs(
      [],
      [...diskArcs("boundary", 10, 10, 0), divider],
    );
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
      100 * Math.PI,
      8,
    );
  });
});


it("distinguishes supporting-circle crossings outside a finite arc from real near tangencies and endpoint contacts", () => {
  const rightArc: ResolvedArc = { ...circle("right", 6, 10), start: { id: "a", x: 10, y: -6 }, end: { id: "b", x: 10, y: 6 }, startAngle: -Math.PI / 2, sweep: Math.PI };
  const key = (point: { x: number; y: number }) => `${point.x}:${point.y}`;
  const outside = fragmentCurvedProfiles([line("outside", -10, 5, 10, 5)], [], [rightArc], key, sampleArc);
  expect(outside.errors).toEqual([]); expect(outside.handled).toBe(false);
  const nearTangent = fragmentCurvedProfiles([line("near", 5, 6 + 0.5e-8, 15, 6 + 0.5e-8)], [], [rightArc], key, sampleArc);
  expect(nearTangent.errors.join(" ")).toMatch(/tangential|ambiguous/);
  const endpoint = fragmentCurvedProfiles([line("endpoint", 0, 0, 16, 0)], [], [rightArc], key, sampleArc);
  // A line ending inside the arc span splits the semicircle into two exact quarters.
  expect(endpoint.handled).toBe(true); expect(endpoint.errors).toEqual([]);
  // The runtime map has one entry per sampled graph edge, intentionally sharing
  // the complete analytic piece under several keys. Count the analytic IDs.
  const pieces = [...new Map([...endpoint.arcs.values()].map((arc) => [arc.id, arc])).values()].sort((a, b) => a.startAngle - b.startAngle);
  expect(pieces).toHaveLength(2);
  for (const [index, coordinates] of [[10, -6, 16, 0], [16, 0, 10, 6]].entries()) {
    const piece = pieces[index];
    [piece.start.x, piece.start.y, piece.end.x, piece.end.y].forEach((value, axis) => expect(value).toBeCloseTo(coordinates[axis], 12));
  }
  expect(pieces[0].startAngle).toBeCloseTo(-Math.PI / 2, 12);
  expect(pieces[1].startAngle).toBeCloseTo(0, 12);
  for (const piece of pieces) expect(piece.sweep).toBeCloseTo(Math.PI / 2, 12);
});
