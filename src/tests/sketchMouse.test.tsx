import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { useCadStore } from "../state/useCadStore";
import { beginSketchCanvas, useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";

function open() {
  const empty = createXySketch();
  const sketch = addCanvasGeometry(empty, solveSketch(empty, {}), "rectangle", [{ x: 0, y: 0 }, { x: 20, y: 10 }]).sketch;
  const document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.getState().setDocument(document);
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: false, result: rebuildDocument(document) } });
  useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
  beginSketchCanvas();
  render(<SketchCanvasPanel />);
  const svg = screen.getByRole("group", { name: "Sketch drawing canvas" });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, toJSON: () => ({}) });
  const captures = new Set<number>();
  Object.defineProperties(svg, {
    setPointerCapture: { value: (id: number) => captures.add(id) },
    hasPointerCapture: { value: (id: number) => captures.has(id) },
    releasePointerCapture: { value: (id: number) => captures.delete(id) },
  });
  return { svg, document: useCadStore.getState().history.present, captures, history: useCadStore.getState().history };
}
function pointer(svg: HTMLElement, type: string, x: number, y: number, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(svg, event);
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSketchCanvas.setState({ active: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
});
it("exposes bounded Move/Translate/Deform and selection without opening precision", () => {
  open();
  for (const kind of ["move", "translate", "deform"]) {
    const button = screen.getByRole("button", { name: `Draw tool: ${kind}` });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    const selection = screen.getByLabelText("Canvas point to move");
    expect(selection.closest("details")).toBeNull();
  }
});
it("pans only the view and restores it on Escape and interruption", () => {
  const { svg, document, captures, history } = open();
  const view = svg.getAttribute("viewBox");
  fireEvent.keyDown(svg, { key: " ", code: "Space" });
  pointer(svg, "pointerdown", 200, 150);
  pointer(svg, "pointermove", 250, 180);
  expect(svg.getAttribute("viewBox")).not.toBe(view);
  expect(captures.has(1)).toBe(true);
  fireEvent.keyDown(svg, { key: "Escape" });
  expect(svg).toHaveAttribute("viewBox", view);
  expect(captures.size).toBe(0);
  fireEvent.keyUp(window, { key: " ", code: "Space" });
  pointer(svg, "pointerdown", 200, 150, 1);
  pointer(svg, "pointermove", 240, 170, 1);
  fireEvent(window, new Event("plaincad:cancel-sketch-gesture"));
  expect(svg).toHaveAttribute("viewBox", view);
  expect(useCadStore.getState().history).toBe(history);
  expect(useCadStore.getState().history.present).toBe(document);
  pointer(svg, "pointerdown", 200, 150, 1);
  pointer(svg, "pointermove", 240, 170, 1);
  fireEvent(window, new Event("blur"));
  expect(svg).toHaveAttribute("viewBox", view);
  expect(captures.size).toBe(0);
  expect(useCadStore.getState().history).toBe(history);
});
it("keeps text entry and native button activation available while Space modifies canvas navigation", () => {
  const { svg } = open();
  const coordinate = screen.getByLabelText("Canvas coordinate X");
  const inputKey = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
  fireEvent(coordinate, inputKey);
  expect(inputKey.defaultPrevented).toBe(false);
  const summary = screen.getByText("Drawing help");
  const summaryKey = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
  fireEvent(summary, summaryKey);
  expect(summaryKey.defaultPrevented).toBe(false);
  expect(screen.getByRole("status", { name: "Sketch navigation status" })).not.toHaveTextContent("Space held");
  const button = screen.getByRole("button", { name: "Draw tool: rectangle" });
  const buttonKey = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
  fireEvent(button, buttonKey);
  expect(buttonKey.defaultPrevented).toBe(false);
  expect(screen.getByRole("status", { name: "Sketch navigation status" })).toHaveTextContent("Space held");
  fireEvent.keyUp(window, { key: " ", code: "Space" });
  fireEvent.keyDown(svg, { key: "Alt" });
  expect(screen.getByRole("status", { name: "Sketch navigation status" })).toHaveTextContent("Snapping paused");
  fireEvent.keyUp(window, { key: "Alt" });
  expect(screen.getByRole("status", { name: "Sketch navigation status" })).not.toHaveTextContent("Snapping paused");
});
it("preserves click-draft geometry and typed sizes while panning to another drawing area", () => {
  const { svg, history } = open();
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: rectangle" }));
  pointer(svg, "pointerdown", 200, 150);
  pointer(svg, "pointerup", 200, 150);
  fireEvent.change(screen.getByLabelText("Draft width"), { target: { value: "8mm" } });
  fireEvent.change(screen.getByLabelText("Draft height"), { target: { value: "6mm" } });
  const view = svg.getAttribute("viewBox");
  pointer(svg, "pointerdown", 200, 150, 1);
  pointer(svg, "pointermove", 240, 170, 1);
  pointer(svg, "pointerup", 240, 170, 1);
  expect(svg.getAttribute("viewBox")).not.toBe(view);
  expect(screen.getByLabelText("Draft width")).toHaveValue("8mm");
  expect(screen.getByLabelText("Draft height")).toHaveValue("6mm");
  expect(screen.getByRole("button", { name: "Accept shape" })).toBeEnabled();
  expect(useCadStore.getState().history).toBe(history);
});
it("discards an interrupted press-drag primitive so the next click starts a fresh shape", () => {
  const { svg, history } = open();
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: rectangle" }));
  pointer(svg, "pointerdown", 200, 150);
  fireEvent.change(screen.getByLabelText("Draft width"), { target: { value: "8mm" } });
  pointer(svg, "pointerdown", 200, 150, 1);
  pointer(svg, "pointermove", 240, 170, 1);
  pointer(svg, "pointerup", 240, 170, 1);
  expect(screen.queryByLabelText("Draft width")).toBeNull();
  expect(useCadStore.getState().history).toBe(history);
  pointer(svg, "pointerdown", 180, 130);
  pointer(svg, "pointerup", 180, 130);
  expect(screen.getByLabelText("Draft width")).toHaveValue("");
  expect(useCadStore.getState().history).toBe(history);
});
