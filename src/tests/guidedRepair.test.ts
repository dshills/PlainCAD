import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { createXySketch } from "../cad/sketch/SketchModel";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { suggestClosingEdge } from "../cad/sketch/repairSuggestions";
import { useCadStore } from "../state/useCadStore";
import { beginSketchCanvas, useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { addRepairClosingEdge, focusRepairIssue, repairGuidance, useRepairFocus, type RepairContext } from "../ui/commands/repairCommand";
import { useFileJobs } from "../persistence/fileJobs";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { useHoleDraft } from "../ui/commands/holeCommand";
import { useModelingDraft } from "../ui/commands/modelingDraftCommand";
import { useGuidedHole } from "../ui/commands/guidedHoleCommand";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { sketchPlaneTransform } from "../cad/sketch/planes";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";

function openChain() {
  let sketch = createXySketch("Open outline");
  for (const [a,b] of [[[0,0],[20,0]],[[20,0],[20,10]],[[20,10],[0,10]]]) {
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "line", [{ x:a[0], y:a[1] }, { x:b[0], y:b[1] }]).sketch;
  }
  return sketch;
}
function fixture(): RepairContext {
  const sketch = openChain(), document = upsertSketch(createEmptyDocument(), sketch), solved = solveSketch(sketch, {});
  const issue = { id: "profile:open", source: "sketch" as const, sourceId: sketch.id, message: "Sketch contains an open profile. Add the missing edge before extruding." };
  const result = { documentId: document.id, success: true, bodies: [], meshes: [], durationMs: 0, errors: [], warnings: [issue], profiles: { [sketch.id]: [] }, solvedSketches: { [sketch.id]: solved }, sketchPlanes: { [sketch.id]: sketchPlaneTransform("XY") } };
  useCadStore.setState({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, rebuild: { status: "succeeded", kernelReady: true, result } });
  return { document, result, session: useCadStore.getState().documentSession, issueId: "profile:open" };
}
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useRepairFocus.setState({ focus: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useHoleDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
  useGuidedHole.setState({ draft: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useFileJobs.setState({ busy: false, exportOpen: false });
});
afterEach(() => { useSketchCanvas.setState({ active: undefined, selection: undefined }); useRepairFocus.setState({ focus: undefined }); });

describe("guided sketch repair", () => {
  it("proposes only the endpoints of a single open chain without changing geometry", () => {
    const sketch = openChain(), original = JSON.stringify(sketch), solved = solveSketch(sketch, {}), suggestion = suggestClosingEdge(sketch, solved);
    expect(suggestion?.distance).toBe(10);
    expect(suggestion).toBeDefined();
    expect([solved.points[suggestion!.startId], solved.points[suggestion!.endId]].map((p) => [p.x,p.y]).sort((a,b) => a[1]-b[1])).toEqual([[0,0],[0,10]]);
    expect(JSON.stringify(sketch)).toBe(original);
    expect(detectProfiles(solved).profiles).toHaveLength(0);
  });
  it("does not propose repairs for branches, closed loops, multiple chains or circles", () => {
    const sketch = openChain(), solved = solveSketch(sketch, {});
    for (const [name, extra] of [
      ["branch", addCanvasGeometry(sketch, solved, "line", [{x:20,y:0},{x:30,y:0}]).sketch],
      ["closed loop", addCanvasGeometry(sketch, solved, "line", [{x:0,y:0},{x:0,y:10}]).sketch],
      ["multiple chains", addCanvasGeometry(sketch, solved, "line", [{x:40,y:0},{x:40,y:10}]).sketch],
      ["circle", addCanvasGeometry(sketch, solved, "circle", [{x:40,y:0},{x:45,y:0}]).sketch],
    ] as const) expect(suggestClosingEdge(extra, solveSketch(extra, {})), name).toBeUndefined();
  });
  it("focuses endpoints, explicitly closes the profile in one Undo and preserves save/open IDs", () => {
    const context = fixture(), sketch = Object.values(context.document.sketches)[0], before = useCadStore.getState().history;
    expect(() => addRepairClosingEdge(context)).toThrow(/Show the open endpoints/);
    focusRepairIssue(context);
    expect(useSketchCanvas.getState().selection?.entityIds).toHaveLength(2);
    expect(useCadStore.getState().history).toBe(before);
    addRepairClosingEdge(context);
    const next = useCadStore.getState().history;
    expect(next.past).toEqual([context.document]);
    expect(next.present.sketches[sketch.id].dimensions).toEqual(sketch.dimensions);
    expect(next.present.sketches[sketch.id].constraints).toEqual(sketch.constraints);
    expect(Object.keys(next.present.sketches[sketch.id].entities)).toHaveLength(Object.keys(sketch.entities).length + 1);
    expect(detectProfiles(solveSketch(next.present.sketches[sketch.id], {})).profiles).toHaveLength(1);
    expect(importProjectText(serializeProject(next.present))).toEqual(next.present);
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(context.document);
  });
  it("rejects stale cards, replacement sessions and competing tasks without editing history", () => {
    const context = fixture(), original = useCadStore.getState().history;
    useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "queued" } });
    expect(() => focusRepairIssue(context)).toThrow(/Model changed/);
    useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: context.result }, documentSession: context.session + 1 });
    expect(() => focusRepairIssue(context)).toThrow(/Model changed/);
    useCadStore.setState({ documentSession: context.session });
    useFileJobs.setState({ exportOpen: true });
    expect(() => focusRepairIssue(context)).toThrow(/Finish or cancel/);
    expect(useCadStore.getState().history).toBe(original);
  });
  it("requires the exact shown outline when another sketch in the same project is opened", () => {
    const first = fixture(), second = openChain(), document = upsertSketch(first.document, second);
    const warning = { id: "profile:second", source: "sketch" as const, sourceId: second.id, message: "Open profile." };
    const result = { ...first.result, warnings: [...first.result.warnings, warning],
      solvedSketches: { ...first.result.solvedSketches, [second.id]: solveSketch(second, {}) },
      profiles: { ...first.result.profiles, [second.id]: [] },
      sketchPlanes: { ...first.result.sketchPlanes, [second.id]: sketchPlaneTransform("XY") } };
    useCadStore.setState({ history: { past: [], present: document, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result } });
    focusRepairIssue({ ...first, document, result });
    beginSketchCanvas(second.id);
    const history = useCadStore.getState().history;
    expect(() => addRepairClosingEdge({ ...first, document, result, issueId: warning.id })).toThrow(/Show the open endpoints/);
    expect(useCadStore.getState().history).toBe(history);
  });
  it("maps solver dimension and constraint IDs to precise guidance without assuming a unique cause", () => {
    const context = fixture(), sketch = Object.values(context.document.sketches)[0], line = Object.values(sketch.entities).find((e) => e.type === "line")!;
    const document = upsertSketch(context.document, { ...sketch, dimensions: [{ id: "size", type: "length", entityIds: [line.id], expression: { expression: "10mm", unit: "mm" } }], constraints: [{ id: "horizontal", type: "horizontal", entityIds: [line.id] }] });
    const issue = { id:"conflict", source:"sketch" as const, sourceId:sketch.id, message:"conflicting dimensions", details:{ constraintId:"size" } };
    const advice = repairGuidance(issue, document, context.result);
    expect(advice.dimension?.id).toBe("size");
    expect(advice.guidance).toContain("several contributors");
    expect(repairGuidance({ ...issue, details:{ constraintId:"horizontal" } }, document, context.result).constraint?.id).toBe("horizontal");
    const entityAdvice = repairGuidance({ ...issue, details:{ entityId:"size" } }, document, context.result);
    expect(entityAdvice.dimension).toBeUndefined();
    expect(entityAdvice.constraint).toBeUndefined();
    expect(entityAdvice.references.entityId).toBe("size");
  });
});
