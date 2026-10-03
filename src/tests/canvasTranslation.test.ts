import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import {
  canvasTranslationGroup,
  translatedCanvasGroup,
  validateCanvasTranslation,
} from "../cad/sketch/canvasTranslation";
import {
  addConstraint,
  addLine,
  addPoint,
  createXySketch,
} from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { normalizeQuantity } from "../cad/parameters/units";
import { useCadStore } from "../state/useCadStore";
import {
  beginSketchCanvas,
  commitCanvasTranslation,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";

function fixture() {
  const empty = createXySketch();
  let sketch = addCanvasGeometry(empty, solveSketch(empty, {}), "rectangle", [
    { x: 0, y: 0 },
    { x: 40, y: 30 },
  ]).sketch;
  const lines = Object.values(sketch.entities).filter((e) => e.type === "line");
  sketch = addConstraint(sketch, "horizontal", { entityIds: [lines[0].id] });
  sketch = addConstraint(sketch, "vertical", { entityIds: [lines[1].id] });
  sketch = withCanvasDimension(sketch, {
    type: "length",
    refs: [lines[0].id],
    expression: "span",
  });
  return {
    sketch,
    pointId: lines[0].startPointId,
    parameters: { span: normalizeQuantity(40, "mm") },
  };
}
beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
describe("guarded connected-group translation", () => {
  it("translates constrained, dimension-driven geometry rigidly without rewriting intent or other entities", () => {
    const { sketch: base, pointId, parameters } = fixture();
    const circle = addCanvasGeometry(
      base,
      solveSketch(base, parameters),
      "circle",
      [
        { x: 100, y: 100 },
        { x: 105, y: 100 },
      ],
    ).sketch;
    const solved = solveSketch(circle, parameters),
      before = detectProfiles(solved);
    expect(solved.errors).toEqual([]);
    const moved = translatedCanvasGroup(circle, solved, pointId, {
        x: 12,
        y: 18,
      }),
      after = solveSketch(moved.sketch, parameters);
    expect(
      canvasTranslationGroup(circle, solved, pointId).pointIds,
    ).toHaveLength(4);
    expect(() =>
      validateCanvasTranslation(solved, after, moved.targets),
    ).not.toThrow();
    expect(after.points[pointId]).toMatchObject({ x: 12, y: 18 });
    expect(moved.sketch.constraints).toBe(circle.constraints);
    expect(moved.sketch.dimensions).toBe(circle.dimensions);
    expect(Object.keys(moved.sketch.entities)).toEqual(
      Object.keys(circle.entities),
    );
    for (const [id, e] of Object.entries(circle.entities))
      if (!moved.targets.has(id)) expect(moved.sketch.entities[id]).toBe(e);
    expect(detectProfiles(after).profiles.map((p) => p.id)).toEqual(
      before.profiles.map((p) => p.id),
    );
    expect(after.circles).toEqual(solved.circles);
  });
  it("includes related construction geometry, dimensions and T-junction divider endpoints", () => {
    const { sketch: base, pointId, parameters } = fixture();
    let sketch = addCanvasGeometry(
      base,
      solveSketch(base, parameters),
      "line",
      [
        { x: 10, y: 0 },
        { x: 10, y: 30 },
      ],
    ).sketch;
    sketch = addCanvasGeometry(
      sketch,
      solveSketch(sketch, parameters),
      "line",
      [
        { x: 100, y: 0 },
        { x: 100, y: 30 },
      ],
      true,
    ).sketch;
    let solved = solveSketch(sketch, parameters);
    expect(
      canvasTranslationGroup(sketch, solved, pointId).pointIds,
    ).toHaveLength(6);
    const axis = solved.lines.find((l) => l.construction)!;
    sketch = withCanvasDimension(sketch, {
      type: "distance",
      refs: [pointId, axis.start.id],
      expression: "100mm",
    });
    solved = solveSketch(sketch, parameters);
    expect(solved.errors).toEqual([]);
    expect(
      canvasTranslationGroup(sketch, solved, pointId).pointIds,
    ).toHaveLength(8);
  });
  it("translates a closed analytic arc profile with unchanged radius, sweep, lineage and dimensions", () => {
    const empty = createXySketch();
    let sketch = addCanvasGeometry(empty, solveSketch(empty, {}), "arc", [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: -10, y: 0 },
    ]).sketch;
    let solved = solveSketch(sketch, {});
    sketch = addCanvasGeometry(sketch, solved, "line", [
      { ...solved.arcs[0].end, pointId: solved.arcs[0].end.id },
      { ...solved.arcs[0].start, pointId: solved.arcs[0].start.id },
    ]).sketch;
    sketch = withCanvasDimension(sketch, {
      type: "radius",
      refs: [solved.arcs[0].id],
      expression: "10mm",
    });
    solved = solveSketch(sketch, {});
    const moved = translatedCanvasGroup(
        sketch,
        solved,
        solved.arcs[0].center.id,
        { x: 8, y: 12 },
      ),
      after = solveSketch(moved.sketch, {});
    expect(() =>
      validateCanvasTranslation(solved, after, moved.targets),
    ).not.toThrow();
    expect(after.arcs[0]).toMatchObject({
      radius: 10,
      sweep: Math.PI,
      center: { x: 8, y: 12 },
    });
    expect(detectProfiles(after).profiles[0].id).toBe(
      detectProfiles(solved).profiles[0].id,
    );
    expect(moved.sketch.dimensions).toBe(sketch.dimensions);
  });
  it("blocks fixed or parameter-bound groups and excessive coordinates without rewriting design intent", () => {
    const { sketch, pointId, parameters } = fixture(),
      fixed = addConstraint(sketch, "fixed", { pointIds: [pointId] });
    expect(
      canvasTranslationGroup(fixed, solveSketch(fixed, parameters), pointId)
        .reason,
    ).toContain("fixed");
    const point = sketch.entities[pointId];
    if (point.type !== "point") throw new Error("point required");
    const bound = {
      ...sketch,
      entities: {
        ...sketch.entities,
        [pointId]: { ...point, x: { expression: "zero", unit: "mm" } },
      },
    };
    const values = { ...parameters, zero: normalizeQuantity(0, "mm") };
    expect(
      canvasTranslationGroup(bound, solveSketch(bound, values), pointId).reason,
    ).toContain("parameter-bound");
    expect(() =>
      translatedCanvasGroup(sketch, solveSketch(sketch, parameters), pointId, {
        x: 1e8,
        y: 0,
      }),
    ).toThrow("100,000,000");
    expect(() =>
      translatedCanvasGroup(sketch, solveSketch(sketch, parameters), pointId, {
        x: NaN,
        y: 0,
      }),
    ).toThrow("finite");
  });
  it("rejects new point collisions, containment changes and solver drift in unrelated geometry", () => {
    const { sketch: base, pointId, parameters } = fixture();
    let sketch = addCanvasGeometry(
      base,
      solveSketch(base, parameters),
      "point",
      [{ x: 50, y: 50 }],
    ).sketch;
    const solved = solveSketch(sketch, parameters),
      moved = translatedCanvasGroup(sketch, solved, pointId, { x: 50, y: 50 }),
      after = solveSketch(moved.sketch, parameters);
    expect(() =>
      validateCanvasTranslation(solved, after, moved.targets),
    ).toThrow("coincide");
    sketch = addCanvasGeometry(base, solveSketch(base, parameters), "circle", [
      { x: 20, y: 15 },
      { x: 22, y: 15 },
    ]).sketch;
    const before = solveSketch(sketch, parameters),
      hole = before.circles[0],
      outside = translatedCanvasGroup(sketch, before, hole.center.id, {
        x: 100,
        y: 100,
      });
    expect(() =>
      validateCanvasTranslation(
        before,
        solveSketch(outside.sketch, parameters),
        outside.targets,
      ),
    ).toThrow("profile topology");
    const correct = translatedCanvasGroup(sketch, before, pointId, {
        x: 1,
        y: 1,
      }),
      correctSolved = solveSketch(correct.sketch, parameters);
    const drift = {
      ...correctSolved,
      points: {
        ...correctSolved.points,
        [hole.center.id]: { ...correctSolved.points[hole.center.id], x: 21 },
      },
    };
    expect(() =>
      validateCanvasTranslation(before, drift, correct.targets),
    ).toThrow("other geometry");
  });
  it("bounds connected group size in legacy sketches", () => {
    let sketch = { ...createXySketch(), solveMode: "validate" as const };
    let first = "",
      previous = "";
    for (let i = 0; i < 81; i++) {
      const added = addPoint(sketch, `${i}mm`, "0mm");
      sketch = { ...added.sketch, solveMode: "validate" };
      if (previous)
        sketch = {
          ...addLine(sketch, previous, added.pointId).sketch,
          solveMode: "validate",
        };
      first ||= added.pointId;
      previous = added.pointId;
    }
    expect(
      canvasTranslationGroup(sketch, solveSketch(sketch, {}), first).reason,
    ).toContain("80 point");
  });
  it("commits one undoable edit, skips no-op translations and rejects stale gestures and replacement projects", () => {
    const { sketch: raw, pointId } = fixture();
    const sketch = withCanvasDimension(raw, {
        id: raw.dimensions[0].id,
        type: "length",
        refs: raw.dimensions[0].entityIds,
        expression: "40mm",
      }),
      document = upsertSketch(createEmptyDocument(), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    commitCanvasTranslation(active, before, pointId, { x: 10, y: 12 });
    const after = useCadStore.getState().history.present;
    expect(useCadStore.getState().history.past.at(-1)).toBe(before);
    const stored = after.sketches[sketch.id];
    expect(solveSketch(stored, {}).points[pointId]).toMatchObject({
      x: 10,
      y: 12,
    });
    expect(stored.constraints).toEqual(sketch.constraints);
    expect(stored.dimensions).toEqual(sketch.dimensions);
    const rejected = vi
      .spyOn(useCadStore.getState(), "updateDocument")
      .mockImplementation(() => {});
    try {
      expect(() =>
        commitCanvasTranslation(active, after, pointId, { x: 20, y: 12 }),
      ).toThrow("could not be saved");
    } finally {
      rejected.mockRestore();
    }
    commitCanvasTranslation(active, after, pointId, { x: 10, y: 12 });
    expect(useCadStore.getState().history.present).toBe(after);
    expect(() =>
      commitCanvasTranslation(active, before, pointId, { x: 20, y: 12 }),
    ).toThrow("changed");
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(after);
    useCadStore.getState().setDocument(after);
    expect(() =>
      commitCanvasTranslation(
        active,
        useCadStore.getState().history.present,
        pointId,
        { x: 20, y: 12 },
      ),
    ).toThrow("Reopen");
  });
});
