import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { SketchReplicationPanel } from "../ui/panels/SketchReplicationPanel";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCircleAt, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { openSketchReplication, useSketchReplication } from "../ui/commands/sketchReplicationCommand";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { useSketchRefinement } from "../ui/commands/interactionDraftState";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true); useSketchReplication.setState({ frame: undefined, mode: "mirror" }); useSketchRefinement.setState({ frame: undefined });
  const circle = addCircleAt(createXySketch(), "4mm", "5mm", "1mm");
  const a = addPoint(circle, "12mm", "0mm"), b = addPoint(a.sketch, "12mm", "10mm"), axis = addLine(b.sketch, a.pointId, b.pointId);
  const sketch = { ...axis.sketch, entities: { ...axis.sketch.entities, [axis.lineId]: { ...axis.sketch.entities[axis.lineId], construction: true } } };
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch)); const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...state.rebuild, kernelReady: true } });
  const circleId = Object.values(circle.entities).find((entity) => entity.type === "circle")!.id;
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: { document: state.history.present, entityIds: [circleId] } });
  mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
});
it("makes creation-time copy semantics explicit, previews without history, and applies one undo edit", async () => {
  openSketchReplication("linear");
  render(<><button aria-label="Draw tool: select">Select</button><SketchReplicationPanel /></>);
  expect(screen.getByText(/Creation-time copies/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Pattern spacing"), { target: { value: "6mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview copies" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply copies" })).toBeEnabled());
  expect(screen.getByRole("status", { name: "Sketch copy status" })).toHaveTextContent("No solid was modeled");
  const original = useCadStore.getState().history.present;
  expect(useCadStore.getState().history.past).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Apply copies" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole("button", { name: "Draw tool: select" })).toHaveFocus());
  act(() => useCadStore.getState().undo()); expect(useCadStore.getState().history.present).toBe(original);
});
it("validates unsupported count before a worker call and Escape cancels without history and returns focus", async () => {
  openSketchReplication("linear"); render(<><button aria-label="Linear pattern selected sketch geometry">Pattern</button><SketchReplicationPanel /></>);
  fireEvent.change(screen.getByLabelText("Total instance count (including source)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview copies" }));
  expect(screen.getByRole("alert")).toHaveTextContent("count"); expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Pattern spacing"), { key: "Escape" });
  expect(useSketchReplication.getState().frame).toBeUndefined(); expect(useCadStore.getState().history.past).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole("button", { name: "Linear pattern selected sketch geometry" })).toHaveFocus());
});
it("ignores a late same-ID native result after replacing the project session", async () => {
  let resolve: ((result: RebuildResult) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise<RebuildResult>((done) => { resolve = done; }));
  openSketchReplication("mirror"); render(<SketchReplicationPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Preview copies" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
  const result = await rebuildDocument(mocks.preview.mock.calls[0][0]);
  act(() => useCadStore.getState().setDocument({ ...useCadStore.getState().history.present }));
  await act(async () => resolve?.(result));
  expect(screen.queryByRole("button", { name: "Apply copies" })).not.toBeInTheDocument(); expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("closes an otherwise current preview immediately when another task takes ownership", async () => {
  openSketchReplication("linear"); render(<SketchReplicationPanel />);
  fireEvent.change(screen.getByLabelText("Pattern spacing"), { target: { value: "6mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview copies" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply copies" })).toBeEnabled());
  const frame = useSketchReplication.getState().frame!;
  act(() => useSketchRefinement.setState({ frame: { ...frame } }));
  expect(screen.queryByRole("button", { name: "Apply copies" })).not.toBeInTheDocument();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("updates shared copy command availability when canvas selection alone changes", () => {
  const selection = useSketchCanvas.getState().selection;
  useSketchCanvas.setState({ selection: undefined });
  const { result } = renderHook(useCommandEnablement);
  expect(result.current.replicateSketch).toBe(false);
  act(() => useSketchCanvas.setState({ selection }));
  expect(result.current.replicateSketch).toBe(true);
  act(() => useSketchCanvas.setState({ selection: undefined }));
  expect(result.current.replicateSketch).toBe(false);
});

it("automatically previews pattern changes without adding history and applies only the latest proof", async () => {
  openSketchReplication("linear"); render(<SketchReplicationPanel />);
  const original = useCadStore.getState().history.present;
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply copies" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Pattern spacing"), { target: { value: "6mm" } });
  expect(screen.getByRole("button", { name: "Apply copies" })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply copies" })).toBeEnabled());
  expect(useCadStore.getState().history.present).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Apply copies" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
});

it("recovers from a worker that ignores timeout cancellation and rejects its late proof", async () => {
  vi.useFakeTimers();
  try {
    let resolve: ((value: RebuildResult) => void) | undefined;
    mocks.preview.mockImplementation(() => new Promise<RebuildResult>((done) => { resolve = done; }));
    openSketchReplication("linear"); render(<SketchReplicationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Preview copies" }));
    const [candidate, signal] = mocks.preview.mock.calls[0];
    const result = await rebuildDocument(candidate);
    act(() => vi.advanceTimersByTime(120000));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("timed out");
    expect(screen.getByRole("button", { name: "Preview copies" })).toBeEnabled();
    await act(async () => resolve?.(result));
    expect(screen.getByRole("button", { name: "Apply copies" })).toBeDisabled();
    expect(useCadStore.getState().history.past).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});
