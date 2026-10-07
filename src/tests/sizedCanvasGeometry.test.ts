import { beforeEach, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCircle, addConstraint, addLine, addPoint, createXySketch, setConstruction } from "../cad/sketch/SketchModel";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { deleteSketchEntities } from "../cad/sketch/entityDeletion";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import {
  addSizedCanvasGeometry,
  sizedCanvasPoints,
} from "../cad/sketch/sizedCanvasGeometry";
import { normalizeQuantity } from "../cad/parameters/units";
import { useCadStore } from "../state/useCadStore";
import { runCommand } from "../ui/commands/commandRegistry";
import {
  commitCanvasGeometry,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";

beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
it("sizes a rectangle in the pointer quadrant using authored units and preserves orthogonal intent on parameter edits", () => {
  const sketch = createXySketch();
  const result = addSizedCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "rectangle",
    [
      { x: 10, y: 20 },
      { x: 4, y: 13 },
    ],
    false,
    false,
    { width: "width", height: "0.5" },
    { width: normalizeQuantity(1, "in") },
    "in",
  ).sketch;
  expect(result.constraints.map((c) => c.type)).toEqual([
    "horizontal",
    "vertical",
    "horizontal",
    "vertical",
  ]);
  expect(result.dimensions.map((d) => d.expression.authoredUnit)).toEqual([
    "in",
    "in",
  ]);
  for (const width of [25.4, 38.1]) {
    const solved = solveSketch(result, {
      width: normalizeQuantity(width, "mm"),
    });
    expect(solved.errors).toEqual([]);
    const profile = detectProfiles(solved).profiles[0];
    expect(profile.bounds.maxX - profile.bounds.minX).toBeCloseTo(width, 6);
    expect(profile.bounds.maxY - profile.bounds.minY).toBeCloseTo(12.7, 6);
    expect(profile.outerLoop.segments).toHaveLength(4);
    result.constraints.forEach((c) => {
      const l = solved.lines.find((line) => line.id === c.entityIds[0])!;
      expect(
        c.type === "vertical" ? l.end.x - l.start.x : l.end.y - l.start.y,
      ).toBeCloseTo(0, 6);
    });
  }
  const initial = solveSketch(result, { width: normalizeQuantity(1, "in") });
  expect(detectProfiles(initial).profiles[0].bounds.minX).toBeCloseTo(-15.4, 6);
});
it("sizes analytic circles and construction circles without creating a solid profile", () => {
  const sketch = createXySketch();
  for (const construction of [false, true]) {
    const next = addSizedCanvasGeometry(
      sketch,
      solveSketch(sketch, {}),
      "circle",
      [
        { x: 4, y: 8 },
        { x: 4, y: 8 },
      ],
      construction,
      false,
      { diameter: "12mm" },
      {},
      "in",
    ).sketch;
    const solved = solveSketch(next, {});
    expect(solved.errors).toEqual([]);
    expect(solved.circles[0]).toMatchObject({
      radius: 6,
      center: { x: 4, y: 8 },
      construction,
    });
    expect(detectProfiles(solved).profiles).toHaveLength(construction ? 0 : 1);
    expect(next.dimensions[0].type).toBe("diameter");
  }
});
it.each(["0", "-2mm", "90deg", "unknown", "1 / 0", "100000001mm"])(
  "rejects an invalid draft size %s without changing history",
  async (width) => {
    await runCommand("sketch.createXY");
    await runCommand("sketch.editCanvas");
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history;
    expect(() =>
      commitCanvasGeometry(
        active,
        before.present,
        "rectangle",
        [
          { x: 0, y: 0 },
          { x: 5, y: 3 },
        ],
        false,
        false,
        { width, height: "3mm" },
      ),
    ).toThrow(/Width/);
    expect(useCadStore.getState().history).toBe(before);
  },
);
it("does not reuse a snapped endpoint when the precise size changes its position", () => {
  const base = createXySketch();
  const sketch = addCanvasGeometry(base, solveSketch(base, {}), "point", [
    { x: 10, y: 10 },
  ]).sketch;
  const id = Object.keys(sketch.entities)[0];
  const points = sizedCanvasPoints(
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 10, y: 10, pointId: id },
    ],
    { width: "20mm", height: "15mm" },
    {},
    "mm",
  );
  expect(points[1]).toEqual({ x: 20, y: 15 });
  const next = addSizedCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 10, y: 10, pointId: id },
    ],
    false,
    false,
    { width: "20mm", height: "15mm" },
    {},
    "mm",
  ).sketch;
  expect(solveSketch(next, {}).points[id]).toMatchObject({ x: 10, y: 10 });
});
it("commits sized geometry and dimensions together and preserves their IDs and units through undo/redo and save/open", async () => {
  const sketch = createXySketch();
  const document = {
    ...upsertSketch(createEmptyDocument(), sketch),
    unitSettings: { length: "in", angle: "deg" } as const,
  };
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  await runCommand("sketch.editCanvas");
  const active = useSketchCanvas.getState().active!,
    before = useCadStore.getState().history;
  commitCanvasGeometry(
    active,
    before.present,
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ],
    false,
    false,
    { width: "1", height: "0.5" },
  );
  const after = useCadStore.getState().history;
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.present.sketches[sketch.id].dimensions).toHaveLength(2);
  expect(
    importProjectText(serializeProject(after.present)).sketches[sketch.id],
  ).toEqual(after.present.sketches[sketch.id]);
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(before.present);
  useCadStore.getState().redo();
  expect(useCadStore.getState().history.present).toBe(after.present);
});


