import { beforeEach, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import {
  addArc,
  addCircle,
  addCornerRectangle,
  addConstraint,
  addLine,
  addPoint,
  createXySketch,
} from "../cad/sketch/SketchModel";
import {
  deleteSketchEntity,
  planSketchEntityDeletion,
} from "../cad/sketch/entityDeletion";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { useCadStore } from "../state/useCadStore";
import {
  beginSketchCanvas,
  deleteSelectedCanvasEntity,
  selectCanvasEntity,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import {
  runCommand,
  selectCommandEnablement,
} from "../ui/commands/commandRegistry";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";

function fixture() {
  const a = addPoint(createXySketch(), "0mm", "0mm");
  const b = addPoint(a.sketch, "10mm", "0mm");
  const c = addPoint(b.sketch, "0mm", "10mm");
  const line = addLine(c.sketch, a.pointId, b.pointId);
  const circle = addCircle(line.sketch, a.pointId, "4mm");
  const arc = addArc(circle.sketch, a.pointId, b.pointId, c.pointId);
  const other = addCircle(arc.sketch, c.pointId, "2mm");
  let sketch = addConstraint(other.sketch, "horizontal", {
    entityIds: [line.lineId],
  });
  sketch = addConstraint(sketch, "fixed", { pointIds: [a.pointId] });
  sketch = {
    ...sketch,
    dimensions: [
      {
        id: "line-size",
        type: "length",
        entityIds: [line.lineId],
        expression: { expression: "10mm", unit: "mm" },
      },
      {
        id: "point-distance",
        type: "distance",
        entityIds: [],
        pointIds: [a.pointId, b.pointId],
        expression: { expression: "10mm", unit: "mm" },
      },
      {
        id: "other-size",
        type: "radius",
        entityIds: [other.circleId],
        expression: { expression: "2mm", unit: "mm" },
      },
    ],
  };
  return {
    sketch,
    a: a.pointId,
    b: b.pointId,
    c: c.pointId,
    line: line.lineId,
    circle: circle.circleId,
    arc: arc.arcId,
    other: other.circleId,
  };
}
beforeEach(() => {
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
});
it.each(["line", "circle", "arc"] as const)(
  "deletes a %s without removing shared points or unrelated intent",
  (kind) => {
    const f = fixture(),
      before = structuredClone(f.sketch);
    const next = deleteSketchEntity(f.sketch, f[kind], { features: [] });
    expect(next.entities[f[kind]]).toBeUndefined();
    for (const id of [f.a, f.b, f.c, f.other])
      expect(next.entities[id]).toBe(f.sketch.entities[id]);
    expect(next.dimensions.some((d) => d.id === "other-size")).toBe(true);
    expect(next.constraints.some((c) => c.type === "fixed")).toBe(true);
    if (kind === "line") {
      expect(next.dimensions.map((d) => d.id)).toEqual([
        "point-distance",
        "other-size",
      ]);
      expect(next.constraints.map((c) => c.type)).toEqual(["fixed"]);
    }
    expect(f.sketch).toEqual(before);
  },
);
it("deletes a shared point and exactly its dependent curves, dimensions and constraints", () => {
  const f = fixture();
  const plan = planSketchEntityDeletion(f.sketch, f.a, { features: [] });
  expect([...plan.entityIds]).toEqual([f.a, f.line, f.circle, f.arc, f.b]);
  expect(plan.dimensionIds).toEqual(new Set(["line-size", "point-distance"]));
  expect(plan.constraintIds.size).toBe(2);
  const next = deleteSketchEntity(f.sketch, f.a, { features: [] });
  expect(Object.keys(next.entities)).toEqual([f.c, f.other]);
  expect(next.dimensions.map((d) => d.id)).toEqual(["other-size"]);
  expect(next.constraints).toEqual([]);
  const solved = solveSketch(next, {});
  expect(solved.errors).toEqual([]);
  expect(solved.circles[0]).toMatchObject({
    id: f.other,
    radius: 2,
    center: { x: 0, y: 10 },
  });
  const saved = upsertSketch(createEmptyDocument(), next);
  expect(importProjectText(serializeProject(saved)).sketches[next.id]).toEqual(
    saved.sketches[next.id],
  );
  expect(() => deleteSketchEntity(next, f.a, { features: [] })).toThrow(
    /removed/,
  );
});
it("routes deletion through command availability and one undo edit, rejecting busy or stale selections", async () => {
  const f = fixture(),
    document = upsertSketch(createEmptyDocument(), f.sketch);
  const state = useCadStore.getState();
  state.setDocument(document);
  state.select({ kind: "sketch", id: f.sketch.id, documentId: document.id });
  beginSketchCanvas();
  const active = useSketchCanvas.getState().active!;
  expect(
    selectCommandEnablement(useCadStore.getState()).deleteSketchEntity,
  ).toBe(false);
  const current = useCadStore.getState().history.present;
  selectCanvasEntity(active, current, f.a);
  expect(
    selectCommandEnablement(useCadStore.getState()).deleteSketchEntity,
  ).toBe(true);
  useCadStore.setState({ fileBusy: true });
  expect(
    selectCommandEnablement(useCadStore.getState()).deleteSketchEntity,
  ).toBe(false);
  expect(() => deleteSelectedCanvasEntity()).toThrow(/Select a current/);
  useCadStore.setState({ fileBusy: false });
  const before = useCadStore.getState().history;
  await runCommand("sketch.entity.delete");
  const after = useCadStore.getState().history;
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(Object.keys(after.present.sketches[f.sketch.id].entities)).toEqual([
    f.c,
    f.other,
  ]);
  expect(useSketchCanvas.getState().selection).toBeUndefined();
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(before.present);
  useCadStore.getState().redo();
  expect(useCadStore.getState().history.present).toBe(after.present);
  expect(() => selectCanvasEntity(active, document, f.b)).toThrow(
    /Project changed/,
  );
  selectCanvasEntity(active, after.present, f.c);
  useCadStore.getState().updateDocument((d) => ({ ...d, name: "Changed" }));
  const stale = useCadStore.getState().history;
  expect(() => deleteSelectedCanvasEntity()).toThrow(/Select a current/);
  expect(useCadStore.getState().history).toBe(stale);
  useCadStore.getState().setDocument(document);
  expect(() => selectCanvasEntity(active, document, f.b)).toThrow(
    /Project changed/,
  );
});
it("allows deletion to repair invalid sketch geometry even when its plane and parameters cannot resolve", async () => {
  const f = fixture();
  const sketch = {
    ...f.sketch,
    plane: { type: "face" as const, featureId: "lost", stableFaceId: "lost" },
  };
  const document = {
    ...upsertSketch(createEmptyDocument(), sketch),
    parameters: {
      bad: {
        id: "bad",
        name: "bad",
        expression: "missing",
        value: 0,
        unit: "mm",
      },
    },
  };
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  beginSketchCanvas();
  selectCanvasEntity(
    useSketchCanvas.getState().active!,
    useCadStore.getState().history.present,
    f.a,
  );
  await runCommand("sketch.entity.delete");
  expect(
    useCadStore.getState().history.present.sketches[sketch.id].entities[f.a],
  ).toBeUndefined();
  expect(
    useCadStore.getState().history.present.sketches[sketch.id].plane,
  ).toEqual(sketch.plane);
});

it.each(["line", "circle", "arc"] as const)(
  "removes the unused points of an isolated %s, leaving unrelated standalone points",
  (kind) => {
    const a = addPoint(createXySketch(), "0mm", "0mm");
    const b = addPoint(a.sketch, "10mm", "0mm");
    const c = addPoint(b.sketch, "0mm", "10mm");
    const unrelated = addPoint(c.sketch, "50mm", "50mm");
    const shape =
      kind === "line"
        ? addLine(unrelated.sketch, a.pointId, b.pointId)
        : kind === "circle"
          ? addCircle(unrelated.sketch, a.pointId, "4mm")
          : addArc(unrelated.sketch, a.pointId, b.pointId, c.pointId);
    const curve = Object.values(shape.sketch.entities).find(
      (e) => e.type === kind,
    )!;
    const next = deleteSketchEntity(shape.sketch, curve.id, { features: [] });
    expect(next.entities[a.pointId]).toBeUndefined();
    expect(next.entities[b.pointId]).toBe(
      kind === "circle" ? shape.sketch.entities[b.pointId] : undefined,
    );
    expect(next.entities[c.pointId]).toBe(
      kind === "arc" ? undefined : shape.sketch.entities[c.pointId],
    );
    expect(next.entities[unrelated.pointId]).toBe(
      shape.sketch.entities[unrelated.pointId],
    );
    expect(solveSketch(next, {}).errors).toEqual([]);
  },
);
it("cleans rectangle corners as their last edge is removed, without sweeping other points", () => {
  const standalone = addPoint(createXySketch(), "50mm", "50mm");
  const rectangle = addCornerRectangle(standalone.sketch, "20mm", "12mm");
  const lines = Object.values(rectangle.entities).filter(
    (e) => e.type === "line",
  );
  let next = rectangle;
  const pointCounts: number[] = [];
  for (const line of lines) {
    next = deleteSketchEntity(next, line.id, { features: [] });
    pointCounts.push(
      Object.values(next.entities).filter((e) => e.type === "point").length,
    );
    expect(solveSketch(next, {}).errors).toEqual([]);
  }
  expect(pointCounts).toEqual([5, 4, 3, 1]);
  expect(next.entities).toEqual(standalone.sketch.entities);
});
it.each(["constraint", "dimension", "hole"] as const)(
  "preserves a circle center referenced by a surviving %s, with matching preview and command results",
  async (reference) => {
    const point = addPoint(createXySketch(), "0mm", "0mm");
    const circle = addCircle(point.sketch, point.pointId, "4mm");
    let sketch = circle.sketch;
    if (reference === "constraint")
      sketch = addConstraint(sketch, "fixed", { entityIds: [point.pointId] });
    if (reference === "dimension") {
      const other = addPoint(sketch, "10mm", "0mm");
      sketch = {
        ...other.sketch,
        dimensions: [
          {
            id: "distance",
            type: "distance",
            entityIds: [],
            pointIds: [point.pointId, other.pointId],
            expression: { expression: "10mm", unit: "mm" },
          },
        ],
      };
    }
    const document = upsertSketch(createEmptyDocument(), sketch);
    if (reference === "hole")
      document.features = [
        {
          id: "hole",
          timelineStep: 1,
          name: "Hole",
          type: "hole",
          sketchId: sketch.id,
          centerPointIds: [point.pointId],
          diameter: { expression: "2mm", unit: "mm" },
          depth: "throughAll",
        },
      ];
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const current = useCadStore.getState().history.present;
    const plan = planSketchEntityDeletion(
      current.sketches[sketch.id],
      circle.circleId,
      current,
    );
    expect([...plan.entityIds]).toEqual([circle.circleId]);
    expect(plan.constraintIds.size + plan.dimensionIds.size).toBe(0);
    selectCanvasEntity(
      useSketchCanvas.getState().active!,
      current,
      circle.circleId,
    );
    await runCommand("sketch.entity.delete");
    const next = useCadStore.getState().history.present;
    expect(next.sketches[sketch.id].entities[point.pointId]).toEqual(
      current.sketches[sketch.id].entities[point.pointId],
    );
    expect(next.sketches[sketch.id].entities[circle.circleId]).toBeUndefined();
    expect(next.features).toEqual(current.features);
    expect(
      importProjectText(serializeProject(next)).sketches[sketch.id],
    ).toEqual(next.sketches[sketch.id]);
  },
);
