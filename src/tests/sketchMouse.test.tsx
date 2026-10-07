import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { useCadStore } from "../state/useCadStore";
import { beginSketchCanvas, beginSketchCanvasTool, consumeSketchCanvasToolRequest, commitCanvasDimension, useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import { useSketchRefinement } from "../ui/commands/sketchRefinementCommand";

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
  useSketchRefinement.setState({ frame: undefined });
  useSketchCanvas.setState({ active: undefined });
  useCadStore.setState({ fileBusy: false });
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

it("shows a single Rectangle tool with explicit creation modes and cancels a draft when modes change", () => {
  const { svg, history } = open();
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: rectangle" }));
  expect(screen.getAllByRole("button", { name: "Draw tool: rectangle" })).toHaveLength(1);
  const mode = screen.getByLabelText("Rectangle creation mode");
  expect(mode).toHaveValue("corner");
  pointer(svg, "pointerdown", 200, 150);
  pointer(svg, "pointerup", 200, 150);
  fireEvent.change(screen.getByLabelText("Draft width"), { target: { value: "8mm" } });
  fireEvent.change(mode, { target: { value: "center" } });
  expect(screen.queryByLabelText("Draft width")).toBeNull();
  expect(mode).toHaveValue("center");
  expect(useCadStore.getState().history).toBe(history);
});
it("shared Rectangle command updates the open canvas without creating geometry", () => {
  const { history } = open();
  act(() => { runCommand("sketch.drawRectangle"); });
  expect(screen.getByRole("button", { name: "Draw tool: rectangle" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Rectangle creation mode")).toBeVisible();
  expect(useCadStore.getState().history).toBe(history);
  expect(useSketchCanvas.getState().active?.requestedTool).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: circle" }));
  act(() => { runCommand("sketch.drawRectangle"); });
  expect(screen.getByRole("button", { name: "Draw tool: rectangle" })).toHaveAttribute("aria-pressed", "true");
});
it("keeps driving dimensions visible and editable while revealing reference measurements only on selection or opt-in", () => {
  const { document } = open();
  const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
  expect(canvas.querySelectorAll(".canvas-reference-dimension")).toHaveLength(0);
  const active = useSketchCanvas.getState().active!;
  const line = Object.values(document.sketches[active.sketchId].entities).find((e) => e.type === "line")!;
  act(() => {
    commitCanvasDimension(active, document, { type: "length", refs: [line.id], expression: "20mm" });
    const next = useCadStore.getState().history.present;
    useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: false, result: rebuildDocument(next) } });
  });
  expect(canvas.querySelectorAll(".canvas-driving-dimension")).toHaveLength(1);
  expect(canvas.querySelectorAll(".canvas-reference-dimension")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  const other = Object.values(document.sketches[active.sketchId].entities).find((e) => e.type === "line" && e.id !== line.id)!;
  fireEvent.change(screen.getByLabelText("Selected sketch item"), { target: { value: other.id } });
  expect(canvas.querySelectorAll(".canvas-reference-dimension")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Selected sketch item"), { target: { value: "" } });
  expect(canvas.querySelectorAll(".canvas-reference-dimension")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Canvas dimension selection"), { target: { value: useCadStore.getState().history.present.sketches[active.sketchId].dimensions[0].id } });
  fireEvent.keyDown(canvas.querySelector(".canvas-driving-dimension")!, { key: "Enter" });
  expect(screen.getByLabelText("Sketch size expression")).toHaveValue("20mm");
  fireEvent.click(screen.getByRole("button", { name: "Cancel size edit" }));
  fireEvent.click(screen.getByLabelText("Show reference measurements"));
  expect(canvas.querySelectorAll(".canvas-reference-dimension")).toHaveLength(3);
});
it("keeps lost driving dimensions and their repair diagnostics available with references hidden", () => {
  const { document } = open();
  const active = useSketchCanvas.getState().active!;
  act(() => {
    useCadStore.getState().updateDocument((current) => ({
      ...current,
      sketches: {
        ...current.sketches,
        [active.sketchId]: {
          ...current.sketches[active.sketchId],
          dimensions: [{ id: "lost-size", type: "length", entityIds: ["missing-edge"], expression: { expression: "25mm", unit: "mm" } }],
        },
      },
    }));
    const changed = useCadStore.getState().history.present;
    useCadStore.setState({ rebuild: { status: "failed", kernelReady: false, result: rebuildDocument(changed) } });
  });
  expect(screen.getByRole("button", { name: "Edit canvas dimension 1" })).toHaveTextContent("unavailable");
  expect(screen.getAllByRole("alert").some((alert) => /reference|missing|unavailable/i.test(alert.textContent ?? ""))).toBe(true);
  expect(screen.getByRole("group", { name: "Sketch drawing canvas" }).querySelectorAll(".canvas-reference-dimension")).toHaveLength(0);
  expect(useCadStore.getState().history.present.id).toBe(document.id);
});

it("blocks Rectangle drawing while a file job is active", () => {
  const { history } = open();
  useCadStore.setState({ fileBusy: true });
  expect(selectCommandEnablement(useCadStore.getState()).drawSketch).toBe(false);
  act(() => { runCommand("sketch.drawRectangle"); });
  expect(useSketchCanvas.getState().active?.requestedTool).toBeUndefined();
  expect(useCadStore.getState().history).toBe(history);
});

it("consumes Rectangle requests so remounting does not replay an old tool", () => {
  open();
  act(() => { runCommand("sketch.drawRectangle"); });
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: circle" }));
  expect(useSketchCanvas.getState().active?.requestedTool).toBeUndefined();
  cleanup();
  render(<SketchCanvasPanel />);
  expect(screen.getByRole("button", { name: "Draw tool: rectangle" })).toHaveAttribute("aria-pressed", "false");
});

it("opens the Rectangle canvas from a selected sketch without authoring a preset", () => {
  const { history } = open();
  act(() => { useSketchCanvas.setState({ active: undefined }); });
  expect(screen.queryByRole("group", { name: "Sketch drawing canvas" })).not.toBeInTheDocument();
  act(() => { runCommand("sketch.drawRectangle"); });
  expect(screen.getByRole("button", { name: "Draw tool: rectangle" })).toHaveAttribute("aria-pressed", "true");
  expect(useCadStore.getState().history).toBe(history);
});

it("does not let an old tool consumer clear a newer request", () => {
  open();
  act(() => {
    const oldRequest = beginSketchCanvasTool("rectangle")!;
    const nextRequest = beginSketchCanvasTool("circle")!;
    consumeSketchCanvasToolRequest(oldRequest);
    expect(useSketchCanvas.getState().active).toBe(nextRequest);
  });
  expect(screen.getByRole("button", { name: "Draw tool: circle" })).toHaveAttribute("aria-pressed", "true");
});
