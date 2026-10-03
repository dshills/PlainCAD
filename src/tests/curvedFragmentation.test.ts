import { describe, expect, it } from "vitest";
import {
  detectProfiles,
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
  it("rejects tangencies, dangling chords, overlapping and intersecting circular boundaries explicitly", () => {
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
        [circle(), circle("other", 10, 15, 0)],
      ).errors.join(" "),
    ).toContain("intersect");
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
  it("diagnoses curved intersections, overlaps, tangencies and dangling tails", () => {
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
    expect(
      detectArcs(
        base,
        [semicircle()],
        [circle("intersecting", 5, 0, 10)],
      ).errors.join(" "),
    ).toContain("unsupported");
  });
});
