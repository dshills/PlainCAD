import { describe, expect, it } from "vitest";
import {
  canvasBoxesOverlap,
  layoutCanvasLabels,
  MAX_CANVAS_LABELS,
} from "../cad/sketch/canvasLabelLayout";
import type { CanvasLabelInput } from "../cad/sketch/canvasLabelLayout";
const view = { x: -30, y: -20, width: 60, height: 40 };
function labels(count: number): CanvasLabelInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `label-${i}`,
    label: `D${i + 1} L 20.0000 mm`,
    position: { x: 0, y: 0 },
    align: "middle",
  }));
}
describe("bounded transient canvas annotation layout", () => {
  it("separates coincident labels and point handles deterministically without editing input", () => {
    const input = labels(8),
      original = structuredClone(input);
    const pointBox = { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
    const placements = layoutCanvasLabels(input, 1, view, [], [{ x: 0, y: 0 }]);
    expect(layoutCanvasLabels(input, 1, view, [], [{ x: 0, y: 0 }])).toEqual(
      placements,
    );
    const placed = [...placements.values()];
    expect(placed).toHaveLength(8);
    for (const [i, p] of placed.entries()) {
      expect(p.crowded).toBe(false);
      expect(canvasBoxesOverlap(p.box, pointBox)).toBe(false);
      for (const q of placed.slice(i + 1))
        expect(canvasBoxesOverlap(p.box, q.box)).toBe(false);
      expect(p.box.minX).toBeGreaterThanOrEqual(view.x);
      expect(p.box.maxX).toBeLessThanOrEqual(view.x + view.width);
      expect(p.box.minY).toBeGreaterThanOrEqual(view.y);
      expect(p.box.maxY).toBeLessThanOrEqual(view.y + view.height);
    }
    expect(input).toEqual(original);
  });
  it("reserves dimension labels when placing start-aligned constraint labels", () => {
    const dimensions = layoutCanvasLabels(labels(3), 1, view);
    const boxes = [...dimensions.values()].map((p) => p.box);
    const constraints = layoutCanvasLabels(
      labels(4).map((l) => ({
        ...l,
        id: `c${l.id}`,
        label: "C1 H — satisfied",
        align: "start",
      })),
      1,
      view,
      boxes,
    );
    for (const p of constraints.values()) {
      expect(p.crowded).toBe(false);
      for (const b of boxes) expect(canvasBoxesOverlap(p.box, b)).toBe(false);
    }
  });
  it("bounds rendering and explicitly reports crowded or oversized fallbacks", () => {
    const placements = layoutCanvasLabels(labels(300), 1, {
      x: 0,
      y: 0,
      width: 10,
      height: 2,
    });
    expect(placements.size).toBe(MAX_CANVAS_LABELS);
    expect([...placements.values()].every((p) => p.crowded)).toBe(true);
    for (const p of placements.values())
      expect([p.position.x, p.position.y].every(Number.isFinite)).toBe(true);
  });
  it("reports invalid label positions and omitted point obstacles instead of dropping labels silently", () => {
    const input = labels(1);
    const invalid = layoutCanvasLabels(
      [{ ...input[0], position: { x: NaN, y: 0 } }],
      1,
      view,
    ).get(input[0].id)!;
    expect(invalid.crowded).toBe(true);
    expect(
      [invalid.position.x, invalid.position.y].every(Number.isFinite),
    ).toBe(true);
    const limited = layoutCanvasLabels(
      input,
      1,
      view,
      [],
      Array.from({ length: 751 }, () => ({ x: 100, y: 100 })),
    ).get(input[0].id)!;
    expect(limited.crowded).toBe(true);
  });
  it("repositions labels after zoom/pan and rejects invalid view metrics", () => {
    const input = labels(1);
    const p = layoutCanvasLabels(input, 1, {
      x: 10,
      y: 10,
      width: 40,
      height: 30,
    }).get(input[0].id)!;
    expect(p.box.minX).toBeGreaterThanOrEqual(10);
    expect(p.box.minY).toBeGreaterThanOrEqual(10);
    expect(p.crowded).toBe(false);
    expect(() => layoutCanvasLabels(input, NaN, view)).toThrow("finite");
    expect(() => layoutCanvasLabels(input, 1, { ...view, width: 0 })).toThrow(
      "positive",
    );
  });
});
