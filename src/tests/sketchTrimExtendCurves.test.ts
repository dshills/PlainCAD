import { expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import type { Sketch } from "../cad/document/schema";
import { addArc, addCircleAt, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { buildSketchTrimExtend } from "../cad/sketch/trimExtend";
import { analyticTrimIntersections, trimCurveParameter } from "../cad/sketch/trimExtendIntersections";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject } from "../persistence/exportProject";

function line(sketch: Sketch, a: [number, number], b: [number, number]) {
  const start = addPoint(sketch, `${a[0]}mm`, `${a[1]}mm`), end = addPoint(start.sketch, `${b[0]}mm`, `${b[1]}mm`);
  return addLine(end.sketch, start.pointId, end.pointId);
}
function circle(sketch = createXySketch(), x = 0, y = 0, r = 10) {
  const next = addCircleAt(sketch, `${x}mm`, `${y}mm`, `${r}mm`);
  const id = Object.keys(next.entities).find((id) => !sketch.entities[id] && next.entities[id].type === "circle")!;
  return { sketch: next, id };
}
function arc(sketch: Sketch, startAngle: number, endAngle: number, clockwise = false) {
  const center = addPoint(sketch, "0mm", "0mm");
  const start = addPoint(center.sketch, `${(10 * Math.cos(startAngle)).toFixed(12)}mm`, `${(10 * Math.sin(startAngle)).toFixed(12)}mm`);
  const end = addPoint(start.sketch, `${(10 * Math.cos(endAngle)).toFixed(12)}mm`, `${(10 * Math.sin(endAngle)).toFixed(12)}mm`);
  return addArc(end.sketch, center.pointId, start.pointId, end.pointId, clockwise);
}
function edit(sketch: Sketch, id: string, mode: "trim" | "extend", x: number, y: number) {
  return buildSketchTrimExtend(upsertSketch(createEmptyDocument(), sketch), sketch.id, id, mode, { x, y });
}
it("converts a picked circle interval into an analytic closed semicircle, keeping curve/center IDs and durable geometry", () => {
  const target = circle(), diameter = line(target.sketch, [-10, 0], [10, 0]);
  const source = target.sketch.entities[target.id]; if (source.type !== "circle") throw new Error("Circle fixture");
  const plan = edit(diameter.sketch, target.id, "trim", 0, 10), next = plan.document.sketches[diameter.sketch.id];
  expect(next.entities[target.id]).toMatchObject({ id: target.id, type: "arc", centerPointId: source.centerPointId, clockwise: false });
  expect(next.entities[target.id]).not.toHaveProperty("radius");
  const solved = solveSketch(next, {}), retained = solved.arcs[0];
  expect(retained.radius).toBeCloseTo(10, 10); expect(retained.sweep).toBeCloseTo(Math.PI, 10);
  expect(retained.start).toMatchObject({ x: -10, y: 0 }); expect(retained.end).toMatchObject({ x: 10, y: 0 });
  expect(detectProfiles(solved).profiles).toHaveLength(1);
  expect(importProjectText(serializeProject(plan.document)).sketches[next.id]).toEqual(next);
  expect(target.sketch.entities[target.id].type).toBe("circle");
});
it("circle/circle intersections retain the complement across the angular seam", () => {
  const target = circle(), boundary = circle(target.sketch, 10, 0, 10);
  const next = edit(boundary.sketch, target.id, "trim", 10, 0).document.sketches[target.sketch.id];
  const result = solveSketch(next, {}).arcs[0];
  expect(result.id).toBe(target.id); expect(result.radius).toBeCloseTo(10, 10);
  expect(result.start.x).toBeCloseTo(5, 10); expect(result.start.y).toBeCloseTo(Math.sqrt(75), 10);
  expect(result.end.x).toBeCloseTo(5, 10); expect(result.end.y).toBeCloseTo(-Math.sqrt(75), 10);
  expect(result.sweep).toBeCloseTo(4 * Math.PI / 3, 10);
});
it("clockwise arc trim retains traversal, stable start ID and cleans the superseded end point", () => {
  const target = arc(createXySketch(), 0, Math.PI, true), boundary = line(target.sketch, [0, -15], [0, -5]);
  const source = target.sketch.entities[target.arcId]; if (source.type !== "arc") throw new Error("Arc fixture");
  const next = edit(boundary.sketch, target.arcId, "trim", -7, -7).document.sketches[target.sketch.id];
  expect(next.entities[source.endPointId]).toBeUndefined();
  expect(next.entities[target.arcId]).toMatchObject({ startPointId: source.startPointId, clockwise: true });
  const retained = solveSketch(next, {}).arcs[0];
  expect(retained.sweep).toBeCloseTo(-Math.PI / 2, 10); expect(retained.end.x).toBeCloseTo(0, 10); expect(retained.end.y).toBeCloseTo(-10, 10);
});
it.each([false, true])("extends an arc end to the nearest finite boundary preserving signed sweep (clockwise=%s)", (clockwise) => {
  const sign = clockwise ? -1 : 1, target = arc(createXySketch(), 0, sign * Math.PI / 4, clockwise);
  const boundary = line(target.sketch, [0, sign * 9], [0, sign * 11]);
  const next = edit(boundary.sketch, target.arcId, "extend", 7, sign * 7).document.sketches[target.sketch.id];
  const retained = solveSketch(next, {}).arcs[0];
  expect(retained.radius).toBeCloseTo(10, 10); expect(retained.sweep).toBeCloseTo(sign * Math.PI / 2, 10);
  expect(retained.end.x).toBeCloseTo(0, 10); expect(retained.end.y).toBeCloseTo(sign * 10, 10);
});
it("extends an arc start backwards along its own support before a full turn", () => {
  const target = arc(createXySketch(), Math.PI / 4, Math.PI / 2), boundary = line(target.sketch, [9, 0], [11, 0]);
  const retained = solveSketch(edit(boundary.sketch, target.arcId, "extend", 7, 7).document.sketches[target.sketch.id], {}).arcs[0];
  expect(retained.start.x).toBeCloseTo(10, 10); expect(retained.start.y).toBeCloseTo(0, 10); expect(retained.sweep).toBeCloseTo(Math.PI / 2, 10);
});
it("uses finite arc/circle boundaries, never their missing arc segment or infinite line", () => {
  const target = line(createXySketch(), [-20, 0], [-15, 0]), boundary = arc(target.sketch, 0, Math.PI / 2);
  const retained = solveSketch(edit(boundary.sketch, target.lineId, "extend", -15, 0).document.sketches[target.sketch.id], {}).lines[0];
  expect(retained.end.x).toBeCloseTo(10, 10); // -10 belongs only to the infinite circle support.
  const round = circle(target.sketch);
  expect(solveSketch(edit(round.sketch, target.lineId, "extend", -15, 0).document.sketches[target.sketch.id], {}).lines[0].end.x).toBeCloseTo(-10, 10);
  const finite = line(boundary.sketch, [0, 20], [0, 30]);
  const solved = solveSketch(finite.sketch, {});
  expect(analyticTrimIntersections(solved.arcs[0], solved.lines[1], true)).toEqual([]);
});
it("filters both finite arcs in analytic arc/arc contacts", () => {
  const first = arc(createXySketch(), 0, Math.PI / 2), secondCircle = circle(first.sketch, 10, 0, 10);
  const solved = solveSketch(secondCircle.sketch, {});
  const circleBoundary = solved.circles[0], upper = solved.arcs[0];
  expect(analyticTrimIntersections(upper, circleBoundary, false)).toHaveLength(1);
  const lowerBoundary = { ...circleBoundary, startAngle: Math.PI, sweep: Math.PI, start: { id: "bs", x: 0, y: 0 }, end: { id: "be", x: 20, y: 0 } };
  expect(analyticTrimIntersections(upper, lowerBoundary, false)).toEqual([]);
});
it("diagnoses tangent, near-tangent, coincident, centered and endpoint-less circular edits", () => {
  const target = circle();
  for (const y of [10, 10 - 1e-10]) {
    const tangent = line(target.sketch, [-20, y], [20, y]);
    expect(() => edit(tangent.sketch, target.id, "trim", 0, -10)).toThrow("tangentially");
  }
  const tangentCircle = circle(target.sketch, 20, 0, 10);
  expect(() => edit(tangentCircle.sketch, target.id, "trim", 0, 10)).toThrow("tangentially");
  const coincident = circle(target.sketch);
  expect(() => edit(coincident.sketch, target.id, "trim", 0, 10)).toThrow("coincident");
  expect(() => edit(target.sketch, target.id, "trim", 0, 0)).toThrow("center");
  expect(() => edit(target.sketch, target.id, "extend", 0, 10)).toThrow("no endpoints");
});
it("protects circular radius parameters and downstream profile intent rather than rebinding silently", () => {
  const target = circle(), diameter = line(target.sketch, [-10, 0], [10, 0]);
  const source = target.sketch.entities[target.id]; if (source.type !== "circle") throw new Error("Circle fixture");
  const bound = { ...diameter.sketch, entities: { ...diameter.sketch.entities, [source.id]: { ...source, radius: { expression: "radius", unit: "mm" } } } };
  expect(() => edit(bound, target.id, "trim", 0, 10)).toThrow("parameter-bound radius");
  const construction = { ...diameter.sketch, entities: { ...diameter.sketch.entities, [diameter.lineId]: { ...diameter.sketch.entities[diameter.lineId], construction: true } } };
  const profile = detectProfiles(solveSketch(construction, {})).profiles[0];
  const doc = upsertFeature(upsertSketch(createEmptyDocument(), construction), createExtrudeFeature({ sketchId: construction.id, profileId: profile.id, name: "Circle intent", distance: { expression: "4mm", unit: "mm" }, operation: "newBody", direction: "positive" }));
  expect(() => buildSketchTrimExtend(doc, construction.id, target.id, "trim", { x: 0, y: 10 })).toThrow("Circle intent would lose profile");
});
it("splits an interior arc interval into two analytic fragments with retained end IDs", () => {
  const target = arc(createXySketch(), 0, Math.PI), first = line(target.sketch, [5, 0], [5, 15]), second = line(first.sketch, [-5, 0], [-5, 15]);
  const source = target.sketch.entities[target.arcId]; if (source.type !== "arc") throw new Error("Arc fixture");
  const next = edit(second.sketch, target.arcId, "trim", 0, 10).document.sketches[target.sketch.id], retained = solveSketch(next, {}).arcs;
  expect(retained).toHaveLength(2);
  const firstFragment = retained.find((fragment) => fragment.id === target.arcId)!, secondFragment = retained.find((fragment) => fragment.id !== target.arcId)!;
  expect(firstFragment).toBeDefined();
  expect(next.entities[firstFragment.id]).toMatchObject({ startPointId: source.startPointId });
  expect(next.entities[secondFragment.id]).toMatchObject({ endPointId: source.endPointId });
  retained.forEach((fragment) => { expect(fragment.radius).toBeCloseTo(10, 10); expect(fragment.sweep).toBeCloseTo(Math.PI / 3, 10); });
});
it("extends an arc to a circle contact and retains circle construction state through conversion", () => {
  const target = arc(createXySketch(), 0, Math.PI / 4), boundary = circle(target.sketch, 10, 0, 10);
  const retained = solveSketch(edit(boundary.sketch, target.arcId, "extend", 7, 7).document.sketches[target.sketch.id], {}).arcs[0];
  expect(retained.sweep).toBeCloseTo(Math.PI / 3, 10); expect(retained.radius).toBeCloseTo(10, 10);
  const round = circle(), diameter = line(round.sketch, [-10, 0], [10, 0]);
  const construction = { ...diameter.sketch, entities: { ...diameter.sketch.entities, [round.id]: { ...diameter.sketch.entities[round.id], construction: true } } };
  expect(edit(construction, round.id, "trim", 0, 10).document.sketches[round.sketch.id].entities[round.id]).toMatchObject({ type: "arc", construction: true });
});
it("diagnoses nearly collinear overlapping segments rather than using an arbitrary intersection", () => {
  const target = line(createXySketch(), [0, 0], [30, 0]);
  // Tiny nonzero determinant used to bypass overlap diagnosis and select x=15.
  const boundary = line(target.sketch, [10, 1e-10], [20, -1e-10]);
  const resolvedTarget = { id: target.lineId, start: { id: "a", x: 0, y: 0 }, end: { id: "b", x: 30, y: 0 } };
  const resolvedBoundary = { id: boundary.lineId, start: { id: "c", x: 10, y: 1e-10 }, end: { id: "d", x: 20, y: -1e-10 } };
  expect(() => analyticTrimIntersections(resolvedTarget, resolvedBoundary, false)).toThrow("overlaps or is collinear");
});
it("does not count duplicate finite boundary contacts on opposite sides of the angular seam twice", () => {
  const target = circle();
  const a = line(target.sketch, [10, -1], [10, 0]), b = line(a.sketch, [10, 0], [10, 1]);
  // Tangencies remain explicit diagnostics rather than pretending one seam contact bounds a segment.
  expect(() => edit(b.sketch, target.id, "trim", -10, 0)).toThrow("tangentially");
  const round = solveSketch(target.sketch, {}).circles[0];
  // The parameter normalizer snaps near-2π contacts to the same start parameter.
  const nearStart = { x: 10, y: -1e-9 };
  expect(trimCurveParameter(round, nearStart)).toBe(0);
  expect(analyticTrimIntersections(round, { id: "cross", start: { id: "a", x: 9, y: -1e-9 }, end: { id: "b", x: 11, y: -1e-9 } }, false)).toHaveLength(1);
});
it("allows repeated trims on disjoint sibling arcs while rejecting finite circular overlap", () => {
  const target = arc(createXySketch(), 0, Math.PI), first = line(target.sketch, [5, 0], [5, 15]), second = line(first.sketch, [-5, 0], [-5, 15]);
  const fragmented = edit(second.sketch, target.arcId, "trim", 0, 10).document.sketches[target.sketch.id];
  const boundary = line(fragmented, [8, 0], [8, 15]);
  const next = edit(boundary.sketch, target.arcId, "trim", 9.5, 3).document.sketches[target.sketch.id];
  const retained = solveSketch(next, {}).arcs.find((curve) => curve.id === target.arcId)!;
  expect(retained.start.x).toBeCloseTo(8, 10); expect(retained.radius).toBeCloseTo(10, 10);
  const overlapping = arc(target.sketch, Math.PI / 4, 3 * Math.PI / 4);
  expect(() => edit(overlapping.sketch, target.arcId, "trim", 0, 10)).toThrow("overlap on a coincident");
});
it("extends to the first finite endpoint of a disjoint arc on the same support", () => {
  const target = arc(createXySketch(), 0, Math.PI / 4), sibling = arc(target.sketch, Math.PI / 2, Math.PI);
  const next = edit(sibling.sketch, target.arcId, "extend", 7, 7).document.sketches[target.sketch.id];
  const retained = solveSketch(next, {}).arcs.find((curve) => curve.id === target.arcId)!;
  expect(retained.sweep).toBeCloseTo(Math.PI / 2, 10);
  const boundary = sibling.sketch.entities[sibling.arcId]; if (boundary.type !== "arc") throw new Error("Arc fixture");
  expect(next.entities[target.arcId]).toMatchObject({ endPointId: boundary.startPointId });
});
it("ignores disjoint collinear lines behind or beyond a chosen extension but prevents new overlap", () => {
  const target = line(createXySketch(), [0, 0], [5, 0]), behind = line(target.sketch, [-20, 0], [-10, 0]), beyond = line(behind.sketch, [30, 0], [40, 0]), crossing = line(beyond.sketch, [20, -5], [20, 5]);
  const retained = solveSketch(edit(crossing.sketch, target.lineId, "extend", 4, 0).document.sketches[target.sketch.id], {}).lines.find((curve) => curve.id === target.lineId)!;
  expect(retained.end.x).toBeCloseTo(20, 10);
  const blocked = line(crossing.sketch, [10, 0], [15, 0]);
  expect(() => edit(blocked.sketch, target.lineId, "extend", 4, 0)).toThrow("overlaps or is collinear");
});
