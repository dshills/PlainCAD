import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { CanvasSelectionActions } from "../ui/panels/CanvasSelectionActions";
import { selectedCanvasActionTarget } from "../ui/commands/canvasActionTarget";
import { canvasContextCurrent, currentCanvasContextTarget, openCanvasContext, useCanvasContext } from "../ui/commands/canvasContextState";
import { runCanvasBodyAction } from "../ui/commands/canvasActionCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useInspectionState } from "../state/inspectionState";

function setup() {
  const document = createBoxTemplate(), fallback = rebuildDocument(document);
  const result = { ...fallback, meshes: fallback.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 24000, surfaceArea: 10000, solidCount: 1 } })) };
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 21, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result }, selection: { selectedIds: [{ kind: "body", id: result.bodies[0].id, documentId: document.id }] } });
  useViewerState.getState().openDocument(document, 21);
  return { document, result };
}
beforeEach(() => { useViewerState.setState(useViewerState.getInitialState()); useCadStore.setState(useCadStore.getInitialState()); useSketchCanvas.setState({ active: undefined, selection: undefined }); useInspectionState.setState({ picking: false }); useCanvasContext.setState({ menu: undefined }); });
afterEach(() => { cleanup(); useViewerState.setState(useViewerState.getInitialState()); useCadStore.setState(useCadStore.getInitialState()); useCanvasContext.setState({ menu: undefined }); });
it("offers contextual native part actions and hides without adding undo history", async () => {
  const { document } = setup(); render(<CanvasSelectionActions />);
  expect(screen.getByRole("toolbar", { name: "Selected geometry actions" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Hide part" }));
  await act(async () => { await Promise.resolve(); });
  expect(useViewerState.getState().hiddenBodyIds).toHaveLength(1);
  expect(useCadStore.getState().history.present).toBe(document);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(screen.queryByRole("toolbar")).toBeNull();
});
it("rejects an old context after result, selection or project replacement", async () => {
  setup(); const target = selectedCanvasActionTarget(useCadStore.getState())!, context = currentCanvasContextTarget()!;
  useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...target.result } } });
  expect(canvasContextCurrent(context)).toBe(false);
  await expect(runCanvasBodyAction("delete", target)).rejects.toThrow("changed");
  expect(useCadStore.getState().history.past).toHaveLength(0);
  setup(); const selected = currentCanvasContextTarget()!;
  useCadStore.getState().select(undefined); expect(canvasContextCurrent(selected)).toBe(false);
  setup(); const session = currentCanvasContextTarget()!;
  useCadStore.setState({ documentSession: 22 }); expect(canvasContextCurrent(session)).toBe(false);
  setup(); const project = currentCanvasContextTarget()!;
  useCadStore.setState({ history: { past: [], present: createBoxTemplate(), future: [] } }); expect(canvasContextCurrent(project)).toBe(false);
});
it("rejects fallback and hidden geometry and keeps measurement picking free of canvas actions", () => {
  const { result } = setup();
  useViewerState.getState().toggleBody(21, result.bodies[0].id, [result.bodies[0].id]);
  expect(selectedCanvasActionTarget(useCadStore.getState())).toBeUndefined();
  useViewerState.getState().showAllBodies(21);
  useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "fallback" as const })) } } });
  expect(selectedCanvasActionTarget(useCadStore.getState())).toBeUndefined();
  setup(); useInspectionState.setState({ picking: true }); render(<CanvasSelectionActions />);
  expect(screen.queryByRole("toolbar")).toBeNull();
});
it("supports keyboard menu navigation and dismisses a menu when its selection becomes stale", () => {
  setup(); render(<CanvasSelectionActions />);
  act(() => openCanvasContext(50, 50)); const menu = screen.getByRole("menu", { name: "Canvas actions" });
  expect(screen.getByRole("menuitem", { name: "Edit base feature" })).toHaveFocus();
  fireEvent.keyDown(menu, { key: "End" }); expect(screen.getByRole("menuitem", { name: "Close menu" })).toHaveFocus();
  act(() => useCadStore.getState().select(undefined));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("declines ambiguous body multi-selection and toggles More actions closed", () => {
  setup(); render(<CanvasSelectionActions />);
  const more = screen.getByRole("button", { name: "More actions" });
  fireEvent.click(more); expect(screen.getByRole("menu")).toBeVisible();
  fireEvent.pointerDown(more); fireEvent.click(more); expect(screen.queryByRole("menu")).toBeNull();
  act(() => { const selection = useCadStore.getState().selection.selectedIds[0]; useCadStore.setState({ selection: { selectedIds: [selection, selection] } }); });
  expect(selectedCanvasActionTarget(useCadStore.getState())).toBeUndefined();
});
