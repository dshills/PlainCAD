import { clearAiSketchCanvasPreview, useAiSketchCanvasPreview } from "../ui/commands/aiSketchCanvasPreview";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SketchRefinementPanel } from "../ui/panels/SketchRefinementPanel";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useSketchRefinement } from "../ui/commands/sketchRefinementCommand";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { RebuildResult } from "../cad/worker/workerProtocol";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  const sketch = addCornerRectangle(createXySketch(), "24mm", "16mm");
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...state.rebuild, kernelReady: true } });
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: undefined });
  useAiDrawer.setState({ open: true });
  useSketchRefinement.setState({ frame: undefined });
  mocks.preview.mockReset();
  mocks.preview.mockImplementation(rebuildDocument);
});
it("previews a solved sketch without editing history, cancels, and applies one undoable edit", async () => {
  render(<SketchRefinementPanel />);
  fireEvent.change(screen.getByLabelText("Sketch refinement request"), { target: { value: "make this rectangle 60 x 40 mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  await waitFor(() => expect(screen.getByLabelText("Sketch refinement status")).toHaveTextContent("No solid was modeled"));
  expect(screen.queryByRole("img", { name: "Solved sketch refinement preview" })).toBeNull();
  expect(useAiSketchCanvasPreview.getState().proposal?.solved.lines).toHaveLength(4);
  const original = useCadStore.getState().history.present;
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(useSketchRefinement.getState().frame).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel refinement" }));
  expect(useCadStore.getState().history.present).toBe(original);
  expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeDisabled();
  expect(useSketchRefinement.getState().frame).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Apply sketch refinement" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(original);
});
it("reports unsupported requests without worker calls and ignores late previews after same-ID replacement", async () => {
  let resolve: ((result: RebuildResult) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise<RebuildResult>((done) => { resolve = done; }));
  render(<SketchRefinementPanel />);
  fireEvent.change(screen.getByLabelText("Sketch refinement request"), { target: { value: "make a rocket" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Supported requests");
  expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Sketch refinement request"), { target: { value: "make this rectangle 60 x 40 mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  const staged = mocks.preview.mock.calls[0][0];
  const result = await rebuildDocument(staged);
  act(() => useCadStore.getState().setDocument({ ...useCadStore.getState().history.present }));
  await act(async () => resolve?.(result));
  expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeDisabled();
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(useSketchRefinement.getState().frame).toBeUndefined();
});

it("requires a visible current canvas proposal before enabling Apply", async () => {
  useAiDrawer.setState({ open: false });
  render(<SketchRefinementPanel />);
  fireEvent.change(screen.getByLabelText("Sketch refinement request"), { target: { value: "make this rectangle 60 x 40 mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("AI canvas context changed"));
  expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeDisabled();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("disables Apply when the main canvas has disposed its proposal", async () => {
  render(<SketchRefinementPanel />);
  fireEvent.change(screen.getByLabelText("Sketch refinement request"), { target: { value: "make this rectangle 60 x 40 mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeEnabled());
  act(() => clearAiSketchCanvasPreview());
  expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeDisabled();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("recognizes redo locally while preserving an active drawing and avoiding geometry requests", () => {
  render(<SketchRefinementPanel />);
  const before = useCadStore.getState().history;
  fireEvent.change(screen.getByLabelText("Sketch refinement request"), { target: { value: "redo that" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  expect(screen.getByLabelText("Sketch refinement status")).toHaveTextContent("The latest AI change cannot be");
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(useCadStore.getState().history).toBe(before);
});

afterEach(() => vi.restoreAllMocks());
it("ignores an empty keyboard submission and clears a timed-out request even if its worker resolves late", async () => {
  let resolve: ((result: RebuildResult) => void) | undefined;
  let expire: (() => void) | undefined;
  const schedule = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === 120000) expire = () => { if (typeof handler === "function") handler(...args); };
    return schedule(handler, delay, ...args) as unknown as ReturnType<typeof window.setTimeout>;
  });
  mocks.preview.mockImplementation(() => new Promise<RebuildResult>((done) => { resolve = done; }));
  render(<SketchRefinementPanel />);
  const input = screen.getByLabelText("Sketch refinement request");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "make this rectangle 60 x 40 mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview sketch refinement" }));
  const result = await rebuildDocument(mocks.preview.mock.calls[0][0]);
  expect(expire).toBeDefined();
  act(() => expire!());
  await act(async () => resolve?.(result));
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
  expect(screen.getByLabelText("Sketch refinement status")).toHaveTextContent("unchanged");
  expect(screen.getByRole("button", { name: "Preview sketch refinement" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Apply sketch refinement" })).toBeDisabled();
  expect(useSketchRefinement.getState().frame).toBeUndefined();
});