it.each([[18, 25], [2, 5]])("creates center rectangles with full sizes in either pointer quadrant (%s, %s)", (x, y) => {
  const sketch = createXySketch();
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 15 }, { x, y }], false, false,
    { rectangleMode: "center", width: "30mm", height: "20mm" }, {}, "mm").sketch;
  const solved = solveSketch(next, {});
  expect(solved.errors).toEqual([]);
  const profile = detectProfiles(solved).profiles[0];
  expect(profile.bounds).toMatchObject({ minX: -5, maxX: 25, minY: 5, maxY: 25 });
  expect(next.dimensions).toHaveLength(2);
  const document = upsertSketch(createEmptyDocument(), next);
  expect(importProjectText(serializeProject(document)).sketches[next.id]).toEqual(document.sketches[next.id]);
});
it("mirrors a center gesture without reusing its center as a rectangle corner", () => {
  expect(sizedCanvasPoints("rectangle", [{ x: 10, y: 5, pointId: "center" }, { x: 18, y: 9, pointId: "corner" }],
    { rectangleMode: "center" }, {}, "mm")).toEqual([{ x: 2, y: 1 }, { x: 18, y: 9, pointId: "corner" }]);
});

it.each(["0mm", "-1mm"])("rejects invalid center-mode width %s before creating geometry", (width) => {
  expect(() => sizedCanvasPoints("rectangle", [{ x: 10, y: 5 }, { x: 12, y: 7 }],
    { rectangleMode: "center", width, height: "10mm" }, {}, "mm")).toThrow(/Width must be positive/);
});
it("uses the full parameter-driven width for center-mode driving intent", () => {
  const sketch = createXySketch();
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [{ x: 10, y: 5 }, { x: 12, y: 7 }],
    false, false, { rectangleMode: "center", width: "width", height: "10mm" },
    { width: normalizeQuantity(30, "mm") }, "mm").sketch;
  expect(next.dimensions[0].expression.expression).toBe("width");
  expect(detectProfiles(solveSketch(next, { width: normalizeQuantity(30, "mm") })).profiles[0].bounds).toMatchObject({ minX: -5, maxX: 25 });
  const edited = detectProfiles(solveSketch(next, { width: normalizeQuantity(40, "mm") })).profiles[0];
  expect(edited.bounds.maxX - edited.bounds.minX).toBeCloseTo(40, 6);
});


it.each([[18, 25], [2, 5]])("keeps the center through width/height parameter edits, a previous solve seed, and save/open (%s, %s)", (x, y) => {
  const sketch = createXySketch();
  const initial = { width: normalizeQuantity(30, "mm"), height: normalizeQuantity(20, "mm") };
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 15 }, { x, y }], false, false,
    { rectangleMode: "center", width: "width", height: "height" }, initial, "mm").sketch;
  const seed = solveSketch(next, initial);
  const edited = solveSketch(next, { width: normalizeQuantity(40, "mm"), height: normalizeQuantity(10, "mm") }, { seed });
  expect(edited.errors).toEqual([]);
  expect(edited.degreesOfFreedom).toBe(0);
  const bounds = detectProfiles(edited).profiles[0].bounds;
  expect(bounds.minX).toBeCloseTo(-10, 6);
  expect(bounds.maxX).toBeCloseTo(30, 6);
  expect(bounds.minY).toBeCloseTo(10, 6);
  expect(bounds.maxY).toBeCloseTo(20, 6);
  expect(edited.lines.filter((line) => line.construction)).toHaveLength(1);
  const document = upsertSketch(createEmptyDocument(), next);
  const reopened = importProjectText(serializeProject(document)).sketches[next.id];
  expect(reopened).toEqual(document.sketches[next.id]);
  const reopenedBounds = detectProfiles(solveSketch(reopened, { width: normalizeQuantity(40, "mm"), height: normalizeQuantity(10, "mm") })).profiles[0].bounds;
  for (const key of ["minX", "maxX", "minY", "maxY"] as const) expect(reopenedBounds[key]).toBeCloseTo(bounds[key], 6);
});

