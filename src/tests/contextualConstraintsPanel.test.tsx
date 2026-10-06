import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ContextualSketchConstraints } from "../ui/panels/ContextualSketchConstraints";
import { addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useContextualConstraintDraft } from "../ui/commands/contextualConstraintCommand";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { RebuildResult } from "../cad/worker/workerProtocol";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true); useContextualConstraintDraft.setState({ frame: undefined }); mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
  const a = addPoint(createXySketch(), "0mm", "0mm"), b = addPoint(a.sketch, "20mm", "5mm"), line = addLine(b.sketch, a.pointId, b.pointId), document = upsertSketch(createEmptyDocument(), line.sketch);
  useCadStore.getState().setDocument(document); const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...state.rebuild, kernelReady: true } });
  useSketchCanvas.setState({ active: { documentId: document.id, session: state.documentSession, sketchId: line.sketch.id }, selection: { document: state.history.present, entityIds: [line.lineId] } });
});
it("shows matching actions, previews without editing, cancels with Escape, and explicitly applies one undo step", async () => {
  render(<><button aria-label="Draw tool: select">Select</button><ContextualSketchConstraints /></>);
  expect(screen.queryByRole("button", { name: "Preview Tangent" })).not.toBeInTheDocument();
  const original = useCadStore.getState().history.present;
  fireEvent.click(screen.getByRole("button", { name: "Preview Horizontal" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply relation" })).toBeEnabled());
  expect(screen.getByLabelText("Constraint preview status")).toHaveTextContent("No solid was modeled");
  expect(screen.getByRole("img", { name: "Solved sketch refinement preview" })).toBeInTheDocument();
  expect(useCadStore.getState().history.present).toBe(original);
  fireEvent.keyDown(screen.getByLabelText("Selected geometry relations"), { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Apply relation" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview Horizontal" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Preview Horizontal" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply relation" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Apply relation" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole("button", { name: "Draw tool: select" })).toHaveFocus());
  act(() => useCadStore.getState().undo()); expect(useCadStore.getState().history.present).toBe(original);
});
it("ignores a late worker result after selection changes", async () => {
  let finish: ((result: RebuildResult) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise<RebuildResult>((resolve) => { finish = resolve; }));
  render(<ContextualSketchConstraints />); fireEvent.click(screen.getByRole("button", { name: "Preview Vertical" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
  const result = await rebuildDocument(mocks.preview.mock.calls[0][0]);
  act(() => useSketchCanvas.setState({ selection: undefined }));
  await act(async () => finish?.(result));
  expect(screen.queryByRole("button", { name: "Apply relation" })).not.toBeInTheDocument();
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(useContextualConstraintDraft.getState().frame).toBeUndefined();
});

it("preserves a worker failure diagnostic instead of misreporting it as timeout", async () => {
  mocks.preview.mockRejectedValue(new Error("OpenCascade: affected feature is invalid"));
  render(<ContextualSketchConstraints />); fireEvent.click(screen.getByRole("button", { name: "Preview Horizontal" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("OpenCascade: affected feature is invalid"));
  expect(screen.getByRole("alert")).not.toHaveTextContent("timed out");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("keeps lost-reference intent repairable and stale canvas sessions from throwing during render", () => {
  const document = useCadStore.getState().history.present, sketch = Object.values(document.sketches)[0];
  act(() => useCadStore.getState().updateDocument((current) => ({ ...current, sketches: { ...current.sketches, [sketch.id]: { ...sketch, constraints: [{ id: "lost_relation", type: "horizontal", entityIds: ["missing_line"] }] } } })));
  render(<ContextualSketchConstraints />);
  expect(screen.getByLabelText("Current sketch constraint state")).toHaveTextContent("Needs repair");
  expect(useCadStore.getState().history.present.sketches[sketch.id].constraints[0].entityIds).toEqual(["missing_line"]);
  act(() => useSketchCanvas.setState({ active: { documentId: document.id, session: -1, sketchId: sketch.id } }));
  expect(screen.getByRole("status", { name: "Sketch relations unavailable" })).toHaveTextContent("Reopen the sketch canvas");
});
