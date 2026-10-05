import { beforeEach, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import {
  addPoint,
  addLine,
  addCircle,
  addArc,
  addCornerRectangle,
  createXySketch,
  addConstraint,
} from "../cad/sketch/SketchModel";
import { canvasBoxEntityIds } from "../cad/sketch/canvasSelection";
import {
  deleteSketchEntities,
  planSketchEntitiesDeletion,
} from "../cad/sketch/entityDeletion";
import { solveSketch } from "../cad/sketch/SketchSolver";
import {
  beginSketchCanvas,
  selectCanvasEntities,
  selectAllCanvasEntities,
  selectedCanvasEntities,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { useCadStore } from "../state/useCadStore";
import {
  runCommand,
  selectCommandEnablement,
} from "../ui/commands/commandRegistry";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";

beforeEach(() => {
  useCadStore.setState({ fileBusy: false });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
});
it("deletes a whole rectangle in one plan while retaining a shared neighboring curve and standalone point", () => {
  let sketch = addCornerRectangle(createXySketch(), "20mm", "12mm");
  const lines = Object.values(sketch.entities).filter((e) => e.type === "line");
  const shared = lines[0].type === "line" ? lines[0].startPointId : "";
  const end = addPoint(sketch, "-10mm", "0mm");
  const outside = addLine(end.sketch, shared, end.pointId);
  const standalone = addPoint(outside.sketch, "50mm", "50mm");
  sketch = standalone.sketch;
  const plan = planSketchEntitiesDeletion(
    sketch,
    lines.map((e) => e.id),
    { features: [] },
  );
  expect(plan.entityIds.size).toBe(7);
  const next = deleteSketchEntities(
    sketch,
    lines.map((e) => e.id),
    { features: [] },
  );
  expect(Object.keys(next.entities).sort()).toEqual(
    [shared, end.pointId, outside.lineId, standalone.pointId].sort(),
  );
  expect(solveSketch(next, {}).lines[0]).toMatchObject({
    start: { x: 0, y: 0 },
    end: { x: -10, y: 0 },
  });
  expect(sketch.entities[lines[0].id]).toBeDefined();
  const document = upsertSketch(createEmptyDocument(), next);
  expect(
    importProjectText(serializeProject(document)).sketches[next.id],
  ).toEqual(document.sketches[next.id]);
});
it("retains points with surviving constraints and removes only dimensions tied to the bulk selection", () => {
  const point = addPoint(createXySketch(), "0mm", "0mm");
  const circle = addCircle(point.sketch, point.pointId, "4mm");
  const secondPoint = addPoint(circle.sketch, "20mm", "0mm");
  const second = addCircle(secondPoint.sketch, secondPoint.pointId, "2mm");
  const sketch = {
    ...addConstraint(second.sketch, "fixed", { pointIds: [point.pointId] }),
    dimensions: [
      {
        id: "diameter",
        type: "diameter" as const,
        entityIds: [second.circleId],
        expression: { expression: "4mm", unit: "mm" },
      },
    ],
  };
  const next = deleteSketchEntities(
    sketch,
    [circle.circleId, second.circleId],
    { features: [] },
  );
  expect(Object.keys(next.entities)).toEqual([point.pointId]);
  expect(next.constraints).toEqual(sketch.constraints);
  expect(next.dimensions).toEqual([]);
  expect(() =>
    deleteSketchEntities(sketch, [circle.circleId, "lost"], { features: [] }),
  ).toThrow(/removed/);
  expect(() => deleteSketchEntities(sketch, [], { features: [] })).toThrow(
    /Select/,
  );
});
it("distinguishes window/crossing geometry and avoids cascading shared support points", () => {
  const rectangle = addCornerRectangle(createXySketch(), "20mm", "12mm");
  const outside = addPoint(rectangle, "-10mm", "0mm");
  const shared = Object.values(rectangle.entities).find(
    (e) =>
      e.type === "point" &&
      e.x.expression === "0mm" &&
      e.y.expression === "0mm",
  )!;
  const neighbor = addLine(outside.sketch, shared.id, outside.pointId);
  const solved = solveSketch(neighbor.sketch, {});
  const windowIds = canvasBoxEntityIds(solved, {
    start: { x: -1, y: -1 },
    end: { x: 21, y: 13 },
  });
  expect(windowIds).toEqual(
    solved.lines.filter((e) => e.id !== neighbor.lineId).map((e) => e.id),
  );
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: 9, y: -1 },
      end: { x: 11, y: 1 },
    }),
  ).toEqual([]);
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: 11, y: -1 },
      end: { x: 9, y: 1 },
    }),
  ).toEqual([
    solved.lines.find(
      (l) => l.start.y === 0 && l.end.y === 0 && l.id !== neighbor.lineId,
    )!.id,
  ]);
});
it("uses exact circle and arc boundaries, rather than selecting their centers or bounding-box interiors", () => {
  const center = addPoint(createXySketch(), "0mm", "0mm");
  const start = addPoint(center.sketch, "10mm", "0mm");
  const end = addPoint(start.sketch, "0mm", "10mm");
  const arc = addArc(end.sketch, center.pointId, start.pointId, end.pointId);
  const circle = addCircle(arc.sketch, center.pointId, "20mm");
  const solved = solveSketch(circle.sketch, {});
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: 2, y: -1 },
      end: { x: -2, y: 1 },
    }),
  ).toEqual([]);
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: 11, y: -1 },
      end: { x: 9, y: 1 },
    }),
  ).toEqual([arc.arcId]);
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: -1, y: -1 },
      end: { x: 11, y: 11 },
    }),
  ).toEqual([arc.arcId]);
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: 21, y: -1 },
      end: { x: 19, y: 1 },
    }),
  ).toEqual([circle.circleId]);
});
it("toggles geometry, selects all, and deletes in one undo edit with stale/busy/component guards", async () => {
  const sketch = addCornerRectangle(createXySketch(), "20mm", "12mm");
  const document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  beginSketchCanvas();
  const active = useSketchCanvas.getState().active!,
    current = useCadStore.getState().history.present;
  const lines = Object.values(sketch.entities)
    .filter((e) => e.type === "line")
    .map((e) => e.id);
  selectCanvasEntities(active, current, [lines[0]]);
  selectCanvasEntities(active, current, [lines[1]], true);
  expect(selectedCanvasEntities()?.entityIds).toEqual(lines.slice(0, 2));
  selectCanvasEntities(active, current, [lines[0]], true);
  expect(selectedCanvasEntities()?.entityIds).toEqual([lines[1]]);
  useCadStore.setState({ fileBusy: true });
  expect(
    selectCommandEnablement(useCadStore.getState()).selectAllSketchEntities,
  ).toBe(false);
  expect(() => selectAllCanvasEntities()).toThrow(/current sketch/);
  expect(() => selectCanvasEntities(active, current, lines)).toThrow(
    /Project changed/,
  );
  useCadStore.setState({ fileBusy: false });
  selectAllCanvasEntities();
  expect(selectedCanvasEntities()?.entityIds).toHaveLength(8);
  const before = useCadStore.getState().history;
  await runCommand("sketch.entity.delete");
  const after = useCadStore.getState().history;
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.present.sketches[sketch.id].entities).toEqual({});
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(before.present);
  useCadStore.getState().redo();
  expect(useCadStore.getState().history.present).toBe(after.present);
  expect(() => selectCanvasEntities(active, current, lines)).toThrow(
    /Project changed/,
  );
  useCadStore.getState().setDocument(document);
  expect(
    selectCommandEnablement(useCadStore.getState()).selectAllSketchEntities,
  ).toBe(false);
});