it("retains unsized center intent when a reference edge receives a driving dimension", () => {
  const sketch = createXySketch();
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false, { rectangleMode: "center" }, {}, "mm").sketch;
  const edge = next.entities[next.constraints.find((c) => c.type === "horizontal")!.entityIds[0]];
  const dimensioned = withCanvasDimension(next, { type: "length", refs: [edge.id], expression: "30mm", authoredUnit: "mm" });
  const solved = solveSketch(dimensioned, {});
  expect(solved.errors).toEqual([]);
  const bounds = detectProfiles(solved).profiles[0].bounds;
  expect(bounds.minX).toBeCloseTo(-5, 6);
  expect(bounds.maxX).toBeCloseTo(25, 6);
  expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(5, 6);
});

it("snapped center follows the existing point expressions and preserves unrelated geometry", () => {
  const center = addPoint(createXySketch(), "centerX", "centerY");
  const sketch = addCircle(center.sketch, center.pointId, "2mm").sketch;
  const initial = { centerX: normalizeQuantity(10, "mm"), centerY: normalizeQuantity(5, "mm") };
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, initial), "rectangle",
    [{ x: 10, y: 5, pointId: center.pointId }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, initial, "mm").sketch;
  const solved = solveSketch(next, { centerX: normalizeQuantity(20, "mm"), centerY: normalizeQuantity(-5, "mm") });
  expect(solved.errors).toEqual([]);
  expect(solved.circles[0].center.x).toBeCloseTo(20, 6);
  const rectangle = detectProfiles(solved).profiles.find((profile) => profile.outerLoop.segments?.length === 4)!;
  expect(rectangle.bounds.minX).toBeCloseTo(5, 6);
  expect(rectangle.bounds.maxX).toBeCloseTo(35, 6);
  expect(rectangle.bounds.minY).toBeCloseTo(-10, 6);
  expect(rectangle.bounds.maxY).toBeCloseTo(0, 6);
  expect(next.entities[center.pointId]).toBe(sketch.entities[center.pointId]);
  const outerEdges = Object.values(next.entities).filter((e) => e.type === "line" && !e.construction).map((e) => e.id);
  const deleted = deleteSketchEntities(next, outerEdges, { features: [] });
  expect(deleted.entities).toEqual(sketch.entities);
  expect(deleted.constraints).toEqual(sketch.constraints);
  expect(solveSketch(deleted, initial).errors).toEqual([]);
});

it("deleting center-rectangle outline removes its construction support and points without leftover dots", () => {
  const sketch = createXySketch();
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm").sketch;
  const outerEdges = Object.values(next.entities).filter((e) => e.type === "line" && !e.construction).map((e) => e.id);
  const deleted = deleteSketchEntities(next, outerEdges, { features: [] });
  expect(deleted.entities).toEqual({});
  expect(deleted.constraints).toEqual([]);
  expect(deleted.dimensions).toEqual([]);
  const allCurves = Object.values(next.entities).filter((e) => e.type === "line").map((e) => e.id);
  expect(deleteSketchEntities(next, allCurves, { features: [] }).entities).toEqual({});
});

it("commits center constraints, dimensions, and geometry in one undoable durable edit", async () => {
  const sketch = createXySketch();
  const document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.getState().setDocument(document);
  useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
  await runCommand("sketch.editCanvas");
  const before = useCadStore.getState().history;
  commitCanvasGeometry(useSketchCanvas.getState().active!, before.present, "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" });
  const after = useCadStore.getState().history;
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.present.sketches[sketch.id].constraints.some((c) => c.type === "midpoint")).toBe(true);
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(before.present);
  useCadStore.getState().redo();
  expect(useCadStore.getState().history.present).toBe(after.present);
  expect(importProjectText(serializeProject(after.present))).toEqual(after.present);
});


