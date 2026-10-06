import { expect, it } from "vitest";
import { canvasCurveSnapTargets, type CanvasSnapCurve } from "../cad/sketch/canvasCurveSnapping";
const point = (x: number, y: number) => ({ id: `${x}:${y}`, x, y });
const line = (id: string, ax: number, ay: number, bx: number, by: number): CanvasSnapCurve => ({ id, start: point(ax, ay), end: point(bx, by) });
const circle = (id: string, x: number, y: number, radius: number): CanvasSnapCurve => ({ id, center: point(x, y), radius });
const targets = (curves: CanvasSnapCurve[], raw = { x: 0, y: 0 }, anchor?: { x: number; y: number }) => canvasCurveSnapTargets(curves, raw, { x: 10, y: 10 }, anchor).points;
it("intersects finite segments, circles and arcs without mutating source geometry", () => {
  const curves = [line("horizontal", -10, 0, 10, 0), line("vertical", 0, -10, 0, 10), circle("circle", 0, 0, 5)];
  const before = structuredClone(curves);
  const result = targets(curves);
  expect(result).toContainEqual({ x: 0, y: 0, kind: "intersection", sourceId: "horizontal:vertical" });
  for (const [x, y] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) expect(result.some((p) => Math.abs(p.x - x) < 1e-8 && Math.abs(p.y - y) < 1e-8)).toBe(true);
  expect(curves).toEqual(before);
  expect(targets([line("short", 1, 1, 2, 1), line("far", 3, 0, 3, 2)])).toEqual([]);
  const arc = { id: "arc", center: point(0, 0), radius: 5, start: point(5, 0), end: point(0, 5), startAngle: 0, sweep: Math.PI / 2 };
  const hits = targets([arc, line("axis", -10, 0, 10, 0)]);
  expect(hits).toEqual([{ x: 5, y: 0, kind: "intersection", sourceId: "arc:axis" }]);
  expect(targets([{ ...arc, startAngle: 0, sweep: -Math.PI / 2 }, line("vertical", 0, -10, 0, 10)])).toEqual([{ x: 0, y: -5, kind: "intersection", sourceId: "arc:vertical" }]);
});
it("handles external/internal tangency and excludes coincident, disjoint and degenerate curves", () => {
  expect(targets([circle("a", 0, 0, 5), circle("b", 10, 0, 5)])).toEqual([{ x: 5, y: 0, kind: "intersection", sourceId: "a:b" }]);
  expect(targets([circle("a", 0, 0, 5), circle("b", 3, 0, 2)])).toEqual([{ x: 5, y: 0, kind: "intersection", sourceId: "a:b" }]);
  expect(targets([circle("a", 0, 0, 5), circle("b", 0, 0, 5)])).toEqual([]);
  expect(targets([line("zero", 0, 0, 0, 0), circle("b", 0, 0, 5)])).toEqual([]);
  expect(targets([circle("a", 0, 0, 5), circle("b", 20, 0, 1)])).toEqual([]);
});
it("places exact tangent endpoints from an external line anchor, limited to the arc sweep", () => {
  const c = circle("circle", 0, 0, 5), anchor = { x: 10, y: 0 };
  const result = targets([c], { x: 2.5, y: 4 }, anchor);
  expect(result).toHaveLength(2);
  for (const p of result) {
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 10);
    expect(p.x * (anchor.x - p.x) + p.y * (anchor.y - p.y)).toBeCloseTo(0, 10);
    expect(p.kind).toBe("tangent");
  }
  expect(targets([c], undefined, { x: 0, y: 0 })).toEqual([]);
  const arc = { ...c, start: point(5, 0), end: point(0, 5), startAngle: 0, sweep: Math.PI / 2 };
  expect(targets([arc], undefined, anchor)).toHaveLength(1);
});
it("bounds pair work, filters nonfinite geometry and produces stable results independent of curve order", () => {
  const curves = [line("z", -5, 0, 5, 0), line("a", 0, -5, 0, 5)];
  expect(targets(curves)).toEqual(targets([...curves].reverse()));
  expect(targets([circle("bad", 0, 0, NaN), line("badline", NaN, 0, 5, 0)])).toEqual([]);
  const dense = Array.from({ length: 65 }, (_, i) => line(String(i), -5, -5, 5, 5));
  expect(canvasCurveSnapTargets(dense, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual({ points: [], limited: true });
});
it("filters distant enclosing circle outlines and opposite arc sweeps before the pair-work limit", () => {
  const surrounding = Array.from({ length: 65 }, (_, i) => circle(`surrounding-${i}`, 0, 0, 100 + i));
  const nearby = [line("a", -5, 0, 5, 0), line("b", 0, -5, 0, 5)];
  const first = canvasCurveSnapTargets([...surrounding, ...nearby], { x: 0, y: 0 }, { x: 0.1, y: 0.5 });
  expect(first.limited).toBe(false);
  expect(first.points).toEqual([{ x: 0, y: 0, kind: "intersection", sourceId: "a:b" }]);
  const arcs = Array.from({ length: 65 }, (_, i) => ({ id: String(i), center: point(0, 0), radius: 5, start: point(5, 0), end: point(0, 5), startAngle: 0, sweep: Math.PI / 2 }));
  const second = canvasCurveSnapTargets([...arcs, line("x", -7, 0, -3, 0), line("y", -5, -2, -5, 2)], { x: -5, y: 0 }, { x: 0.1, y: 0.5 });
  expect(second.limited).toBe(false);
  expect(second.points).toEqual([{ x: -5, y: 0, kind: "intersection", sourceId: "x:y" }]);
});
it("uses relative angular tolerance for legitimate small perpendicular segments", () => {
  const a = line("a", 0, 0.005, 0.01, 0.005);
  const b = line("b", 0.005, 0, 0.005, 0.01);
  const result = canvasCurveSnapTargets([a, b], { x: 0.005, y: 0.005 }, { x: 0.001, y: 0.001 });
  expect(result.limited).toBe(false);
  expect(result.points).toHaveLength(1);
  expect(result.points[0]).toMatchObject({ kind: "intersection", sourceId: "a:b" });
  expect(result.points[0].x).toBeCloseTo(0.005, 12);
  expect(result.points[0].y).toBeCloseTo(0.005, 12);
  expect(canvasCurveSnapTargets([a, line("zero", 0.005, 0.005, 0.005, 0.005)], { x: 0.005, y: 0.005 }, { x: 0.001, y: 0.001 }).points).toEqual([]);
});
