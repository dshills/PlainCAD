import { beforeEach, expect, it, vi } from "vitest";
import { addCircleAt, addConstraint, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { contextualConstraintOptions, buildContextualConstraint, sketchConstraintStatus, withSolvedSketchSeeds } from "../cad/sketch/contextualConstraints";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { applyContextualConstraint, captureContextualConstraintFrame, currentContextualConstraintFrame, previewContextualConstraint, useContextualConstraintDraft } from "../ui/commands/contextualConstraintCommand";
import { rebuildDocument } from "../cad/features/rebuildGraph";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
function fixture() {
  const a = addPoint(createXySketch(), "0mm", "0mm"), b = addPoint(a.sketch, "20mm", "5mm");
  const line = addLine(b.sketch, a.pointId, b.pointId);
  return { sketch: line.sketch, lineId: line.lineId, points: [a.pointId, b.pointId], document: upsertSketch(createEmptyDocument(), line.sketch) };
}
beforeEach(() => { mocks.preview.mockImplementation(rebuildDocument); useCadStore.setState(useCadStore.getInitialState(), true); useSketchCanvas.setState({ active: undefined, selection: undefined }); useContextualConstraintDraft.setState({ frame: undefined }); });
it("offers only relations matching selected shapes and rejects stale, duplicate, or oversized selections", () => {
  const f = fixture();
  expect(contextualConstraintOptions(f.sketch, [f.lineId]).map((option) => option.type)).toEqual(["horizontal", "vertical"]);
  expect(contextualConstraintOptions(f.sketch, f.points).map((option) => option.type)).toEqual(["coincident"]);
  expect(contextualConstraintOptions(f.sketch, [f.lineId, f.points[0]])).toEqual([]);
  expect(contextualConstraintOptions(f.sketch, ["lost"])).toEqual([]);
  expect(contextualConstraintOptions(f.sketch, [f.lineId, f.lineId])).toEqual([]);
  expect(() => buildContextualConstraint(f.document, f.sketch.id, f.points, "horizontal")).toThrow("does not match");
});
it.each(["horizontal", "vertical"] as const)("previews %s with solved coordinates, unchanged IDs, and durable seeds", (type) => {
  const f = fixture(), plan = buildContextualConstraint(f.document, f.sketch.id, [f.lineId], type);
  const updated = plan.document.sketches[f.sketch.id], solved = solveSketch(updated, {}), line = solved.lines[0];
  expect(Math.abs(type === "horizontal" ? line.start.y - line.end.y : line.start.x - line.end.x)).toBeLessThan(1e-7);
  expect(Object.keys(updated.entities)).toEqual(Object.keys(f.sketch.entities));
  expect(updated.constraints).toHaveLength(1);
  expect(plan.addedIds).toEqual([updated.constraints[0].id]);
  expect(sketchConstraintStatus(solved)).toContain("Underconstrained");
  expect(f.sketch.constraints).toHaveLength(0);
  expect(solveSketch(f.sketch, {}).lines[0].end.y).toBe(5);
  expect(() => buildContextualConstraint(plan.document, f.sketch.id, [f.lineId], type)).toThrow("already present");
});
it("preserves previous intent and reports the conflicting constraint without deleting it", () => {
  const f = fixture(), fixed = addConstraint(f.sketch, "fixed", { pointIds: f.points });
  const document = upsertSketch(f.document, fixed);
  expect(() => buildContextualConstraint(document, fixed.id, [f.lineId], "horizontal")).toThrow("Existing constraints and dimensions were preserved");
  expect(fixed.constraints).toHaveLength(1);
  expect(fixed.constraints[0].type).toBe("fixed");
});
it("solves two-line parallel and perpendicular relations with observable dot/cross products", () => {
  const f = fixture(), a = addPoint(f.sketch, "0mm", "15mm"), b = addPoint(a.sketch, "15mm", "20mm"), second = addLine(b.sketch, a.pointId, b.pointId);
  for (const type of ["parallel", "perpendicular"] as const) {
    const plan = buildContextualConstraint(upsertSketch(f.document, second.sketch), f.sketch.id, [f.lineId, second.lineId], type);
    const [l, r] = plan.solved.lines, u = { x: l.end.x - l.start.x, y: l.end.y - l.start.y }, v = { x: r.end.x - r.start.x, y: r.end.y - r.start.y };
    expect(Math.abs(type === "parallel" ? u.x * v.y - u.y * v.x : u.x * v.x + u.y * v.y)).toBeLessThan(0.001);
  }
});
it("solves Coincident points without changing existing dimensions or identities", () => {
  const a = addPoint(createXySketch(), "0mm", "0mm"), b = addPoint(a.sketch, "10mm", "4mm");
  const plan = buildContextualConstraint(upsertSketch(createEmptyDocument(), b.sketch), b.sketch.id, [a.pointId, b.pointId], "coincident");
  const p = plan.solved.points[a.pointId], q = plan.solved.points[b.pointId];
  expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-7);
  expect(plan.document.sketches[b.sketch.id].constraints[0].entityIds).toEqual([]);
  expect(plan.document.sketches[b.sketch.id].constraints[0].pointIds).toEqual([a.pointId, b.pointId]);
});
it("solves a line/circle tangent pair and offers Tangent only for supported pairs", () => {
  const f = fixture(), sketch = addCircleAt(f.sketch, "10mm", "12mm", "4mm"), circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  expect(contextualConstraintOptions(sketch, [f.lineId, circle.id]).map((option) => option.type)).toEqual(["tangent"]);
  const plan = buildContextualConstraint(upsertSketch(f.document, sketch), sketch.id, [f.lineId, circle.id], "tangent");
  const line = plan.solved.lines[0], curve = plan.solved.circles[0], dx = line.end.x - line.start.x, dy = line.end.y - line.start.y;
  expect(Math.abs(dx * (curve.center.y - line.start.y) - dy * (curve.center.x - line.start.x)) / Math.hypot(dx, dy)).toBeCloseTo(curve.radius, 6);
});
it("requires a worker-issued proposal proof, rejects same-ID result mixing, applies once and restores authored geometry with Undo", async () => {
  const f = fixture(); useCadStore.getState().setDocument(f.document);
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: f.document.id, session: state.documentSession, sketchId: f.sketch.id }, selection: { document: state.history.present, entityIds: [f.lineId] } });
  const frame = captureContextualConstraintFrame(), plan = buildContextualConstraint(frame.document, f.sketch.id, [f.lineId], "horizontal");
  useContextualConstraintDraft.setState({ frame });
  const plain = await rebuildDocument(plan.document);
  expect(() => applyContextualConstraint(frame, plan, plain)).toThrow("another proposal");
  const preview = await previewContextualConstraint(plan, new AbortController().signal);
  const other = buildContextualConstraint(frame.document, f.sketch.id, [f.lineId], "vertical");
  expect(() => applyContextualConstraint(frame, other, preview.result)).toThrow("another proposal");
  expect(preview.native).toBe(false);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  applyContextualConstraint(frame, plan, preview.result);
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(() => applyContextualConstraint(frame, plan, preview.result)).toThrow("changed");
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(frame.document);
  expect(solveSketch(useCadStore.getState().history.present.sketches[f.sketch.id], {}).lines[0].end.y).toBe(5);
});
it("rejects stale selection and session replacements and aborted worker results", async () => {
  const f = fixture(); useCadStore.getState().setDocument(f.document);
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: f.document.id, session: state.documentSession, sketchId: f.sketch.id }, selection: { document: state.history.present, entityIds: [f.lineId] } });
  const frame = captureContextualConstraintFrame(), plan = buildContextualConstraint(frame.document, f.sketch.id, [f.lineId], "horizontal");
  useSketchCanvas.setState({ selection: undefined }); expect(currentContextualConstraintFrame(frame)).toBe(false);
  const controller = new AbortController(); controller.abort();
  await expect(previewContextualConstraint(plan, controller.signal)).rejects.toThrow("canceled");
  useCadStore.getState().setDocument({ ...f.document }); expect(currentContextualConstraintFrame(frame)).toBe(false);
});

