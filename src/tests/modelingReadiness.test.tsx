import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { addComponent } from "../cad/document/components";
import { createMountingPlateTemplate } from "../templates/templates";
import type { Sketch } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { useWorkbenchState } from "../state/useWorkbenchState";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
import { nextModelingAction, modelingPrerequisite } from "../ui/workspace/modelingReadiness";
import { TaskGuide } from "../ui/workspace/WorkbenchDetailsDock";

function fixture(sketch?: Sketch) {
  const empty = createEmptyDocument();
  const document = sketch ? upsertSketch(empty, sketch) : empty;
  const result = rebuildDocument(document);
  useCadStore.setState({
    history: { past: [], present: document, future: [] },
    activeComponentId: document.rootComponentId,
    selection: { selectedIds: sketch ? [{ kind: "sketch", id: sketch.id, documentId: document.id }] : [] },
    rebuild: { status: result.success ? "succeeded" : "failed", result, kernelReady: false },
  });
  return useCadStore.getState();
}
function openSketch() {
  const first = addPoint(createXySketch(), "0mm", "0mm");
  const second = addPoint(first.sketch, "20mm", "0mm");
  return addLine(second.sketch, first.pointId, second.pointId).sketch;
}
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useWorkbenchState.setState({ bottomOpen: false, bottomTab: "history" });
});
afterEach(() => {
  cleanup();
  useSketchCanvas.setState({ active: undefined });
});

describe("current modeling readiness", () => {
  it("guides an empty part and distinguishes empty and construction-only sketches", () => {
    expect(nextModelingAction(fixture()).state).toBe("empty-project");
    expect(nextModelingAction(fixture(createXySketch())).state).toBe("empty-sketch");
    const drawing = openSketch();
    const construction = { ...drawing, entities: Object.fromEntries(Object.entries(drawing.entities).map(([id, entity]) => [id, { ...entity, construction: true }])) };
    expect(nextModelingAction(fixture(construction))).toMatchObject({ state: "empty-sketch", command: "sketch.editCanvas" });
  });
  it("uses actual detected profiles, allowing underconstrained closed geometry without presenting it as fully constrained", () => {
    const state = fixture(openSketch());
    expect(state.rebuild.result?.profiles?.[Object.keys(state.history.present.sketches)[0]]).toEqual([]);
    expect(nextModelingAction(state)).toMatchObject({ state: "open-sketch", command: "sketch.editCanvas" });
    expect(modelingPrerequisite("feature.extrude", state, selectCommandEnablement(state))).toContain("usable closed profile");
    const closed = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    expect(nextModelingAction(closed)).toMatchObject({ state: "ready-sketch", command: "feature.extrude" });
    expect(nextModelingAction(closed).note).toContain("may Extrude now");
    expect(modelingPrerequisite("feature.extrude", closed, selectCommandEnablement(closed))).toBeUndefined();
  });
  it("links solver failures to their repair issue instead of recommending Extrude", () => {
    const sketch = addCornerRectangle(createXySketch(), "missing_width", "10mm");
    const state = fixture(sketch);
    expect(state.rebuild.status).toBe("failed");
    const guide = nextModelingAction(state);
    expect(guide).toMatchObject({ state: "broken-sketch", command: "repair.focus", sketchId: sketch.id });
    expect(guide.issue?.sourceId).toBe(sketch.id);
  });
  it("does not use prior successful profiles while a rebuild is pending or from another document", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    for (const status of ["queued", "rebuilding", "loadingKernel"] as const) {
      expect(nextModelingAction({ ...state, rebuild: { ...state.rebuild, status } }).state).toBe("waiting");
    }
    expect(nextModelingAction({ ...state, rebuild: { ...state.rebuild, result: { ...state.rebuild.result!, documentId: "other-project" } } }).state).toBe("waiting");
  });
  it("does not let a valid sketch hide a failed feature or kernel", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    const guide = nextModelingAction({ ...state, rebuild: { status: "failed", kernelReady: true, message: "Kernel crashed" } });
    expect(guide).toMatchObject({ state: "failed-model", description: "Kernel crashed" });
    expect(guide.note).toContain("successful rebuild");
    const issue = { id: "kernel-error", source: "kernel" as const, sourceId: "uneditable-body", message: "Unavailable geometry" };
    expect(nextModelingAction({ ...state, rebuild: { ...state.rebuild, status: "failed", result: { ...state.rebuild.result!, success: false, errors: [issue] } } }).command).toBeUndefined();
  });
  it("reports failed parameter evaluation before treating missing sketch analysis as a lost plane", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    const issue = { id: "bad-parameter", source: "parameter" as const, sourceId: "width", message: "Unknown expression in width" };
    const document = { ...state.history.present, parameters: { width: { id: "width", name: "width", expression: "missing", unit: "mm", value: 0 } } };
    expect(nextModelingAction({ ...state, history: { ...state.history, present: document }, rebuild: { ...state.rebuild, status: "failed", result: { ...state.rebuild.result!, success: false, errors: [issue], solvedSketches: {}, sketchPlanes: {} } } })).toMatchObject({ state: "failed-model", description: issue.message, command: "repair.focus" });
  });
  it("does not treat missing plane references as ready profiles", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    expect(nextModelingAction({ ...state, rebuild: { ...state.rebuild, result: { ...state.rebuild.result!, sketchPlanes: {} } } })).toMatchObject({ state: "broken-sketch", command: undefined });
  });
  it("distinguishes selected feature editing, native solids and fallback geometry", () => {
    const document = createMountingPlateTemplate();
    const result = rebuildDocument(document);
    const state = fixture();
    const snapshot = { ...state, history: { ...state.history, present: document }, activeComponentId: document.rootComponentId,
      rebuild: { ...state.rebuild, result }, selection: { selectedIds: [] } };
    expect(nextModelingAction(snapshot)).toMatchObject({ state: "ready-solid", title: "Inspect geometry availability", command: undefined });
    const nativeResult = { ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, solidCount: 1, volume: 1, surfaceArea: 1 } })) };
    expect(nextModelingAction({ ...snapshot, rebuild: { ...snapshot.rebuild, result: nativeResult } })).toMatchObject({ state: "ready-solid", title: "Refine your solid", command: "feature.guidedHole" });
    expect(nextModelingAction({ ...snapshot, selection: { selectedIds: [{ kind: "feature", id: document.features[0].id, documentId: document.id }] } })).toMatchObject({ state: "feature", command: "feature.edit" });
  });
  it("keeps component-scoped guidance separate from the empty-project onboarding", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    const added = addComponent(state.history.present, "Second part");
    expect(nextModelingAction({ ...state, history: { ...state.history, present: added.document }, activeComponentId: added.component.id, selection: { selectedIds: [] } })).toMatchObject({ state: "choose", title: "Draw in this component", command: "sketch.create" });
  });
  it("waits for absent plane analysis while diagnosing an explicitly lost plane", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    expect(nextModelingAction({ ...state, rebuild: { ...state.rebuild, result: { ...state.rebuild.result!, sketchPlanes: undefined } } })).toMatchObject({ state: "waiting", title: "Checking this sketch" });
    expect(nextModelingAction({ ...state, rebuild: { ...state.rebuild, result: { ...state.rebuild.result!, sketchPlanes: {} } } })).toMatchObject({ state: "broken-sketch", command: undefined });
  });
  it("rejects selections from a replaced project and keeps guide inspection out of history", () => {
    const state = fixture(addCornerRectangle(createXySketch(), "20mm", "10mm"));
    const history = state.history;
    expect(nextModelingAction({ ...state, selection: { selectedIds: [{ ...state.selection.selectedIds[0], documentId: "replaced-project" }] } }).state).toBe("choose");
    expect(useCadStore.getState().history).toBe(history);
  });
});

