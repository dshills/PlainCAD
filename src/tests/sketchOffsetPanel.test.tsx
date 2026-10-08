import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addArc, addCornerRectangle, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { buildSketchOffset, sketchOffsetProfiles } from "../cad/sketch/sketchOffset";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { applySketchOffset, canOpenSketchOffset, openSketchOffset, previewSketchOffset, useSketchOffset } from "../ui/commands/sketchOffsetCommand";
import { SketchOffsetPanel } from "../ui/panels/SketchOffsetPanel";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchOffset.setState({ frame: undefined });
  const sketch = addCornerRectangle(createXySketch(), "24mm", "16mm");
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...state.rebuild, kernelReady: true } });
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: undefined });
  mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
  openSketchOffset();
});
it("previews a separate closed ring without history, applies one undo step, and restores focus", async () => {
  render(<><button aria-label="Offset sketch outline">Offset</button><SketchOffsetPanel /></>);
  const original = useCadStore.getState().history.present;
  fireEvent.click(screen.getByRole("button", { name: "Preview outline offset" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply outline offset" })).toBeEnabled());
  expect(useCadStore.getState().history.present).toBe(original);
  expect(screen.getByRole("img", { name: "Source and copied outline offset preview" }).querySelectorAll('[data-offset-copy="true"]')).toHaveLength(4);
  fireEvent.change(screen.getByLabelText("Outline offset distance"), { target: { value: "3mm" } });
  expect(screen.getByRole("button", { name: "Apply outline offset" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preview outline offset" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply outline offset" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Apply outline offset" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(useSketchOffset.getState().frame).toBeUndefined();
  await waitFor(() => expect(screen.getByRole("button", { name: "Offset sketch outline" })).toHaveFocus());
  const edited = useCadStore.getState().history.present;
  act(() => useCadStore.getState().undo()); expect(useCadStore.getState().history.present).toBe(original);
  act(() => useCadStore.getState().redo()); expect(useCadStore.getState().history.present).toBe(edited);
});
it("diagnoses collapse before calling the worker and Escape cancels without changing history", async () => {
  render(<SketchOffsetPanel />);
  fireEvent.change(screen.getByLabelText("Outline offset direction"), { target: { value: "inward" } });
  fireEvent.change(screen.getByLabelText("Outline offset distance"), { target: { value: "8mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview outline offset" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/collapses|self-intersect/);
  expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Outline offset distance"), { key: "Escape" });
  expect(useSketchOffset.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("rejects a late worker result after same-ID project replacement", async () => {
  let resolve: ((value: Awaited<ReturnType<typeof rebuildDocument>>) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<SketchOffsetPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Preview outline offset" }));
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(resolve).toBeDefined();
  const result = await rebuildDocument(mocks.preview.mock.calls[0][0]);
  act(() => useCadStore.getState().setDocument({ ...useCadStore.getState().history.present }));
  await act(async () => resolve!(result));
  expect(useSketchOffset.getState().frame).toBeUndefined();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("invalidates a completed proof when selection changes and rejects a proof for a different plan", async () => {
  const frame = useSketchOffset.getState().frame!;
  const profile = sketchOffsetProfiles(frame.document, frame.active.sketchId).profiles[0];
  const plan = buildSketchOffset(frame.document, frame.active.sketchId, profile.id, { direction: "outward", distance: "2mm", holes: "reject" });
  const other = buildSketchOffset(frame.document, frame.active.sketchId, profile.id, { direction: "inward", distance: "2mm", holes: "reject" });
  const { result } = await previewSketchOffset(frame, plan, new AbortController().signal);
  expect(() => applySketchOffset(frame, other, result)).toThrow(/does not match/);
  useSketchCanvas.setState({ selection: { document: frame.document, entityIds: [Object.keys(frame.document.sketches[frame.active.sketchId].entities)[0]] } });
  expect(() => applySketchOffset(frame, plan, result)).toThrow(/selection changed/);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("rejects malformed empty, point-only and missing copied contours without accepting vacuous geometry proof", async () => {
  const frame = useSketchOffset.getState().frame!;
  const profile = sketchOffsetProfiles(frame.document, frame.active.sketchId).profiles[0];
  const plan = buildSketchOffset(frame.document, frame.active.sketchId, profile.id, { direction: "outward", distance: "2mm", holes: "reject" });
  const pointId = plan.copiedEntityIds.find((id) => plan.document.sketches[plan.sketchId].entities[id].type === "point")!;
  for (const ids of [[], [pointId], ["missing_entity"]]) {
    await expect(previewSketchOffset(frame, { ...plan, copiedEntityIds: ids }, new AbortController().signal)).rejects.toThrow(/copied contour/);
  }
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("aborts canceled requests and discards their late response", async () => {
  let resolve: ((value: Awaited<ReturnType<typeof rebuildDocument>>) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<SketchOffsetPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Preview outline offset" }));
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(resolve).toBeDefined();
  const [candidate, signal] = mocks.preview.mock.calls[0];
  const result = await rebuildDocument(candidate);
  fireEvent.click(screen.getByRole("button", { name: "Cancel outline offset" }));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve!(result));
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(useSketchOffset.getState().frame).toBeUndefined();
});
it("keeps a guarded entry available to show open-outline and open-arc diagnostics", () => {
  function open(sketch: ReturnType<typeof createXySketch>) {
    useSketchOffset.setState({ frame: undefined });
    useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
    const state = useCadStore.getState();
    useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: undefined });
    expect(canOpenSketchOffset()).toBe(true);
    openSketchOffset();
  }
  open(createXySketch());
  const view = render(<SketchOffsetPanel />);
  expect(screen.getByRole("alert")).toHaveTextContent("Draw a closed outline");
  expect(screen.getByRole("button", { name: "Preview outline offset" })).toBeDisabled();
  view.unmount();
  const center = addPoint(createXySketch(), "0mm", "0mm"), start = addPoint(center.sketch, "10mm", "0mm"), end = addPoint(start.sketch, "0mm", "10mm");
  open(addArc(end.sketch, center.pointId, start.pointId, end.pointId).sketch);
  render(<SketchOffsetPanel />);
  expect(screen.getByRole("alert")).toHaveTextContent("Repair sketch constraints and closed profiles");
  expect(screen.getByRole("button", { name: "Preview outline offset" })).toBeDisabled();
  expect(mocks.preview).not.toHaveBeenCalled();
  act(() => useSketchOffset.setState({ frame: undefined }));
  expect(canOpenSketchOffset()).toBe(true);
  act(() => useCadStore.setState({ fileBusy: true }));
  expect(canOpenSketchOffset()).toBe(false);
});