it("honors clockwise major arcs and preserves circles when a crossing box is wholly inside them", () => {
  const center = addPoint(createXySketch(), "0mm", "0mm");
  const start = addPoint(center.sketch, "10mm", "0mm");
  const end = addPoint(start.sketch, "0mm", "10mm");
  const arc = addArc(
    end.sketch,
    center.pointId,
    start.pointId,
    end.pointId,
    true,
  );
  const solved = solveSketch(arc.sketch, {});
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: -1, y: -1 },
      end: { x: 11, y: 11 },
    }),
  ).toEqual([]);
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: -11, y: -11 },
      end: { x: 11, y: 11 },
    }),
  ).toEqual([arc.arcId]);
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: -9, y: 1 },
      end: { x: -11, y: -1 },
    }),
  ).toEqual([arc.arcId]);
  expect(
    canvasBoxEntityIds(solved, { start: { x: 8, y: 6 }, end: { x: 6, y: 8 } }),
  ).toEqual([]);
});

it("ignores zero-area selection boxes", () => {
  const sketch = addCornerRectangle(createXySketch(), "20mm", "12mm");
  expect(
    canvasBoxEntityIds(solveSketch(sketch, {}), {
      start: { x: 0, y: -1 },
      end: { x: 0, y: 13 },
    }),
  ).toEqual([]);
});

it("accounts for radius roundoff when a large circular curve crosses a tiny box near the origin", () => {
  const solved = solveSketch(createXySketch(), {});
  solved.circles = [
    {
      id: "large",
      center: { id: "center", x: -1e8, y: -1e8 },
      radius: Math.sqrt(2) * 1e8,
    },
  ];
  expect(
    canvasBoxEntityIds(solved, {
      start: { x: 1e-8, y: 1e-8 },
      end: { x: -1e-8, y: -1e-8 },
    }),
  ).toEqual(["large"]);
});

it("rejects inherited IDs and keeps returned selection arrays separate from state", () => {
  const sketch = addCornerRectangle(createXySketch(), "20mm", "12mm");
  const document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  beginSketchCanvas();
  const active = useSketchCanvas.getState().active!;
  const current = useCadStore.getState().history.present;
  expect(() => selectCanvasEntities(active, current, ["constructor"])).toThrow(
    /Sketch item was removed/,
  );
  selectAllCanvasEntities();
  const selection = selectedCanvasEntities()!;
  selection.entityIds.length = 0;
  expect(selectedCanvasEntities()!.entityIds.length).toBe(
    Object.keys(sketch.entities).length,
  );
});
