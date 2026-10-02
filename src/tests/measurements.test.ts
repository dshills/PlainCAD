import { describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import {
  addCornerRectangle,
  createSketchOnPlane,
  addCircleAt,
  setConstruction,
  addPoint,
  addArc,
} from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import {
  measureWorldPoint,
  measureSketchEntity,
  pointDistance,
  formatMeasuredLength,
} from "../cad/inspection/measurements";

describe("solved geometry measurements", () => {
  it.each(["XY", "XZ", "YZ"] as const)(
    "measures %s world points on offset planes and analytic line lengths",
    (plane) => {
      const sketch = addCornerRectangle(
        createSketchOnPlane("Offset", {
          type: "offset",
          base: plane,
          offset: { expression: "7mm", unit: "mm" },
        }),
        "3mm",
        "4mm",
      );
      const doc = upsertSketch(createEmptyDocument(), sketch),
        result = rebuildDocument(doc);
      expect(result.success).toBe(true);
      const points = Object.values(sketch.entities).filter(
        (e) => e.type === "point",
      );
      const first = measureWorldPoint(doc, result, {
          sketchId: sketch.id,
          entityId: points[0].id,
        }),
        last = measureWorldPoint(doc, result, {
          sketchId: sketch.id,
          entityId: points[2].id,
        });
      expect(pointDistance(first, last).length).toBe(5);
      expect(first).toEqual(
        plane === "XY"
          ? { x: 0, y: 0, z: 7 }
          : plane === "XZ"
            ? { x: 0, y: -7, z: 0 }
            : { x: 7, y: 0, z: 0 },
      );
      const line = Object.values(sketch.entities).find(
        (e) => e.type === "line",
      )!;
      expect(
        measureSketchEntity(doc, result, {
          sketchId: sketch.id,
          entityId: line.id,
        }).length,
      ).toBe(3);
      expect(formatMeasuredLength(25.4, "in")).toBe("1.0000 in");
      expect(formatMeasuredLength(-1e-9, "mm")).toBe("0.0000 mm");
    },
  );
  it("uses analytic arc length and radius rather than sampled profile chords", () => {
    let sketch = createSketchOnPlane("XY");
    const center = addPoint(sketch, "0mm", "0mm");
    sketch = center.sketch;
    const start = addPoint(sketch, "5mm", "0mm");
    sketch = start.sketch;
    const end = addPoint(sketch, "0mm", "5mm");
    sketch = end.sketch;
    const arc = addArc(sketch, center.pointId, start.pointId, end.pointId);
    sketch = setConstruction(arc.sketch, arc.arcId, true);
    sketch = addCircleAt(sketch, "0mm", "0mm", "2mm");
    const circle = Object.values(sketch.entities).find(
      (e) => e.type === "circle",
    )!;
    sketch = setConstruction(sketch, circle.id, true);
    const doc = upsertSketch(createEmptyDocument(), sketch),
      result = rebuildDocument(doc);
    expect(result.success).toBe(true);
    const measured = measureSketchEntity(doc, result, {
      sketchId: sketch.id,
      entityId: arc.arcId,
    });
    expect(measured.length).toBeCloseTo((5 * Math.PI) / 2, 10);
    expect(measured).toMatchObject({
      radius: 5,
      diameter: 10,
      sweepDegrees: 90,
    });
    expect(
      measureSketchEntity(doc, result, {
        sketchId: sketch.id,
        entityId: circle.id,
      }).length,
    ).toBeCloseTo(4 * Math.PI, 10);
    expect(() =>
      measureWorldPoint(doc, result, { sketchId: sketch.id, entityId: "lost" }),
    ).toThrow(/reference/);
    expect(() =>
      measureWorldPoint(
        doc,
        { ...result, success: false },
        { sketchId: sketch.id, entityId: center.pointId },
      ),
    ).toThrow(/successful rebuild/);
    expect(() =>
      measureWorldPoint({ ...doc, id: "other" }, result, {
        sketchId: sketch.id,
        entityId: center.pointId,
      }),
    ).toThrow(/current project/);
    expect(() =>
      pointDistance({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
    ).toThrow(/finite/);
  });
});
