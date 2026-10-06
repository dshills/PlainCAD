import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addPoint, addLine, addCircleAt, addArc, addConstraint, addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { buildSketchReplication } from "../cad/sketch/sketchReplication";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { applySketchReplication, openSketchReplication, previewSketchReplication, useSketchReplication } from "../ui/commands/sketchReplicationCommand";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { useSketchRefinement } from "../ui/commands/interactionDraftState";
import type { RebuildResult } from "../cad/worker/workerProtocol";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
function fixture() {
  let sketch = addCircleAt(createXySketch("Copies"), "4mm", "5mm", "1mm");
  const circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  sketch = withCanvasDimension(sketch, { type: "radius", refs: [circle.id], expression: "drillRadius" });
  const a = addPoint(sketch, "12mm", "0mm"), b = addPoint(a.sketch, "12mm", "16mm"), axis = addLine(b.sketch, a.pointId, b.pointId);
  sketch = { ...axis.sketch, entities: { ...axis.sketch.entities, [axis.lineId]: { ...axis.sketch.entities[axis.lineId], construction: true } }, solveMode: "driving" };
  const document = upsertSketch({ ...createEmptyDocument(), parameters: { drillRadius: { id: "radius_parameter", name: "drillRadius", expression: "1mm", unit: "mm", value: 1 } } }, sketch);
  return { sketch, circleId: circle.id, axisId: axis.lineId, document };
}
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true); useSketchCanvas.setState({ active: undefined, selection: undefined }); useSketchReplication.setState({ frame: undefined, mode: "mirror" }); useSketchRefinement.setState({ frame: undefined }); mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
});
it("mirrors a dimension-driven circle about a construction line, preserves source IDs, and remaps the bound dimension", () => {
  const f = fixture(), plan = buildSketchReplication(f.document, f.sketch.id, [f.circleId, f.axisId], { mode: "mirror", axisLineId: f.axisId });
  const copy = plan.copies[0], sketch = plan.document.sketches[f.sketch.id];
  expect(plan.addedEntityIds).toHaveLength(2);
  expect(copy.entityIds[f.axisId]).toBeUndefined();
  expect(sketch.entities[f.circleId]).toBe(f.sketch.entities[f.circleId]);
  const circle = plan.solved.circles.find((entity) => entity.id === copy.entityIds[f.circleId])!;
  expect(circle.center).toMatchObject({ x: 20, y: 5 }); expect(circle.radius).toBeCloseTo(1, 6);
  const original = f.sketch.dimensions[0], dimension = sketch.dimensions.find((entity) => entity.id === copy.dimensionIds[original.id])!;
  expect(dimension.expression).toEqual(original.expression); expect(dimension.entityIds).toEqual([copy.entityIds[f.circleId]]);
  expect(dimension.id).not.toBe(original.id);
  const changed = { ...f.document.parameters, drillRadius: { ...f.document.parameters.drillRadius, expression: "2mm" } };
  const solved = solveSketch(sketch, evaluateParameters(changed).values);
  expect(solved.circles.map((entity) => entity.radius)).toEqual([2, 2]);
  expect(f.sketch.dimensions).toHaveLength(1);
});
it.each(["X", "Y", "vector"] as const)("patterns in %s with explicit total count and independently identified geometry", (direction) => {
  const f = fixture(), plan = buildSketchReplication(f.document, f.sketch.id, [f.circleId], { mode: "linear", count: 3, spacing: "6mm", direction, vector: { x: 3, y: 4 } });
  expect(plan.copies).toHaveLength(2); expect(plan.addedEntityIds).toHaveLength(4);
  const delta = direction === "X" ? [6, 0] : direction === "Y" ? [0, 6] : [3.6, 4.8];
  for (const [index, copy] of plan.copies.entries()) {
    const circle = plan.solved.circles.find((entity) => entity.id === copy.entityIds[f.circleId])!;
    expect(circle.center.x).toBeCloseTo(4 + delta[0] * (index + 1), 6); expect(circle.center.y).toBeCloseTo(5 + delta[1] * (index + 1), 6);
  }
  expect(new Set(plan.addedEntityIds).size).toBe(4);
});
it("retains spacing parameter identity and does not accidentally bind the zero-offset coordinate", () => {
  const f = fixture(), document = { ...f.document, parameters: { ...f.document.parameters, pitch: { id: "pitch_parameter", name: "pitch", expression: "6mm", unit: "mm", value: 6 } } };
  const plan = buildSketchReplication(document, f.sketch.id, [f.circleId], { mode: "linear", count: 3, spacing: "pitch", direction: "X" });
  const copyCircle = plan.document.sketches[f.sketch.id].entities[plan.copies[0].entityIds[f.circleId]];
  if (copyCircle.type !== "circle") throw new Error("Expected a circle");
  const point = plan.document.sketches[f.sketch.id].entities[copyCircle.centerPointId];
  if (point.type !== "point") throw new Error("Expected a center point");
  expect(point.x.parameterRefs).toMatchObject({ pitch: "pitch_parameter" }); expect(point.y.parameterRefs).toBeUndefined();
  const changed = { ...document.parameters, pitch: { ...document.parameters.pitch, expression: "8mm" } };
  const solved = solveSketch(plan.document.sketches[f.sketch.id], evaluateParameters(changed).values);
  expect(solved.circles.map((entity) => entity.center.x).sort((a, b) => a - b)).toEqual([4, 12, 20]);
});
it("repairs exact downstream profile signatures only for an unchanged source outer boundary", () => {
  const sketch = addCircleAt(addCornerRectangle(createXySketch(), "24mm", "16mm"), "4mm", "5mm", "1mm"), circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  const sourceProfile = detectProfiles(solveSketch(sketch, {})).profiles.find((profile) => profile.outerLoop.type === "polygon")!;
  const feature = createExtrudeFeature({ name: "Plate", sketchId: sketch.id, profileId: sourceProfile.id, operation: "newBody", distance: { expression: "8mm", unit: "mm" }, direction: "positive" });
  const document = upsertFeature(upsertSketch(createEmptyDocument(), sketch), feature);
  const plan = buildSketchReplication(document, sketch.id, [circle.id], { mode: "linear", count: 3, spacing: "6mm", direction: "X" });
  const repaired = plan.document.features[0];
  expect(repaired.id).toBe(feature.id); expect(repaired.type).toBe("extrude");
  if (repaired.type !== "extrude") throw new Error("Expected Extrude");
  expect(repaired.profileId).not.toBe(feature.profileId);
  const profile = detectProfiles(plan.solved).profiles.find((candidate) => candidate.id === repaired.profileId)!;
  expect(profile.outerLoop).toEqual(sourceProfile.outerLoop); expect(profile.innerLoops).toHaveLength(3);
  expect(document.features[0]).toMatchObject(feature); expect(document.features[0]).not.toBe(repaired);
  const lost = { ...feature, profileId: "lost_profile" };
  expect(() => buildSketchReplication(upsertFeature(document, lost), sketch.id, [circle.id], { mode: "linear", count: 3, spacing: "6mm", direction: "X" })).toThrow("lose its profile reference");
});
it("remaps horizontal constraints and point distances across a 45-degree mirror and refuses oblique directional intent", () => {
  const a = addPoint(createXySketch(), "4mm", "2mm"), b = addPoint(a.sketch, "8mm", "2mm"), target = addLine(b.sketch, a.pointId, b.pointId), axisA = addPoint(target.sketch, "0mm", "0mm"), axisB = addPoint(axisA.sketch, "1mm", "1mm"), axis = addLine(axisB.sketch, axisA.pointId, axisB.pointId);
  const sketch = withCanvasDimension(addConstraint({ ...axis.sketch, solveMode: "driving" }, "horizontal", { entityIds: [target.lineId] }), { type: "horizontalDistance", refs: [a.pointId, b.pointId], expression: "4mm" });
  const document = upsertSketch(createEmptyDocument(), sketch), plan = buildSketchReplication(document, sketch.id, [target.lineId], { mode: "mirror", axisLineId: axis.lineId });
  expect(plan.document.sketches[sketch.id].constraints.at(-1)?.type).toBe("vertical");
  expect(plan.document.sketches[sketch.id].dimensions.at(-1)?.type).toBe("verticalDistance");
  const endpoint = axis.sketch.entities[axisB.pointId]; if (endpoint.type !== "point") throw new Error("Expected point");
  const oblique = { ...sketch, entities: { ...sketch.entities, [endpoint.id]: { ...endpoint, y: { expression: "2mm", unit: "mm" } } } };
  expect(() => buildSketchReplication(upsertSketch(document, oblique), sketch.id, [target.lineId], { mode: "mirror", axisLineId: axis.lineId })).toThrow("Oblique mirror");
});
it("reflects arc orientation and preserves its remapped endpoints", () => {
  const center = addPoint(createXySketch(), "4mm", "4mm"), start = addPoint(center.sketch, "5mm", "4mm"), end = addPoint(start.sketch, "4mm", "5mm"), arc = addArc(end.sketch, center.pointId, start.pointId, end.pointId);
  const a = addPoint(arc.sketch, "0mm", "0mm"), b = addPoint(a.sketch, "0mm", "10mm"), axis = addLine(b.sketch, a.pointId, b.pointId), plan = buildSketchReplication(upsertSketch(createEmptyDocument(), axis.sketch), axis.sketch.id, [arc.arcId], { mode: "mirror", axisLineId: axis.lineId });
  const original = plan.solved.arcs.find((entity) => entity.id === arc.arcId)!, copied = plan.solved.arcs.find((entity) => entity.id === plan.copies[0].entityIds[arc.arcId])!;
  expect(copied.sweep).toBeCloseTo(-original.sweep, 8); expect(copied.center.x).toBeCloseTo(-4, 8); expect(copied.start.x).toBeCloseTo(-5, 8);
});
it("preserves unsigned point distances and unsigned angles through an axis reflection", () => {
  const a = addPoint(createXySketch(), "2mm", "2mm"), b = addPoint(a.sketch, "6mm", "2mm"), c = addPoint(b.sketch, "6mm", "6mm"), one = addLine(c.sketch, a.pointId, b.pointId), two = addLine(one.sketch, b.pointId, c.pointId);
  const start = addPoint(two.sketch, "0mm", "0mm"), end = addPoint(start.sketch, "0mm", "10mm"), axis = addLine(end.sketch, start.pointId, end.pointId);
  let sketch = withCanvasDimension({ ...axis.sketch, solveMode: "driving" }, { type: "horizontalDistance", refs: [a.pointId, b.pointId], expression: "4mm" });
  sketch = withCanvasDimension(sketch, { type: "angle", refs: [one.lineId, two.lineId], expression: "90deg" });
  const document = upsertSketch(createEmptyDocument(), sketch), plan = buildSketchReplication(document, sketch.id, [one.lineId, two.lineId], { mode: "mirror", axisLineId: axis.lineId });
  expect(plan.solved.errors.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(plan.solved.points[plan.copies[0].entityIds[a.pointId]].x).toBeCloseTo(-2, 7);
  expect(plan.solved.points[plan.copies[0].entityIds[b.pointId]].x).toBeCloseTo(-6, 7);
  expect(plan.document.sketches[sketch.id].dimensions.slice(-2).map((dimension) => dimension.expression)).toEqual(sketch.dimensions.map((dimension) => dimension.expression));
  const tied = addConstraint(sketch, "perpendicular", { entityIds: [one.lineId, axis.lineId] });
  expect(() => buildSketchReplication(upsertSketch(document, tied), sketch.id, [one.lineId, two.lineId, axis.lineId], { mode: "mirror", axisLineId: axis.lineId })).toThrow("references the mirror axis");
});
it("refuses cross-selection design intent, no-op axes, invalid count/spacing/direction, and coordinate overflow", () => {
  const f = fixture(), center = f.sketch.entities[f.circleId]; if (center.type !== "circle") throw new Error("Expected circle");
  // A valid equal-radius cross-reference produces a clear selection diagnostic.
  const extra = addCircleAt(f.sketch, "30mm", "5mm", "1mm"), other = Object.values(extra.entities).filter((entity) => entity.type === "circle").at(-1)!;
  const coupled = addConstraint({ ...extra, solveMode: "driving" }, "equalRadius", { entityIds: [f.circleId, other.id] });
  expect(() => buildSketchReplication(upsertSketch(f.document, coupled), f.sketch.id, [f.circleId], { mode: "mirror", axisLineId: f.axisId })).toThrow("crosses the selection");
  for (const spacing of ["0mm", "-1mm", "1deg", "unknown"]) expect(() => buildSketchReplication(f.document, f.sketch.id, [f.circleId], { mode: "linear", count: 3, spacing, direction: "X" })).toThrow("spacing");
  expect(() => buildSketchReplication(f.document, f.sketch.id, [f.circleId], { mode: "linear", count: 17, spacing: "6mm", direction: "X" })).toThrow("count");
  expect(() => buildSketchReplication(f.document, f.sketch.id, [f.circleId], { mode: "linear", count: 3, spacing: "6mm", direction: "vector", vector: { x: 0, y: 0 } })).toThrow("vector");
  expect(() => buildSketchReplication(f.document, f.sketch.id, [f.circleId], { mode: "linear", count: 3, spacing: "100000000mm", direction: "X" })).toThrow("coordinate limits");
  expect(() => buildSketchReplication(f.document, f.sketch.id, [f.axisId], { mode: "mirror", axisLineId: f.axisId })).toThrow("in addition to its axis");
});
it("issues private preview proof, rejects cross-plan mixing and late canceled results, applies once and restores source through Undo", async () => {
  const f = fixture(); useCadStore.getState().setDocument(f.document); const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: f.sketch.id }, selection: { document: state.history.present, entityIds: [f.circleId] } });
  openSketchReplication("linear"); const frame = useSketchReplication.getState().frame!;
  const plan = buildSketchReplication(frame.document, f.sketch.id, frame.selectedIds, { mode: "linear", count: 3, spacing: "6mm", direction: "X" });
  const plain = await rebuildDocument(plan.document); expect(() => applySketchReplication(frame, plan, plain)).toThrow("another proposal");
  const preview = await previewSketchReplication(frame, plan, new AbortController().signal);
  const other = buildSketchReplication(frame.document, f.sketch.id, frame.selectedIds, { mode: "linear", count: 4, spacing: "6mm", direction: "X" });
  expect(() => applySketchReplication(frame, other, preview.result)).toThrow("another proposal");
  expect(preview.native).toBe(false); expect(useCadStore.getState().history.past).toHaveLength(0);
  applySketchReplication(frame, plan, preview.result); expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(() => applySketchReplication(frame, plan, preview.result)).toThrow("changed");
  useCadStore.getState().undo(); expect(useCadStore.getState().history.present).toBe(frame.document);
  useCadStore.getState().redo(); expect(useCadStore.getState().history.present.sketches[f.sketch.id].dimensions).toHaveLength(3);
  const abort = new AbortController(); abort.abort(); await expect(previewSketchReplication(frame, plan, abort.signal)).rejects.toThrow("canceled");
});
it("rejects a late private preview after a same-ID project replacement and a competing owner before preview", async () => {
  const f = fixture(); useCadStore.getState().setDocument(f.document); const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: f.sketch.id }, selection: { document: state.history.present, entityIds: [f.circleId] } });
  openSketchReplication("linear"); const frame = useSketchReplication.getState().frame!;
  const plan = buildSketchReplication(frame.document, f.sketch.id, frame.selectedIds, { mode: "linear", count: 3, spacing: "6mm", direction: "X" });
  useSketchRefinement.setState({ frame: { ...frame } });
  await expect(previewSketchReplication(frame, plan, new AbortController().signal)).rejects.toThrow("copy task changed");
  expect(mocks.preview).not.toHaveBeenCalled(); useSketchRefinement.setState({ frame: undefined });
  let resolve: ((result: RebuildResult) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise<RebuildResult>((done) => { resolve = done; }));
  const promise = previewSketchReplication(frame, plan, new AbortController().signal);
  const result = await rebuildDocument(plan.document);
  useCadStore.getState().setDocument({ ...frame.document });
  resolve?.(result);
  await expect(promise).rejects.toThrow("copy task changed");
  expect(() => applySketchReplication(frame, plan, result)).toThrow("changed");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
