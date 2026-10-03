import { describe, expect, it } from "vitest";
import {
  detectProfiles,
  type SketchProfile,
} from "../cad/sketch/profileDetection";
import { solveSketch, type ResolvedLine } from "../cad/sketch/SketchSolver";
import { createXySketch } from "../cad/sketch/SketchModel";
import { SKETCH_TOLERANCE } from "../cad/sketch/tolerances";

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
function rectangle(width = 40): ResolvedLine[] {
  return [
    line("bottom", 0, 0, width, 0),
    line("right", width, 0, width, 30),
    line("top", width, 30, 0, 30),
    line("left", 0, 30, 0, 0),
  ];
}
function detect(lines: ResolvedLine[]) {
  return detectProfiles({
    ...solveSketch(createXySketch(), {}),
    id: "partition",
    lines,
  });
}
function area(profile: SketchProfile) {
  return (
    profile.outerLoop.segments!.reduce(
      (n, s) => n + s.start.x * s.end.y - s.end.x * s.start.y,
      0,
    ) / 2
  );
}
describe("bounded straight-line profile fragmentation", () => {
  it("handles concurrent divider crossings and far-translated cells", () => {
    const lines = [
      ...rectangle(),
      line("v", 20, 0, 20, 30),
      line("h", 0, 15, 40, 15),
      line("d", 0, 0, 40, 30),
    ];
    const result = detect(lines);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(6);
    const shifted = lines.map((l) => ({
      ...l,
      start: { ...l.start, x: l.start.x + 1e8, y: l.start.y + 1e8 },
      end: { ...l.end, x: l.end.x + 1e8, y: l.end.y + 1e8 },
    }));
    const translated = detect(shifted);
    expect(translated.errors).toEqual([]);
    expect(translated.profiles.map((p) => p.id)).toEqual(
      result.profiles.map((p) => p.id),
    );
    expect(
      translated.profiles.every(
        (p) => p.bounds.minX >= 1e8 && p.bounds.minY >= 1e8,
      ),
    ).toBe(true);
  });
  it("splits boundary T-junctions into selectable cells without changing source geometry", () => {
    const lines = [...rectangle(), line("divider", 10, 0, 10, 30)],
      before = JSON.stringify(lines),
      result = detect(lines);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.map(area).sort((a, b) => a - b)).toEqual([300, 900]);
    expect(JSON.stringify(lines)).toBe(before);
    for (const profile of result.profiles) {
      expect(profile.outerLoop.lineageIds).toContain("divider");
      expect(profile.outerLoop.lineageIds).toContain("bottom");
      expect(
        profile.outerLoop.segments?.filter(
          (s) => s.type === "line" && s.sourceEntityId === "bottom",
        ),
      ).toHaveLength(1);
      expect(profile.alternateIds).toBeUndefined();
    }
  });
  it("fragments crossing dividers into four bounded faces and retains stable IDs through size, order and direction edits", () => {
    const dividers = [
      line("vertical", 10, 0, 10, 30),
      line("horizontal", 0, 12, 40, 12),
    ];
    const result = detect([...rectangle(), ...dividers]);
    expect(result.errors).toEqual([]);
    expect(result.profiles.map(area).sort((a, b) => a - b)).toEqual([
      120, 180, 360, 540,
    ]);
    const edited = [
      ...rectangle(60),
      line("vertical", 20, 0, 20, 30),
      line("horizontal", 0, 12, 60, 12),
    ];
    const larger = detect(
      edited.reverse().map((l) => ({ ...l, start: l.end, end: l.start })),
    );
    expect(larger.errors).toEqual([]);
    expect(larger.profiles.map((p) => p.id).sort()).toEqual(
      result.profiles.map((p) => p.id).sort(),
    );
    expect(larger.profiles.map(area).reduce((a, b) => a + b)).toBe(1800);
    for (const profile of result.profiles) {
      const resized = larger.profiles.find((p) => p.id === profile.id)!;
      expect(resized.outerLoop.lineageIds).toEqual(
        profile.outerLoop.lineageIds,
      );
      expect(resized.bounds.minY).toBe(profile.bounds.minY);
      expect(resized.bounds.maxY).toBe(profile.bounds.maxY);
      expect(resized.bounds.minX).toBe(profile.bounds.minX * 2);
    }
  });
  it("changes identities when partition topology changes instead of silently reusing a whole-region alias", () => {
    const first = detect(rectangle()),
      split = detect([...rectangle(), line("divider", 10, 0, 10, 30)]);
    expect(split.profiles.some((p) => p.id === first.profiles[0].id)).toBe(
      false,
    );
    expect(split.profiles.every((p) => !p.alternateIds)).toBe(true);
  });
  it("keeps nested circular holes attached to the containing cell", () => {
    const solved = {
      ...solveSketch(createXySketch(), {}),
      lines: [...rectangle(), line("divider", 10, 0, 10, 30)],
      circles: [
        { id: "hole", center: { id: "center", x: 5, y: 15 }, radius: 2 },
      ],
    };
    const result = detectProfiles(solved);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(
      result.profiles.find((p) => p.bounds.maxX === 10)?.holes,
    ).toHaveLength(1);
    expect(
      result.profiles.find((p) => p.bounds.minX === 10)?.holes,
    ).toHaveLength(0);
  });
  it("rejects open dividers, authored bow-ties, overlapping lines and ambiguous point contacts", () => {
    expect(
      detect([...rectangle(), line("branch1", 10, 0, 10, 15)]).errors.join(" "),
    ).toContain("open profile endpoint");
    const bow = [
      line("a", 0, 0, 20, 20),
      line("b", 20, 20, 0, 20),
      line("c", 0, 20, 20, 0),
      line("d", 20, 0, 0, 0),
    ];
    expect(detect(bow).errors.join(" ")).toContain("self-intersect");
    expect(
      detect([...rectangle(), line("line5", 5, 0, 20, 0)]).errors.join(" "),
    ).toContain("overlap and cannot form a clean profile");
    const touching = rectangle().concat(
      rectangle().map((l) => ({
        ...l,
        id: `${l.id}2`,
        start: {
          ...l.start,
          id: `${l.start.id}2`,
          x: l.start.x + 40,
          y: l.start.y + 30,
        },
        end: { ...l.end, id: `${l.end.id}2`, x: l.end.x + 40, y: l.end.y + 30 },
      })),
    );
    expect(detect(touching).errors.join(" ")).toContain("ambiguous");
  });
  it("uses closure tolerance for near endpoint T-junctions and excludes construction dividers", () => {
    const result = detect([
      ...rectangle(),
      line("divider", 10, SKETCH_TOLERANCE / 2, 10, 30 - SKETCH_TOLERANCE / 2),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    const construction = detect([
      ...rectangle(),
      { ...line("divider", 10, 0, 10, 30), construction: true },
    ]);
    expect(construction.profiles).toHaveLength(1);
  });
  it("fails large intersection grids with a bounded fragment diagnostic", () => {
    const grid = Array.from({ length: 50 }, (_, i) =>
      line(`h${i}`, 0, i + 1, 51, i + 1),
    ).concat(
      Array.from({ length: 50 }, (_, i) => line(`v${i}`, i + 1, 0, i + 1, 51)),
    );
    const result = detect(grid);
    expect(result.profiles).toEqual([]);
    expect(result.errors.join(" ")).toContain("2048 fragment limit");
  });
});
