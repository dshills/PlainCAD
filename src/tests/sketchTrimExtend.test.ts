import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addCircleAt, addConstraint, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import type { Sketch } from "../cad/document/schema";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { buildSketchTrimExtend } from "../cad/sketch/trimExtend";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { applySketchTrimExtend, openSketchTrimExtend, previewSketchTrimExtend, useSketchTrimExtend } from "../ui/commands/sketchTrimExtendCommand";
import { useSketchRefinement, useSolidDimensionEdit } from "../ui/commands/interactionDraftState";

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
function line(sketch: Sketch, start: [number, number], end: [number, number]) {
  const a = addPoint(sketch, `${start[0]}mm`, `${start[1]}mm`), b = addPoint(a.sketch, `${end[0]}mm`, `${end[1]}mm`);
  return addLine(b.sketch, a.pointId, b.pointId);
}
function fixture() {
  const target = line(createXySketch(), [0, 0], [30, 0]);
  const left = line(target.sketch, [10, -10], [10, 10]);
  const right = line(left.sketch, [20, -10], [20, 10]);
  return { document: upsertSketch(createEmptyDocument(), right.sketch), sketch: right.sketch, lineId: target.lineId };
}
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useSketchTrimExtend.setState({ frame: undefined, mode: "trim", pick: undefined });
  useSketchRefinement.setState({ frame: undefined });
  useSolidDimensionEdit.setState({ frame: undefined });
  mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
});
it("removes the picked middle interval immutably, preserves retained IDs and emits exact endpoints", () => {
  const { document, sketch, lineId } = fixture();
  const plan = buildSketchTrimExtend(document, sketch.id, lineId, "trim", { x: 15, y: 0 });
  const next = plan.document.sketches[sketch.id], lines = solveSketch(next, {}).lines;
  expect(lines).toHaveLength(4);
  expect(lines.find((l) => l.id === lineId)).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  expect(lines.find((l) => l.start.x === 20 && l.end.x === 30)).toMatchObject({ start: { y: 0 }, end: { y: 0 } });
  expect(next.constraints).toBe(sketch.constraints); expect(next.dimensions).toBe(sketch.dimensions);
  expect(Object.keys(sketch.entities)).toHaveLength(9);
  expect(plan.base).toBe(document);
});
it("trims an end interval and removes only its superseded unused endpoint", () => {
  const { document, sketch, lineId } = fixture(), original = sketch.entities[lineId];
  if (original.type !== "line") throw new Error("Fixture line unavailable");
  const plan = buildSketchTrimExtend(document, sketch.id, lineId, "trim", { x: 5, y: 0 });
  expect(plan.document.sketches[sketch.id].entities[original.startPointId]).toBeUndefined();
  const result = solveSketch(plan.document.sketches[sketch.id], {}).lines.find((l) => l.id === lineId)!;
  expect(result.start.x).toBeCloseTo(10); expect(result.end.x).toBeCloseTo(30);
});
it("does not silently attach an intersection endpoint to an unrelated circle center", () => {
  const { document, sketch, lineId } = fixture();
  const withCircle = addCircleAt(sketch, "10mm", "0mm", "1mm");
  const circle = Object.values(withCircle.entities).find((e) => e.type === "circle")!;
  if (circle.type !== "circle") throw new Error("Fixture circle unavailable");
  const plan = buildSketchTrimExtend(upsertSketch(document, withCircle), sketch.id, lineId, "trim", { x: 10.5, y: 0 });
  const edited = plan.document.sketches[sketch.id].entities[lineId];
  expect(edited.type).toBe("line");
  if (edited.type === "line") {
    expect(edited.endPointId).not.toBe(circle.centerPointId);
    expect(solveSketch(plan.document.sketches[sketch.id], {}).points[edited.endPointId].x).toBeCloseTo(10, 7);
  }
  expect(plan.document.sketches[sketch.id].entities[circle.centerPointId]).toBe(withCircle.entities[circle.centerPointId]);
});
it("extends only the chosen endpoint to the nearest finite boundary and protects shared connections", () => {
  const initial = line(createXySketch(), [0, 0], [5, 0]), shared = initial.sketch.entities[initial.lineId];
  if (shared.type !== "line") throw new Error("Fixture line unavailable");
  const branch = addPoint(initial.sketch, "5mm", "4mm");
  const joined = addLine(branch.sketch, shared.endPointId, branch.pointId);
  const boundary = line(joined.sketch, [10, -2], [10, 2]);
  const far = line(boundary.sketch, [20, -2], [20, 2]);
  const document = upsertSketch(createEmptyDocument(), far.sketch);
  expect(() => buildSketchTrimExtend(document, far.sketch.id, initial.lineId, "extend", { x: 4, y: 0 })).toThrow("shared with");
  const disconnected = { ...far.sketch, entities: Object.fromEntries(Object.entries(far.sketch.entities).filter(([id]) => id !== joined.lineId)) };
  const plan = buildSketchTrimExtend(upsertSketch(document, disconnected), far.sketch.id, initial.lineId, "extend", { x: 4, y: 0 });
  expect(solveSketch(plan.document.sketches[far.sketch.id], {}).lines.find((l) => l.id === initial.lineId)!.end.x).toBeCloseTo(10);
  expect(plan.document.sketches[far.sketch.id].entities[shared.endPointId]).toBeUndefined();
  const behind = buildSketchTrimExtend(upsertSketch(document, line(far.sketch, [-10, -2], [-10, 2]).sketch), far.sketch.id, initial.lineId, "extend", { x: 0, y: 0 });
  expect(solveSketch(behind.document.sketches[far.sketch.id], {}).lines.find((l) => l.id === initial.lineId)!.start.x).toBeCloseTo(-10);
});
it("does not infer intersections with infinite boundary supports, overlaps or endpoint-less circle extensions", () => {
  const target = line(createXySketch(), [0, 0], [5, 0]);
  const miss = line(target.sketch, [10, 2], [10, 3]);
  const document = upsertSketch(createEmptyDocument(), miss.sketch);
  expect(() => buildSketchTrimExtend(document, miss.sketch.id, target.lineId, "extend", { x: 4, y: 0 })).toThrow("No finite line, arc or circle boundary");
  expect(() => buildSketchTrimExtend(document, miss.sketch.id, target.lineId, "trim", { x: 2, y: 0 })).toThrow("Use Delete");
  const overlap = line(miss.sketch, [2, 0], [3, 0]);
  expect(() => buildSketchTrimExtend(upsertSketch(document, overlap.sketch), overlap.sketch.id, target.lineId, "trim", { x: 2.5, y: 0 })).toThrow("overlaps");
  const circle = addCircleAt(miss.sketch, "2mm", "0mm", "1mm");
  const circleId = Object.values(circle.entities).find((e) => e.type === "circle")!.id;
  expect(() => buildSketchTrimExtend(upsertSketch(document, circle), circle.id, circleId, "extend", { x: 3, y: 0 })).toThrow("no endpoints");
  const touching = line(miss.sketch, [5, -1], [5, 1]), farther = line(touching.sketch, [10, -1], [10, 1]);
  expect(() => buildSketchTrimExtend(upsertSketch(document, farther.sketch), farther.sketch.id, target.lineId, "extend", { x: 4, y: 0 })).toThrow("already meets");
});
it("diagnoses protected constraints, dimensions, expressions, pick ambiguity and resource limits", () => {
  const { document, sketch, lineId } = fixture();
  const constrained = addConstraint(sketch, "horizontal", { entityIds: [lineId] });
  expect(() => buildSketchTrimExtend(upsertSketch(document, constrained), sketch.id, lineId, "trim", { x: 15, y: 0 })).toThrow(constrained.constraints[0].id);
  const dimension = { id: "protected-length", type: "length" as const, entityIds: [lineId], expression: { expression: "30mm", unit: "mm" } };
  expect(() => buildSketchTrimExtend(upsertSketch(document, { ...sketch, dimensions: [dimension] }), sketch.id, lineId, "trim", { x: 15, y: 0 })).toThrow("protected-length");
  const source = sketch.entities[lineId]; if (source.type !== "line") throw new Error("Fixture line unavailable");
  const point = sketch.entities[source.startPointId]; if (point.type !== "point") throw new Error("Fixture point unavailable");
  const bound = { ...sketch, entities: { ...sketch.entities, [point.id]: { ...point, x: { expression: "origin", unit: "mm" } } } };
  expect(() => buildSketchTrimExtend(upsertSketch(document, bound), sketch.id, lineId, "trim", { x: 15, y: 0 })).toThrow("parameter-bound");
  expect(() => buildSketchTrimExtend(document, sketch.id, lineId, "trim", { x: 10, y: 0 })).toThrow("inside a segment");
  expect(() => buildSketchTrimExtend(document, sketch.id, lineId, "extend", { x: 15, y: 0 })).toThrow("nearer");
  expect(() => buildSketchTrimExtend(document, sketch.id, lineId, "trim", { x: NaN, y: 0 })).toThrow("finite");
});
it("preserves feature profile intent by diagnosing a lost closed boundary", () => {
  const initial = line(createXySketch(), [0, 0], [30, 0]);
  let sketch = initial.sketch;
  const lineId = initial.lineId;
  for (const [a, b] of [[[30, 0], [30, 10]], [[30, 10], [0, 10]], [[0, 10], [0, 0]]] as [[number, number], [number, number]][]) sketch = line(sketch, a, b).sketch;
  const boundary = line(sketch, [10, -2], [10, 2]); sketch = boundary.sketch;
  const clean = { ...sketch, entities: { ...sketch.entities } };
  // The boundary crossing is construction, allowing a valid original profile.
  clean.entities = { ...clean.entities, [boundary.lineId]: { ...clean.entities[boundary.lineId], construction: true } };
  const profile = detectProfiles(solveSketch(clean, {})).profiles[0];
  expect(profile).toBeDefined();
  const document = upsertFeature(upsertSketch(createEmptyDocument(), clean), createExtrudeFeature({ sketchId: clean.id, profileId: profile.id, name: "Protected extrusion", distance: { expression: "4mm", unit: "mm" }, operation: "newBody", direction: "positive" }));
  expect(() => buildSketchTrimExtend(document, clean.id, lineId, "trim", { x: 5, y: 0 })).toThrow("would lose profile");
});
it("accepts only matching worker-issued plans and applies a single undoable edit", async () => {
  const { document, sketch, lineId } = fixture(); useCadStore.getState().setDocument(document);
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: document.id, session: state.documentSession, sketchId: sketch.id } });
  openSketchTrimExtend("trim"); const frame = useSketchTrimExtend.getState().frame!;
  const plan = buildSketchTrimExtend(frame.document, sketch.id, lineId, "trim", { x: 15, y: 0 });
  const result = await previewSketchTrimExtend(plan, new AbortController().signal);
  const other = buildSketchTrimExtend(frame.document, sketch.id, lineId, "trim", { x: 5, y: 0 });
  expect(() => applySketchTrimExtend(frame, other, result.result)).toThrow("does not match");
  const forged = { ...result.result };
  expect(() => applySketchTrimExtend(frame, plan, forged)).toThrow("does not match");
  applySketchTrimExtend(frame, plan, result.result);
  expect(useCadStore.getState().history.past).toHaveLength(1);
  useCadStore.getState().undo(); expect(useCadStore.getState().history.present).toBe(frame.document);
});
it("rejects stale same-ID project replacement and canceled workers without editing history", async () => {
  const { document, sketch, lineId } = fixture(); useCadStore.getState().setDocument(document);
  useSketchCanvas.setState({ active: { documentId: document.id, session: useCadStore.getState().documentSession, sketchId: sketch.id } });
  openSketchTrimExtend("trim"); const frame = useSketchTrimExtend.getState().frame!;
  const plan = buildSketchTrimExtend(frame.document, sketch.id, lineId, "trim", { x: 15, y: 0 });
  const result = await previewSketchTrimExtend(plan, new AbortController().signal);
  useCadStore.getState().setDocument({ ...frame.document });
  expect(() => applySketchTrimExtend(frame, plan, result.result)).toThrow("changed");
  const abort = new AbortController(); abort.abort();
  await expect(previewSketchTrimExtend(plan, abort.signal)).rejects.toThrow("canceled");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
