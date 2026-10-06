import { beforeEach, expect, it, vi } from "vitest";
import { buildSketchRefinement } from "../ai/sketchRefinement";
import { createEmptyDocument, upsertSketch, createExtrudeFeature, upsertFeature } from "../cad/document/CadDocument";
import { addCornerRectangle, addConstraint, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { applySketchRefinement, captureSketchRefinementFrame, currentSketchRefinementFrame, previewSketchRefinement, assertSketchRefinementPreview, useSketchRefinement } from "../ui/commands/sketchRefinementCommand";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { rebuildDocument } from "../cad/features/rebuildGraph";

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));

function fixture() {
  const sketch = addCornerRectangle(createXySketch("Rectangle"), "24mm", "16mm");
  return { sketch, document: upsertSketch(createEmptyDocument(), sketch) };
}
beforeEach(() => {
  mocks.preview.mockImplementation(rebuildDocument);
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useSketchRefinement.setState({ frame: undefined });
});
it("adds driving sizes/relations while preserving entity and dimension IDs on later refinements", () => {
  const { sketch, document } = fixture();
  const first = buildSketchRefinement(document, sketch.id, [], "make this rectangle 60 x 40 mm");
  const updated = first.document.sketches[sketch.id];
  expect(Object.keys(updated.entities)).toEqual(Object.keys(sketch.entities));
  expect(updated.constraints).toHaveLength(4);
  expect(updated.dimensions).toHaveLength(2);
  const profile = detectProfiles(solveSketch(updated, {})).profiles[0];
  expect(profile.bounds.maxX - profile.bounds.minX).toBeCloseTo(60, 5);
  expect(profile.bounds.maxY - profile.bounds.minY).toBeCloseTo(40, 5);
  const second = buildSketchRefinement(first.document, sketch.id, [], "RESIZE selected rectangle 3 x 2 CM");
  expect(second.document.sketches[sketch.id].dimensions.map((d) => d.id)).toEqual(updated.dimensions.map((d) => d.id));
  const bounds = detectProfiles(solveSketch(second.document.sketches[sketch.id], {})).profiles[0].bounds;
  expect(bounds.maxX - bounds.minX).toBeCloseTo(30, 5);
  expect(bounds.maxY - bounds.minY).toBeCloseTo(20, 5);
  expect(sketch.dimensions).toHaveLength(0);
});
it("rejects unsupported text, missing selections, ambiguity and conflicting fixed geometry", () => {
  const { sketch, document } = fixture();
  expect(() => buildSketchRefinement(document, sketch.id, [], "make a rocket")).toThrow("Supported requests");
  expect(() => buildSketchRefinement(document, sketch.id, [], "make selected lines horizontal")).toThrow("Select one or more lines");
  expect(() => buildSketchRefinement(document, sketch.id, [], "make this rectangle 0 x 40 mm")).toThrow("positive");
  const fixed = addConstraint(sketch, "fixed", { entityIds: Object.keys(sketch.entities) });
  expect(() => buildSketchRefinement(upsertSketch(document, fixed), sketch.id, [], "make this rectangle 60 x 40 mm")).toThrow("conflicts");
  const other = addCornerRectangle(createXySketch(), "10mm", "10mm");
  const merged = { ...sketch, entities: { ...sketch.entities, ...other.entities } };
  expect(() => buildSketchRefinement(upsertSketch(document, merged), sketch.id, [], "make this rectangle 60 x 40 mm")).toThrow("ambiguous");
});
it("preserves bound dimensions with an explicit diagnostic", () => {
  const { sketch, document } = fixture();
  const lineId = Object.values(sketch.entities).find((e) => e.type === "line")!.id;
  const bounded = withCanvasDimension(sketch, { type: "length", refs: [lineId], expression: "width" });
  const parameters = { width: { id: "width_parameter", name: "width", expression: "24mm", unit: "mm", value: 24 } };
  expect(() => buildSketchRefinement(upsertSketch({ ...document, parameters }, bounded), sketch.id, [], "make this rectangle 60 x 40 mm")).toThrow("parameter-bound");
  expect(bounded.dimensions[0].expression.expression).toBe("width");
});
it("adds selected-line relations with observable solved orientation and rejects duplicate intent", () => {
  let sketch = createXySketch();
  const a = addPoint(sketch, "0mm", "0mm"), b = addPoint(a.sketch, "20mm", "5mm");
  const line = addLine(b.sketch, a.pointId, b.pointId); sketch = line.sketch;
  const plan = buildSketchRefinement(upsertSketch(createEmptyDocument(), sketch), sketch.id, [line.lineId], "make selected lines horizontal");
  const solved = solveSketch(plan.document.sketches[sketch.id], {});
  expect(solved.lines[0].start.y).toBeCloseTo(solved.lines[0].end.y, 6);
  expect(() => buildSketchRefinement(plan.document, sketch.id, [line.lineId], "make selected lines horizontal")).toThrow("already present");
});
it("accepts a bare sketch solve without claiming native solid geometry, applies once, and rejects stale same-ID replacements", async () => {
  const { sketch, document } = fixture();
  useCadStore.getState().setDocument(document);
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession } });
  const frame = captureSketchRefinementFrame();
  useSketchRefinement.setState({ frame });
  const plan = buildSketchRefinement(frame.document, sketch.id, [], "make this rectangle 60 x 40 mm");
  const { result } = await previewSketchRefinement(plan, new AbortController().signal);
  expect(assertSketchRefinementPreview(plan, result)).toMatchObject({ native: false, volume: 0, solved: { id: sketch.id } });
  const before = useCadStore.getState().history.past.length;
  applySketchRefinement(frame, plan, result);
  expect(useCadStore.getState().history.past).toHaveLength(before + 1);
  expect(() => applySketchRefinement(frame, plan, result)).toThrow("changed");
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present.sketches[sketch.id].dimensions).toEqual(sketch.dimensions);
  useCadStore.getState().setDocument({ ...document });
  expect(currentSketchRefinementFrame(frame)).toBe(false);
  expect(() => applySketchRefinement(frame, plan, result)).toThrow("changed");
});
it("rejects a successful preview with missing sketch solve or fallback downstream meshes", async () => {
  const { sketch, document } = fixture();
  const plan = buildSketchRefinement(document, sketch.id, [], "make this rectangle 60 x 40 mm");
  const result = await rebuildDocument(plan.document);
  expect(() => assertSketchRefinementPreview(plan, { ...result, solvedSketches: {} })).toThrow("current sketch solve");
  const feature = createExtrudeFeature({ name: "Base", sketchId: sketch.id, profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id, distance: { expression: "8mm", unit: "mm" }, direction: "positive", operation: "newBody" });
  const downstream = buildSketchRefinement(upsertFeature(document, feature), sketch.id, [], "make this rectangle 60 x 40 mm");
  const fallback = await rebuildDocument(downstream.document);
  expect(fallback.success).toBe(true);
  expect(fallback.meshes[0].geometrySource).toBe("fallback");
  expect(() => assertSketchRefinementPreview(downstream, fallback)).toThrow("valid native solid");
});