it("preserves a bound coordinate, existing dimension ID and expression while adding orientation", () => {
  const f = fixture(), point = f.sketch.entities[f.points[0]];
  if (point.type !== "point") throw new Error("Expected point");
  const sketch = withCanvasDimension({ ...f.sketch, entities: { ...f.sketch.entities, [point.id]: { ...point, x: { expression: "offset", unit: "mm", parameterRefs: { offset: "offset_parameter" } } } } }, { type: "length", refs: [f.lineId], expression: `${Math.sqrt(425)}mm` });
  const document = upsertSketch({ ...f.document, parameters: { offset: { id: "offset_parameter", name: "offset", expression: "0mm", unit: "mm", value: 0 } } }, sketch);
  const plan = buildContextualConstraint(document, sketch.id, [f.lineId], "horizontal"), candidate = plan.document.sketches[sketch.id];
  expect(candidate.dimensions).toEqual(sketch.dimensions);
  const updated = candidate.entities[point.id];
  expect(updated.type === "point" && updated.x).toEqual({ expression: "offset", unit: "mm", parameterRefs: { offset: "offset_parameter" } });
  const solved = solveSketch(candidate, evaluateParameters(document.parameters).values), line = solved.lines[0];
  expect(line.start.y).toBeCloseTo(line.end.y, 6);
  expect(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y)).toBeCloseTo(Math.sqrt(425), 6);
});

it("uses canonical millimetres while preserving unchanged inch literals", () => {
  const point = addPoint(createXySketch(), "1in", "2cm"), solved = solveSketch(point.sketch, {});
  const seeded = withSolvedSketchSeeds(point.sketch, solved, {}), entity = seeded.entities[point.pointId];
  expect(solved.points[point.pointId]).toMatchObject({ x: 25.4, y: 20 });
  expect(entity.type === "point" && entity.x).toEqual({ expression: "1in", unit: "mm" });
});
it("rejects a worker result resolved after mid-flight abort", async () => {
  const f = fixture(), plan = buildContextualConstraint(f.document, f.sketch.id, [f.lineId], "horizontal");
  let finish: ((result: Awaited<ReturnType<typeof rebuildDocument>>) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const controller = new AbortController(), pending = previewContextualConstraint(plan, controller.signal);
  const rejection = expect(pending).rejects.toThrow("canceled");
  controller.abort(); finish!(await rebuildDocument(plan.document));
  await rejection;
});
