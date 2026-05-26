import { describe, expect, it } from "vitest";
import { addCenterRectangle, addCircleAt, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { normalizeQuantity } from "../cad/parameters/units";

describe("sketch helpers and profile detection", () => {
  it("creates a rectangle profile", () => {
    const sketch = addCenterRectangle(createXySketch(), "80mm", "50mm");
    const solved = solveSketch(sketch, {});
    const profiles = detectProfiles(solved);
    expect(solved.errors).toEqual([]);
    expect(profiles.profiles).toHaveLength(1);
    expect(profiles.profiles[0].outerLoop.type).toBe("polygon");
  });

  it("detects rectangle with circular holes", () => {
    let sketch = addCenterRectangle(createXySketch(), "plate_width", "plate_height");
    sketch = addCircleAt(sketch, "0mm", "0mm", "hole_diameter / 2");
    const solved = solveSketch(sketch, {
      plate_width: normalizeQuantity(80, "mm"),
      plate_height: normalizeQuantity(50, "mm"),
      hole_diameter: normalizeQuantity(4, "mm"),
    });
    const profiles = detectProfiles(solved);
    expect(profiles.profiles[0].innerLoops).toHaveLength(1);
  });

  it("rejects invalid circle radius", () => {
    const sketch = addCircleAt(createXySketch(), "0mm", "0mm", "-1mm");
    const solved = solveSketch(sketch, {});
    expect(solved.errors[0].message).toContain("greater than zero");
  });
});