it("does not duplicate a pre-existing fixed center constraint and rejects a stale snapped center", () => {
  const point = addPoint(createXySketch(), "10mm", "5mm");
  const sketch = { ...point.sketch, constraints: [{ id: "existing-fixed", type: "fixed" as const, entityIds: [], pointIds: [point.pointId] }] };
  const solved = solveSketch(sketch, {});
  const next = addSizedCanvasGeometry(sketch, solved, "rectangle",
    [{ x: 10, y: 5, pointId: point.pointId }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm").sketch;
  expect(next.constraints.filter((c) => c.type === "fixed")).toEqual(sketch.constraints);
  expect(solveSketch(next, {}).errors).toEqual([]);
  expect(() => addSizedCanvasGeometry(sketch, solved, "rectangle",
    [{ x: 11, y: 5, pointId: point.pointId }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm")).toThrow(/Snapped center changed/);
});

it("retains unrelated construction intent and externally used center points during outline deletion", () => {
  const sketch = createXySketch();
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm").sketch;
  const midpoint = next.constraints.find((c) => c.type === "midpoint")!;
  const centerId = midpoint.pointIds![0];
  const edges = Object.values(next.entities).filter((e) => e.type === "line" && !e.construction).map((e) => e.id);
  const related = withCanvasDimension(next, { type: "length", refs: midpoint.entityIds, expression: `${Math.hypot(30, 10)}mm`, authoredUnit: "mm" });
  const retained = deleteSketchEntities(related, edges, { features: [] });
  expect(retained.entities[midpoint.entityIds[0]]).toBe(next.entities[midpoint.entityIds[0]]);
  expect(retained.entities[centerId]).toBe(next.entities[centerId]);
  expect(retained.dimensions).toHaveLength(1);
  expect(solveSketch(retained, {}).errors).toEqual([]);
  const circle = addCircle(next, centerId, "2mm").sketch;
  const shared = deleteSketchEntities(circle, edges, { features: [] });
  expect(shared.entities[centerId]).toBe(next.entities[centerId]);
  expect(solveSketch(shared, {}).circles[0].center).toMatchObject({ x: 10, y: 5 });
});

it("adds unsized center intent to legacy validation sketches through the driving solver", () => {
  const sketch = { ...createXySketch(), solveMode: "validate" as const };
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false, { rectangleMode: "center" }, {}, "mm").sketch;
  expect(next.solveMode).toBe("driving");
  expect(solveSketch(next, {}).errors).toEqual([]);
});


it("preserves a borrowed standalone construction center after outline deletion", () => {
  const point = addPoint(createXySketch(), "10mm", "5mm");
  const sketch = setConstruction(point.sketch, point.pointId, true);
  const next = addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 5, pointId: point.pointId }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm").sketch;
  const edges = Object.values(next.entities).filter((e) => e.type === "line" && !e.construction).map((e) => e.id);
  const deleted = deleteSketchEntities(next, edges, { features: [] });
  expect(deleted.entities).toEqual(sketch.entities);
  expect(deleted.constraints).toEqual([]);
});


it("rejects center creation in nonempty legacy validation sketches without reinterpreting old dimensions", () => {
  const point = addPoint({ ...createXySketch(), solveMode: "validate" as const }, "0mm", "0mm");
  const sketch = point.sketch;
  expect(() => addSizedCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm")).toThrow(/legacy sketch/);
  expect(sketch.solveMode).toBe("validate");
  expect(Object.keys(sketch.entities)).toEqual([point.pointId]);
});


it("cleans a generated center after the last rectangle sharing that support is deleted", () => {
  const empty = createXySketch();
  const first = addSizedCanvasGeometry(empty, solveSketch(empty, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm").sketch;
  const centerId = first.constraints.find((c) => c.type === "midpoint")!.pointIds![0];
  const both = addSizedCanvasGeometry(first, solveSketch(first, {}), "rectangle",
    [{ x: 10, y: 5, pointId: centerId }, { x: 20, y: 15 }], false, false,
    { rectangleMode: "center", width: "40mm", height: "20mm" }, {}, "mm").sketch;
  const firstEdges = Object.values(first.entities).filter((e) => e.type === "line" && !e.construction).map((e) => e.id);
  const secondEdges = Object.values(both.entities).filter((e) => e.type === "line" && !e.construction && !first.entities[e.id]).map((e) => e.id);
  const one = deleteSketchEntities(both, firstEdges, { features: [] });
  expect(one.entities[centerId]).toBe(first.entities[centerId]);
  expect(solveSketch(one, {}).errors).toEqual([]);
  const none = deleteSketchEntities(one, secondEdges, { features: [] });
  expect(none.entities).toEqual({});
  expect(none.constraints).toEqual([]);
});


it("never auto-removes a user-authored construction diagonal and midpoint intent", () => {
  const empty = createXySketch();
  const rectangle = addSizedCanvasGeometry(empty, solveSketch(empty, {}), "rectangle",
    [{ x: 0, y: 0 }, { x: 30, y: 10 }], false, false,
    { width: "30mm", height: "10mm" }, {}, "mm").sketch;
  const corners = Object.values(solveSketch(rectangle, {}).points);
  const opposite = corners.find((point) => Math.abs(point.x - 30) < 1e-6 && Math.abs(point.y - 10) < 1e-6);
  const start = corners.find((point) => Math.abs(point.x) < 1e-6 && Math.abs(point.y) < 1e-6);
  if (!opposite || !start) throw new Error("Rectangle fixture corners unavailable.");
  const diagonal = addLine(rectangle, start.id, opposite.id);
  const center = addPoint(setConstruction(diagonal.sketch, diagonal.lineId, true), "15mm", "5mm");
  const sketch = addConstraint(center.sketch, "midpoint", { entityIds: [diagonal.lineId], pointIds: [center.pointId] });
  const edges = Object.values(rectangle.entities).filter((e) => e.type === "line").map((e) => e.id);
  const deleted = deleteSketchEntities(sketch, edges, { features: [] });
  expect(deleted.entities[diagonal.lineId]).toBe(sketch.entities[diagonal.lineId]);
  expect(deleted.entities[center.pointId]).toBe(sketch.entities[center.pointId]);
  expect(deleted.constraints).toEqual([sketch.constraints.at(-1)]);
  expect(solveSketch(deleted, {}).errors).toEqual([]);
});

it("preserves a multi-point fixed user relation and both points when deleting a center rectangle", () => {
  const empty = createXySketch();
  const rectangle = addSizedCanvasGeometry(empty, solveSketch(empty, {}), "rectangle",
    [{ x: 10, y: 5 }, { x: 15, y: 8 }], false, false,
    { rectangleMode: "center", width: "30mm", height: "10mm" }, {}, "mm").sketch;
  const centerId = rectangle.constraints.find((c) => c.type === "midpoint")!.pointIds![0];
  const unrelated = addPoint(rectangle, "99mm", "55mm");
  const sketch = addConstraint({ ...unrelated.sketch,
    constraints: unrelated.sketch.constraints.filter((c) => c.type !== "fixed"),
  }, "fixed", { pointIds: [centerId, unrelated.pointId] });
  const sharedFixed = sketch.constraints.at(-1)!;
  expect(solveSketch(sketch, {}).errors).toEqual([]);
  const outlineIds = Object.values(rectangle.entities).filter((e) => e.type === "line" && !e.construction).map((e) => e.id);
  const deleted = deleteSketchEntities(sketch, outlineIds, { features: [] });
  expect(Object.keys(deleted.entities).sort()).toEqual([centerId, unrelated.pointId].sort());
  expect(deleted.entities[centerId]).toBe(sketch.entities[centerId]);
  expect(deleted.entities[unrelated.pointId]).toBe(sketch.entities[unrelated.pointId]);
  expect(deleted.constraints).toEqual([sharedFixed]);
  expect(deleted.constraints[0]).toBe(sharedFixed);
  expect(deleted.dimensions).toEqual([]);
  const solved = solveSketch(deleted, {});
  expect(solved.errors).toEqual([]);
  expect(solved.degreesOfFreedom).toBe(0);
  expect(solved.points[centerId]).toMatchObject({ x: 10, y: 5 });
  expect(solved.points[unrelated.pointId]).toMatchObject({ x: 99, y: 55 });
  const document = upsertSketch(createEmptyDocument(), deleted);
  expect(importProjectText(serializeProject(document)).sketches[deleted.id]).toEqual(document.sketches[deleted.id]);
});
