import { describe, expect, it } from "vitest";
import { addCenterRectangle, addCircleAt, addConstraint, addCornerRectangle, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
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

  it("detects a standalone circle profile", () => {
    const sketch = addCircleAt(createXySketch(), "5mm", "6mm", "4mm");
    const solved = solveSketch(sketch, {});
    const profiles = detectProfiles(solved);
    expect(profiles.errors).toEqual([]);
    expect(profiles.profiles).toHaveLength(1);
    expect(profiles.profiles[0].outerLoop.type).toBe("circle");
    expect(profiles.profiles[0].bounds).toMatchObject({ minX: 1, maxX: 9, minY: 2, maxY: 10 });
  });

  it("rejects open rectangle profiles with a useful error", () => {
    let sketch = createXySketch();
    const p1 = addPoint(sketch, "0mm", "0mm");
    sketch = p1.sketch;
    const p2 = addPoint(sketch, "10mm", "0mm");
    sketch = p2.sketch;
    const p3 = addPoint(sketch, "10mm", "5mm");
    sketch = p3.sketch;
    sketch = addLine(sketch, p1.pointId, p2.pointId).sketch;
    sketch = addLine(sketch, p2.pointId, p3.pointId).sketch;
    const profiles = detectProfiles(solveSketch(sketch, {}));
    expect(profiles.profiles).toHaveLength(0);
    expect(profiles.errors[0]).toContain("open profile");
  });

  it("reports unsupported triangles without calling them open", () => {
    let sketch = createXySketch();
    const p1 = addPoint(sketch, "0mm", "0mm");
    sketch = p1.sketch;
    const p2 = addPoint(sketch, "10mm", "0mm");
    sketch = p2.sketch;
    const p3 = addPoint(sketch, "5mm", "10mm");
    sketch = p3.sketch;
    sketch = addLine(sketch, p1.pointId, p2.pointId).sketch;
    sketch = addLine(sketch, p2.pointId, p3.pointId).sketch;
    sketch = addLine(sketch, p3.pointId, p1.pointId).sketch;
    const profiles = detectProfiles(solveSketch(sketch, {}));
    expect(profiles.profiles).toHaveLength(0);
    expect(profiles.errors[0]).toContain("Triangular profiles");
  });

  it("reports circles outside a rectangular profile", () => {
    let sketch = addCenterRectangle(createXySketch(), "20mm", "10mm");
    sketch = addCircleAt(sketch, "20mm", "0mm", "2mm");
    const profiles = detectProfiles(solveSketch(sketch, {}));
    expect(profiles.profiles).toHaveLength(1);
    expect(profiles.errors[0]).toContain("outside");
  });

  it("rejects ambiguous standalone circles", () => {
    let sketch = addCircleAt(createXySketch(), "0mm", "0mm", "2mm");
    sketch = addCircleAt(sketch, "6mm", "0mm", "2mm");
    const profiles = detectProfiles(solveSketch(sketch, {}));
    expect(profiles.profiles).toHaveLength(0);
    expect(profiles.errors[0]).toContain("ambiguous");
  });

  it("reports mixed partial line and circle geometry as missing an outer profile", () => {
    let sketch = createXySketch();
    const p1 = addPoint(sketch, "0mm", "0mm");
    sketch = p1.sketch;
    const p2 = addPoint(sketch, "10mm", "0mm");
    sketch = p2.sketch;
    sketch = addLine(sketch, p1.pointId, p2.pointId).sketch;
    sketch = addCircleAt(sketch, "5mm", "5mm", "1mm");
    const profiles = detectProfiles(solveSketch(sketch, {}));
    expect(profiles.errors[0]).toContain("no supported rectangular outer profile");
  });

  it("rejects invalid circle radius", () => {
    const sketch = addCircleAt(createXySketch(), "0mm", "0mm", "-1mm");
    const solved = solveSketch(sketch, {});
    expect(solved.errors[0].message).toContain("greater than zero");
  });

  it("creates a corner rectangle helper", () => {
    const sketch = addCornerRectangle(createXySketch(), "20mm", "10mm");
    expect(Object.values(sketch.entities).filter((entity) => entity.type === "point")).toHaveLength(4);
    expect(Object.values(sketch.entities).filter((entity) => entity.type === "line")).toHaveLength(4);
  });

  it("reports horizontal and vertical constraint conflicts", () => {
    let sketch = createXySketch();
    const start = addPoint(sketch, "0mm", "0mm");
    sketch = start.sketch;
    const end = addPoint(sketch, "10mm", "5mm");
    sketch = end.sketch;
    const line = addLine(sketch, start.pointId, end.pointId);
    sketch = addConstraint(line.sketch, "horizontal", { entityIds: [line.lineId] });
    const solved = solveSketch(sketch, {});
    expect(solved.errors[0].message).toContain("horizontal");
  });

  it("synchronizes coincident points before resolving lines", () => {
    let sketch = createXySketch();
    const p1 = addPoint(sketch, "0mm", "0mm");
    sketch = p1.sketch;
    const p2 = addPoint(sketch, "10mm", "5mm");
    sketch = p2.sketch;
    sketch = addConstraint(sketch, "coincident", { pointIds: [p1.pointId, p2.pointId] });
    const solved = solveSketch(sketch, {});
    expect(solved.points[p2.pointId]).toMatchObject({ x: 0, y: 0 });
  });

  it("synchronizes coincident point chains independent of constraint order", () => {
    let sketch = createXySketch();
    const p1 = addPoint(sketch, "0mm", "0mm");
    sketch = p1.sketch;
    const p2 = addPoint(sketch, "10mm", "5mm");
    sketch = p2.sketch;
    const p3 = addPoint(sketch, "20mm", "15mm");
    sketch = p3.sketch;
    sketch = addConstraint(sketch, "coincident", { pointIds: [p2.pointId, p3.pointId] });
    sketch = addConstraint(sketch, "coincident", { pointIds: [p1.pointId, p2.pointId] });
    const solved = solveSketch(sketch, {});
    expect(solved.points[p3.pointId]).toMatchObject({ x: 0, y: 0 });
  });

  it("reports conflicting fixed coincident points", () => {
    let sketch = createXySketch();
    const p1 = addPoint(sketch, "0mm", "0mm");
    sketch = p1.sketch;
    const p2 = addPoint(sketch, "10mm", "0mm");
    sketch = p2.sketch;
    sketch = addConstraint(sketch, "fixed", { pointIds: [p1.pointId, p2.pointId] });
    sketch = addConstraint(sketch, "coincident", { pointIds: [p1.pointId, p2.pointId] });
    const solved = solveSketch(sketch, {});
    expect(solved.errors[0].message).toContain("fixed point");
  });
});
