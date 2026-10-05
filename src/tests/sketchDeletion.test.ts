import { beforeEach, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import {
  addArc,
  addCircle,
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
    const next = deleteSketchEntity(f.sketch, f[kind]);
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
  const plan = planSketchEntityDeletion(f.sketch, f.a);
  expect([...plan.entityIds]).toEqual([f.a, f.line, f.circle, f.arc]);
  expect(plan.dimensionIds).toEqual(new Set(["line-size", "point-distance"]));
  expect(plan.constraintIds.size).toBe(2);
  const next = deleteSketchEntity(f.sketch, f.a);
  expect(Object.keys(next.entities)).toEqual([f.b, f.c, f.other]);
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
  expect(() => deleteSketchEntity(next, f.a)).toThrow(/removed/);
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
    f.b,
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
  selectCanvasEntity(active, after.present, f.b);
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
