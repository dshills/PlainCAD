import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertSketch } from "../cad/document/CadDocument";
import { addComponent } from "../cad/document/components";
import { addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { finishSketchCanvas, useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { useOperationDrop, operationDropTargets } from "../ui/commands/operationDropCommand";
import { useFileJobs } from "../persistence/fileJobs";
import {
  beginSketchSolidHandoff, cancelSketchSolidHandoff, canMakeSketchSolid,
  chooseSketchSolidRegion, makeSketchSolid, refreshSketchSolidHandoff,
  sketchSolidHandoffCurrent, useSketchSolidHandoff,
} from "../ui/commands/sketchSolidHandoffCommand";
import { SketchSolidHandoffPanel } from "../ui/panels/SketchSolidHandoffPanel";

function drawing(name: string, regions: number) {
  let sketch = createXySketch(name);
  for (let index = 0; index < regions; index++) sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [
    { x: index * 30, y: 0 }, { x: index * 30 + 20, y: 10 },
  ]).sketch;
  return sketch;
}
function fixture(regions = 2) {
  const sketch = drawing("Two regions", regions), other = drawing("Other sketch", 1);
  const document = upsertSketch(upsertSketch(createEmptyDocument(), sketch), other);
  // These tests establish immutable chooser/command boundaries. Browser tests
  // supply the native worker and prove the resulting solid, orientation and STL.
  const result = rebuildDocument(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] },
    activeComponentId: document.rootComponentId,
    selection: { selectedIds: [{ kind: "sketch", id: sketch.id, documentId: document.id }] },
    rebuild: { status: "succeeded", result, kernelReady: true },
  });
  return { sketch, other, document, result };
}
beforeEach(() => {
  useWorkspaceState.setState({ layout: "workbench" });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchSolidHandoff.setState({ source: undefined, selectedTargetId: undefined, error: undefined });
  useOperationDrop.setState({ frame: undefined, hoverId: undefined, error: undefined });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useFileJobs.setState({ exportOpen: false });
  useViewerState.setState({ session: -1, hiddenBodyIds: [], hiddenSketchIds: [], hiddenComponentIds: [] });
});
afterEach(() => { cleanup(); cancelSketchSolidHandoff(); useExtrudeDraft.setState({ draft: undefined }); });