it("invalidates refinement frames when selection or the active sketch changes", () => {
  const { sketch, document } = fixture();
  useCadStore.getState().setDocument(document);
  const active = { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession };
  useSketchCanvas.setState({ active });
  const frame = captureSketchRefinementFrame();
  const lineId = Object.values(sketch.entities).find((e) => e.type === "line")!.id;
  useSketchCanvas.setState({ selection: { document: frame.document, entityIds: [lineId] } });
  expect(currentSketchRefinementFrame(frame)).toBe(false);
  useSketchCanvas.setState({ selection: undefined, active: undefined });
  expect(currentSketchRefinementFrame(frame)).toBe(false);
});

it("does not reinterpret legacy validate-mode sketches for already-present relations", () => {
  const { sketch, document } = fixture();
  const id = Object.values(sketch.entities).find((e) => e.type === "line")!.id;
  const legacy = { ...addConstraint(sketch, "horizontal", { entityIds: [id] }), solveMode: "validate" as const };
  expect(() => buildSketchRefinement(upsertSketch(document, legacy), sketch.id, [id], "make selected lines horizontal")).toThrow("already present");
  expect(legacy.solveMode).toBe("validate");
});

it("restores rectangle and selected-line geometry when Undo receives the most recent solve seed", () => {
  const { sketch, document } = fixture();
  const changed = buildSketchRefinement(document, sketch.id, [], "make this rectangle 60 x 40 mm");
  const recent = solveSketch(changed.document.sketches[sketch.id], {});
  const undo = solveSketch(sketch, {}, { seed: recent });
  expect(undo.seedUsed).toBe(false);
  const bounds = detectProfiles(undo).profiles[0].bounds;
  expect(bounds.maxX - bounds.minX).toBeCloseTo(24, 5);
  expect(bounds.maxY - bounds.minY).toBeCloseTo(16, 5);
  const a = addPoint(createXySketch(), "0mm", "0mm"), b = addPoint(a.sketch, "20mm", "5mm");
  const line = addLine(b.sketch, a.pointId, b.pointId);
  const original = line.sketch;
  const horizontal = buildSketchRefinement(upsertSketch(createEmptyDocument(), original), original.id, [line.lineId], "make selected lines horizontal");
  const lineSeed = solveSketch(horizontal.document.sketches[original.id], {});
  const undone = solveSketch(original, {}, { seed: lineSeed });
  expect(undone.seedUsed).toBe(false);
  expect(undone.lines[0].start.y).toBeCloseTo(0, 6);
  expect(undone.lines[0].end.y).toBeCloseTo(5, 6);
});

it("rejects old-base plans, cross-plan results and unproven same-ID geometry without publishing", async () => {
  const { sketch, document } = fixture();
  useCadStore.getState().setDocument(document);
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession } });
  const frame = captureSketchRefinementFrame();
  useSketchRefinement.setState({ frame });
  const plan = buildSketchRefinement(frame.document, sketch.id, [], "make this rectangle 60 x 40 mm");
  const other = buildSketchRefinement(frame.document, sketch.id, [], "make this rectangle 30 x 20 mm");
  const { result } = await previewSketchRefinement(plan, new AbortController().signal);
  expect(() => applySketchRefinement(frame, other, result)).toThrow("does not match");
  expect(() => applySketchRefinement(frame, plan, { ...result })).toThrow("does not match");
  expect(useCadStore.getState().history.past).toHaveLength(0);
  useCadStore.getState().updateDocument((current) => ({ ...current, name: "Unrelated newer edit" }));
  const current = captureSketchRefinementFrame();
  useSketchRefinement.setState({ frame: current });
  expect(() => applySketchRefinement(current, plan, result)).toThrow("another project or sketch revision");
  const wrongSketch = { ...plan, base: current.document, sketchId: "removed_sketch" };
  expect(() => applySketchRefinement(current, wrongSketch, result)).toThrow("another project or sketch revision");
  expect(useCadStore.getState().history.present.name).toBe("Unrelated newer edit");
  expect(useCadStore.getState().history.past).toHaveLength(1);
});
