import { expect, it } from "vitest";
import { offsetAuthoredContour, offsetContourArea, offsetCurvesTouch, type OffsetCurve } from "../cad/sketch/offsetContour";
import type { ProfileSegment } from "../cad/sketch/profileDetection";
const line = (start: [number, number], end: [number, number], id = "line"): ProfileSegment => ({ type: "line", id, start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] } });
const arc: OffsetCurve = { type: "arc", id: "arc", center: { x: 0, y: 0 }, radius: 5, start: { x: 5, y: 0 }, end: { x: -5, y: 0 }, startAngle: 0, sweep: Math.PI };
it("uses finite analytic arc spans for intersections and tangencies rather than chord approximations or supporting circles", () => {
  expect(offsetCurvesTouch(arc, line([-6, 4], [6, 4]))).toBe(true);
  expect(offsetCurvesTouch(arc, line([-6, -4], [6, -4]))).toBe(false);
  expect(offsetCurvesTouch(arc, line([-6, 5], [6, 5]))).toBe(true);
  expect(offsetCurvesTouch(arc, line([5, 0], [5, -2]), { x: 5, y: 0 })).toBe(false);
  expect(offsetCurvesTouch(arc, { type: "circle", id: "circle", center: { x: 0, y: 9 }, radius: 4 })).toBe(true);
  expect(offsetCurvesTouch(arc, { type: "circle", id: "circle", center: { x: 0, y: -9 }, radius: 4 })).toBe(false);
});
it("rejects crossings, collinear overlaps and overlapping arc spans while allowing one adjacent shared endpoint", () => {
  expect(offsetCurvesTouch(line([0, 0], [10, 0]), line([5, -5], [5, 5]))).toBe(true);
  expect(offsetCurvesTouch(line([0, 0], [10, 0]), line([5, 0], [15, 0]), { x: 10, y: 0 })).toBe(true);
  expect(offsetCurvesTouch(line([0, 0], [10, 0]), line([10, 0], [15, 0]), { x: 10, y: 0 })).toBe(false);
  expect(offsetCurvesTouch(arc, { ...arc, id: "other" }, { x: 5, y: 0 })).toBe(true);
  expect(offsetCurvesTouch(arc, { ...arc, id: "other", start: { x: -5, y: 0 }, end: { x: 5, y: 0 }, startAngle: Math.PI }, { x: -5, y: 0 })).toBe(true); // second shared endpoint closes a two-arc contour
});
it("rejects an outward concave channel closure without trimming or returning a reversed contour", () => {
  const vertices: [number, number][] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
  const segments = vertices.map((start, i) => line(start, vertices[(i + 1) % vertices.length], String(i)));
  expect(offsetContourArea(offsetAuthoredContour(segments, 1))).toBeGreaterThan(offsetContourArea(segments));
  expect(() => offsetAuthoredContour(segments, 2)).toThrow(/collapses|self-intersect/);
});

it("diagnoses empty contours and tolerant nearly collinear overlapping spans", () => {
  expect(offsetContourArea([])).toBe(0);
  expect(() => offsetAuthoredContour([], 1)).toThrow(/collapsed/);
  expect(offsetCurvesTouch(line([0, 0], [10, 0]), line([2, 0.000000002], [8, 0.000000003]))).toBe(true);
});
