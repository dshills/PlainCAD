import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { useCadStore } from "../state/useCadStore";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { captureSketchRefinementFrame, useSketchRefinement } from "../ui/commands/sketchRefinementCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { clearAiSketchCanvasPreview, publishAiSketchCanvasPreview, useAiSketchCanvasPreview } from "../ui/commands/aiSketchCanvasPreview";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import { useFileJobs } from "../persistence/fileJobs";

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useFileJobs.setState({ exportOpen: false });
  useSketchRefinement.setState({ frame: undefined });
  useAiDrawer.setState({ open: true });
  const sketch = addCornerRectangle(createXySketch(), "24mm", "16mm");
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: undefined });
});
afterEach(cleanup);
function showProposal() {
  const frame = captureSketchRefinementFrame();
  useSketchRefinement.setState({ frame });
  const solved = solveSketch(frame.document.sketches[frame.active.sketchId], {});
  publishAiSketchCanvasPreview(frame, { ...solved, lines: solved.lines.map(line => ({ ...line, start: { ...line.start, x: line.start.x * 2 }, end: { ...line.end, x: line.end.x * 2 } })) });
  return frame;
}
it("renders solved proposal curves in the existing flipped coordinate frame and compares without changing view/history", () => {
  const { container } = render(<SketchCanvasPanel />);
  const svg = screen.getByRole("group", { name: "Sketch drawing canvas" });
  const view = svg.getAttribute("viewBox"), before = useCadStore.getState().history;
  act(() => showProposal());
  const overlay = screen.getByLabelText("Proposed AI sketch geometry");
  expect(overlay.closest("svg")).toBe(svg);
  expect(overlay).toHaveAttribute("transform", "scale(1,-1)");
  expect(overlay).toHaveAttribute("pointer-events", "none");
  expect(overlay.querySelectorAll("line")).toHaveLength(4);
  expect(Math.max(...Array.from(overlay.querySelectorAll("line")).map(line => Number(line.getAttribute("x2"))))).toBe(48);
  fireEvent.click(screen.getByRole("button", { name: "Before sketch" }));
  expect(screen.queryByLabelText("Proposed AI sketch geometry")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "After sketch" }));
  expect(screen.getByLabelText("Proposed AI sketch geometry")).toBeInTheDocument();
  expect(container.querySelectorAll("svg[aria-label='Sketch drawing canvas']")).toHaveLength(1);
  expect(svg.getAttribute("viewBox")).toBe(view);
  expect(useCadStore.getState().history).toBe(before);
});
it.each(["hide", "file task", "selection", "replacement"])("releases stale solved geometry after %s", change => {
  showProposal();
  expect(useAiSketchCanvasPreview.getState().proposal).toBeDefined();
  if (change === "hide") useAiDrawer.setState({ open: false });
  else if (change === "file task") useFileJobs.setState({ exportOpen: true });
  else if (change === "replacement") useCadStore.getState().setDocument({ ...useCadStore.getState().history.present });
  else useSketchCanvas.setState({ selection: { document: useCadStore.getState().history.present, entityIds: [Object.keys(useCadStore.getState().history.present.sketches[useSketchCanvas.getState().active!.sketchId].entities)[0]] } });
  expect(useAiSketchCanvasPreview.getState().proposal).toBeUndefined();
});
it("does not let an old owner cancel a newer preview, and releases it on canvas unmount", () => {
  const old = showProposal(), current = showProposal();
  clearAiSketchCanvasPreview(old);
  expect(useAiSketchCanvasPreview.getState().proposal?.frame).toBe(current);
  const view = render(<SketchCanvasPanel />);
  view.unmount();
  expect(useAiSketchCanvasPreview.getState().proposal).toBeUndefined();
});