it("shows disabled prerequisites and permits drawing repair without changing project history", () => {
  const state = fixture(openSketch());
  render(<TaskGuide />);
  expect(screen.getByRole("heading", { name: "Close or repair your outline" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Extrude sketch" })).toBeDisabled();
  expect(screen.getAllByText(/Select a sketch with a usable closed profile/)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Open Issues" }));
  expect(useWorkbenchState.getState()).toMatchObject({ bottomOpen: true, bottomTab: "issues" });
  fireEvent.click(screen.getByRole("button", { name: "Edit sketch" }));
  expect(useSketchCanvas.getState().active?.sketchId).toBe(Object.keys(state.history.present.sketches)[0]);
  expect(useCadStore.getState().history).toBe(state.history);
});
it("updates its guide and disabled explanations when current worker analysis or selection changes", () => {
  fixture(createXySketch());
  render(<TaskGuide />);
  expect(screen.getByRole("heading", { name: "Draw your outline" })).toBeVisible();
  act(() => { fixture(addCornerRectangle(createXySketch(), "20mm", "10mm")); });
  expect(screen.getByRole("heading", { name: "Make it solid" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Extrude sketch" })).toBeEnabled();
  act(() => { useCadStore.setState({ fileBusy: true }); });
  expect(screen.getByRole("button", { name: "Edit sketch canvas" })).toBeDisabled();
  fireEvent.click(screen.getByText("More options"));
  expect(screen.getAllByText("Wait for the current file operation to finish.").length).toBeGreaterThan(0);
});