it("Finish Sketch retains the exact source without creating features or history", () => {
  const { sketch, document } = fixture();
  const history = useCadStore.getState().history;
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession } });
  finishSketchCanvas();
  expect(useSketchCanvas.getState().active).toBeUndefined();
  expect(useSketchSolidHandoff.getState().source).toMatchObject({ sketchId: sketch.id, document });
  expect(useCadStore.getState().history).toBe(history);
});
it("keeps existing-feature sketch edits and legacy Full finishing free of a new modeling task", () => {
  const { sketch, document, result } = fixture(1);
  const feature = createExtrudeFeature({ name: "Existing solid", sketchId: sketch.id,
    profileId: result.profiles![sketch.id][0].id, operation: "newBody",
    distance: { expression: "10mm", unit: "mm" }, direction: "positive" });
  const history = { ...useCadStore.getState().history, present: { ...document, features: [feature] } };
  useCadStore.setState({ history });
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession } });
  finishSketchCanvas();
  expect(useSketchSolidHandoff.getState().source).toBeUndefined();
  expect(useOperationDrop.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history).toBe(history);
  useCadStore.setState({ history: { ...history, present: document } });
  useWorkspaceState.setState({ layout: "full" });
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession } });
  finishSketchCanvas();
  expect(useSketchSolidHandoff.getState().source).toBeUndefined();
});
it("scopes highlighted targets to the finished sketch and requires an explicit multi-region choice", () => {
  const { sketch, other } = fixture();
  beginSketchSolidHandoff(sketch.id);
  refreshSketchSolidHandoff(useSketchSolidHandoff.getState().source!);
  const frame = useOperationDrop.getState().frame!;
  expect(frame.handoffSketchId).toBe(sketch.id);
  const targets = operationDropTargets("extrude", useCadStore.getState(), frame.handoffSketchId);
  expect(targets).toHaveLength(2);
  expect(targets.every((target) => target.kind === "profile" && target.sketchId === sketch.id)).toBe(true);
  expect(canMakeSketchSolid()).toBe(false);
  expect(() => makeSketchSolid()).toThrow(/Choose a current highlighted/);
  const foreign = operationDropTargets("extrude").find((target) => target.kind === "profile" && target.sketchId === other.id)!;
  expect(() => chooseSketchSolidRegion(frame, foreign.id)).toThrow(/belonging to this sketch/);
  chooseSketchSolidRegion(frame, targets[1].id);
  expect(canMakeSketchSolid()).toBe(true);
  expect(useExtrudeDraft.getState().draft).toBeUndefined();
  // Normal Project selection is independent of the captured target; it must
  // neither retarget the preview nor alter its current native source guard.
  useCadStore.getState().select({ kind: "sketch", id: other.id, documentId: frame.document.id });
  const history = useCadStore.getState().history;
  makeSketchSolid();
  expect(useExtrudeDraft.getState().draft?.sketchId).toBe(sketch.id);
  expect(useExtrudeDraft.getState().draft?.feature.profileId).toBe(targets[1].kind === "profile" ? targets[1].profileId : undefined);
  expect(useCadStore.getState().history).toBe(history);
  expect(useOperationDrop.getState().frame).toBeUndefined();
  expect(useSketchSolidHandoff.getState().source).toBeUndefined();
});
it("selects the only region while preserving a deliberate Make solid action", () => {
  const { sketch, result } = fixture(1);
  beginSketchSolidHandoff(sketch.id);
  refreshSketchSolidHandoff(useSketchSolidHandoff.getState().source!);
  expect(canMakeSketchSolid()).toBe(true);
  expect(useExtrudeDraft.getState().draft).toBeUndefined();
  const history = useCadStore.getState().history;
  makeSketchSolid();
  expect(useExtrudeDraft.getState().draft?.feature.profileId).toBe(result.profiles![sketch.id][0].id);
  expect(useCadStore.getState().history).toBe(history);
  expect(useSketchSolidHandoff.getState().source).toBeUndefined();
  cancelSketchSolidHandoff();
  expect(useOperationDrop.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history).toBe(history);
});
it("Finish Sketch opens the single-region preview without changing history, while stale rebuilds wait", () => {
  const { sketch, document, result } = fixture(1);
  const history = useCadStore.getState().history;
  const rebuild = useCadStore.getState().rebuild;
  useCadStore.setState({ rebuild: { ...rebuild, status: "queued" } });
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: document.id, session: useCadStore.getState().documentSession } });
  finishSketchCanvas();
  const source = useSketchSolidHandoff.getState().source!;
  refreshSketchSolidHandoff(source);
  expect(useExtrudeDraft.getState().draft).toBeUndefined();
  useCadStore.setState({ rebuild });
  refreshSketchSolidHandoff(source);
  expect(useExtrudeDraft.getState().draft?.feature.profileId).toBe(result.profiles![sketch.id][0].id);
  expect(useCadStore.getState().history).toBe(history);
  expect(useOperationDrop.getState().frame).toBeUndefined();
  expect(useSketchSolidHandoff.getState().source).toBeUndefined();
  useExtrudeDraft.setState({ draft: undefined });
  refreshSketchSolidHandoff(source);
  expect(useExtrudeDraft.getState().draft).toBeUndefined();
});
it("waits for the current rebuild and rejects failed analysis and absent native readiness", () => {
  const { sketch } = fixture();
  beginSketchSolidHandoff(sketch.id);
  const source = useSketchSolidHandoff.getState().source!;
  const rebuild = useCadStore.getState().rebuild;
  for (const status of ["queued", "rebuilding", "failed"] as const) {
    useCadStore.setState({ rebuild: { ...rebuild, status } });
    refreshSketchSolidHandoff(source);
    expect(useOperationDrop.getState().frame).toBeUndefined();
  }
  useCadStore.setState({ rebuild: { ...rebuild, kernelReady: false } });
  refreshSketchSolidHandoff(source);
  expect(useOperationDrop.getState().frame).toBeUndefined();
});
it("replaces a stale native result frame for the same immutable sketch and rejects old callbacks", () => {
  const { sketch } = fixture(1);
  beginSketchSolidHandoff(sketch.id);
  const source = useSketchSolidHandoff.getState().source!;
  refreshSketchSolidHandoff(source);
  const oldFrame = useOperationDrop.getState().frame!;
  const oldTarget = useSketchSolidHandoff.getState().selectedTargetId;
  const rebuild = useCadStore.getState().rebuild;
  useCadStore.setState({ rebuild: { ...rebuild, result: { ...rebuild.result! } } });
  expect(canMakeSketchSolid()).toBe(false);
  refreshSketchSolidHandoff(source);
  expect(useOperationDrop.getState().frame).not.toBe(oldFrame);
  expect(canMakeSketchSolid()).toBe(true);
  expect(() => chooseSketchSolidRegion(oldFrame, oldTarget)).toThrow(/sketch or project changed/);
  expect(useCadStore.getState().history.present.features).toEqual([]);
});
it("rejects document replacement, component changes, new sessions and hidden regions", () => {
  const { sketch } = fixture(1);
  beginSketchSolidHandoff(sketch.id);
  const source = useSketchSolidHandoff.getState().source!;
  refreshSketchSolidHandoff(source);
  const initial = useCadStore.getState();
  const other = addComponent(initial.history.present, "Other");
  for (const patch of [
    { history: { ...initial.history, present: { ...initial.history.present } } },
    { documentSession: initial.documentSession + 1 },
    { activeComponentId: other.component.id },
    { fileBusy: true },
  ]) {
    useCadStore.setState(patch);
    expect(sketchSolidHandoffCurrent(source)).toBe(false);
    expect(canMakeSketchSolid()).toBe(false);
    expect(() => makeSketchSolid()).toThrow(/Choose a current highlighted/);
    useCadStore.setState(initial, true);
  }
  useViewerState.setState({ session: initial.documentSession, hiddenSketchIds: [sketch.id] });
  expect(canMakeSketchSolid()).toBe(false);
});
it("shows empty/open diagnostics and allows cancellation without a profile", () => {
  const { sketch } = fixture(0);
  beginSketchSolidHandoff(sketch.id);
  const history = useCadStore.getState().history;
  render(<SketchSolidHandoffPanel />);
  expect(screen.getByRole("status")).toHaveTextContent(/draw a rectangle, circle, or closed outline/i);
  expect(screen.getByRole("button", { name: "Make solid" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useCadStore.getState().history).toBe(history);
  expect(screen.queryByRole("region", { name: "Make solid from finished sketch" })).toBeNull();
});
it("diagnoses an open boundary and an unavailable plane instead of guessing a solid region", () => {
  const first = addPoint(createXySketch("Open outline"), "0mm", "0mm");
  const second = addPoint(first.sketch, "20mm", "0mm");
  const sketch = addLine(second.sketch, first.pointId, second.pointId).sketch;
  const document = upsertSketch(createEmptyDocument(), sketch), result = rebuildDocument(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId,
    rebuild: { status: "succeeded", result, kernelReady: true } });
  beginSketchSolidHandoff(sketch.id);
  render(<SketchSolidHandoffPanel />);
  expect(screen.getByRole("status")).toHaveTextContent("no usable closed profile");
  expect(useOperationDrop.getState().frame).toBeUndefined();
  act(() => { useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: { ...result, sketchPlanes: {} } } }); });
  expect(screen.getByRole("status")).toHaveTextContent("plane is unavailable");
  expect(screen.getByRole("button", { name: "Make solid" })).toBeDisabled();
});
it("updates keyboard/card selection enablement and clears an invalid source", () => {
  const { sketch } = fixture();
  beginSketchSolidHandoff(sketch.id);
  render(<SketchSolidHandoffPanel />);
  expect(screen.getByRole("button", { name: "Make solid" })).toBeDisabled();
  const cards = screen.getByRole("group", { name: "Closed sketch regions" }).querySelectorAll("button");
  fireEvent.click(cards[1]);
  expect(cards[1]).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Make solid" })).toBeEnabled();
  act(() => { useCadStore.setState({ fileBusy: true }); });
  expect(useSketchSolidHandoff.getState().source).toBeUndefined();
  expect(useOperationDrop.getState().frame).toBeUndefined();
});

it("Edit sketch returns to the captured finished sketch after unrelated project selection", () => {
  const { sketch, other, document } = fixture();
  beginSketchSolidHandoff(sketch.id);
  const history = useCadStore.getState().history;
  render(<SketchSolidHandoffPanel />);
  act(() => { useCadStore.getState().select({ kind: "sketch", id: other.id, documentId: document.id }); });
  fireEvent.click(screen.getByRole("button", { name: "Edit sketch" }));
  expect(useSketchCanvas.getState().active?.sketchId).toBe(sketch.id);
  expect(useCadStore.getState().history).toBe(history);
  expect(useOperationDrop.getState().frame).toBeUndefined();
});
