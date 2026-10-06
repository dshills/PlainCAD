import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { openSketchTrimExtend, setSketchTrimExtendPick, useSketchTrimExtend } from "../ui/commands/sketchTrimExtendCommand";
import { useSketchRefinement, useSolidDimensionEdit } from "../ui/commands/interactionDraftState";
import { SketchTrimExtendPanel } from "../ui/panels/SketchTrimExtendPanel";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
let lineId: string;
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchRefinement.setState({ frame: undefined }); useSolidDimensionEdit.setState({ frame: undefined });
  useSketchTrimExtend.setState({ frame: undefined, mode: "trim", pick: undefined });
  let sketch = createXySketch();
  for (const [i, values] of [[0, 0, 30, 0], [10, -2, 10, 2], [20, -2, 20, 2]].entries()) {
    const a = addPoint(sketch, `${values[0]}mm`, `${values[1]}mm`), b = addPoint(a.sketch, `${values[2]}mm`, `${values[3]}mm`), line = addLine(b.sketch, a.pointId, b.pointId);
    sketch = line.sketch; if (!i) lineId = line.lineId;
  }
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...state.rebuild, kernelReady: true } });
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: { document: state.history.present, entityIds: [lineId] } });
  mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
  openSketchTrimExtend("trim");
});
it("uses a canvas pick to preview without history, invalidates changed picks, and applies one undo step", async () => {
  render(<><button aria-label="Draw tool: select">Select</button><button aria-label="Trim sketch lines">Trim</button><SketchTrimExtendPanel /></>);
  act(() => setSketchTrimExtendPick({ x: 15, y: 0 }));
  expect(screen.getByLabelText("Pick X (mm)")).toHaveValue(15);
  const original = useCadStore.getState().history.present;
  fireEvent.click(screen.getByRole("button", { name: "Preview trim" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply trim" })).toBeEnabled());
  expect(useCadStore.getState().history.present).toBe(original);
  act(() => setSketchTrimExtendPick({ x: 5, y: 0 }));
  expect(screen.getByRole("button", { name: "Apply trim" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preview trim" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply trim" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Apply trim" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(useSketchTrimExtend.getState().frame).toBeUndefined();
  await waitFor(() => expect(screen.getByRole("button", { name: "Draw tool: select" })).toHaveFocus());
  act(() => useCadStore.getState().undo()); expect(useCadStore.getState().history.present).toBe(original);
});
it("explains invalid picks without worker calls and Escape cancels without history", async () => {
  render(<><button aria-label="Trim sketch lines">Trim</button><SketchTrimExtendPanel /></>);
  fireEvent.click(screen.getByRole("button", { name: "Preview trim" }));
  expect(screen.getByRole("alert")).toHaveTextContent("both pick coordinates");
  expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Pick X (mm)"), { key: "Escape" });
  expect(useSketchTrimExtend.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history.past).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole("button", { name: "Trim sketch lines" })).toHaveFocus());
});
it("drops an outstanding preview on a same-ID project replacement", async () => {
  let resolve: ((value: Awaited<ReturnType<typeof rebuildDocument>>) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<SketchTrimExtendPanel />);
  act(() => setSketchTrimExtendPick({ x: 15, y: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "Preview trim" }));
  const result = await rebuildDocument(mocks.preview.mock.calls[0][0]);
  act(() => useCadStore.getState().setDocument({ ...useCadStore.getState().history.present }));
  await act(async () => resolve?.(result));
  expect(useSketchTrimExtend.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
