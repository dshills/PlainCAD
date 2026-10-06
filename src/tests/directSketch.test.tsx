import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as dimensionModule from "../cad/sketch/canvasDimensions";
import { resetWorkspace } from "./workspaceTestHelpers";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { useCadStore } from "../state/useCadStore";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import {
  beginSketchCanvas,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";

beforeEach(() => {
  useCadStore.setState({ fileBusy: false });
  resetWorkspace("focused");
  useCadStore.getState().setDocument(createEmptyDocument());
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  useSketchCanvas.setState({ active: undefined });
  resetWorkspace();
});
async function open(driving = true) {
  const base = createXySketch();
  const circle = addCanvasGeometry(base, solveSketch(base, {}), "circle", [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
  ]).sketch;
  const id = Object.values(circle.entities).find(
    (e) => e.type === "circle",
  )!.id;
  const sketch = driving
    ? withCanvasDimension(circle, {
        type: "diameter",
        refs: [id],
        expression: "10mm",
      })
    : circle;
  const document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.getState().setDocument(document);
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
  );
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  beginSketchCanvas();
  render(<SketchCanvasPanel />);
  return { id, sketch };
}
it("offers visible tools and keeps precision collapsed while dimensions stay visible; keyboard inline edits preserve IDs and undo", async () => {
  const { sketch } = await open();
  for (const tool of ["select", "line", "rectangle", "circle", "arc"])
    expect(
      screen.getByRole("button", { name: `Draw tool: ${tool}` }),
    ).toBeVisible();
  expect(screen.getByLabelText("Canvas tool")).not.toBeVisible();
  expect(screen.getByLabelText("Show drawing dimensions")).toBeChecked();
  const label = screen.getByRole("button", { name: /^Edit drawing D/ });
  const before = useCadStore.getState().history;
  fireEvent.keyDown(label, { key: "Enter" });
  const input = screen.getByRole("textbox", { name: "Sketch size expression" });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "12" } });
  fireEvent.submit(screen.getByRole("form", { name: "Selected sketch size" }));
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
  );
  const after = useCadStore.getState().history;
  const dimension = after.present.sketches[sketch.id].dimensions[0];
  expect(dimension).toMatchObject({
    id: sketch.dimensions[0].id,
    expression: { expression: "12", authoredUnit: "mm" },
  });
  expect(
    solveSketch(after.present.sketches[sketch.id], {}).circles[0].radius,
  ).toBeCloseTo(6);
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(
    screen.getByRole("group", { name: "Sketch drawing canvas" }),
  ).toHaveFocus();
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(before.present);
});
it("inspects a reference measurement without mutation and Escape returns to the canvas", async () => {
  await open(false);
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  const before = useCadStore.getState().history;
  fireEvent.click(screen.getByRole("button", { name: /^Inspect drawing/ }));
  expect(
    screen.getByRole("textbox", { name: "Sketch size expression" }),
  ).toHaveValue("5mm");
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.keyDown(
    screen.getByRole("textbox", { name: "Sketch size expression" }),
    { key: "Escape" },
  );
  expect(
    screen.queryByRole("form", { name: "Selected sketch size" }),
  ).toBeNull();
  expect(
    screen.getByRole("group", { name: "Sketch drawing canvas" }),
  ).toHaveFocus();
  expect(useCadStore.getState().history).toBe(before);
});
it("rejects stale inline edits after another document edit", async () => {
  await open();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Edit drawing D/ }), {
    key: "Enter",
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Sketch size expression" }),
    { target: { value: "14mm" } },
  );
  act(() =>
    useCadStore.getState().updateDocument((d) => ({ ...d, name: "Changed" })),
  );
  const before = useCadStore.getState().history;
  fireEvent.submit(screen.getByRole("form", { name: "Selected sketch size" }));
  expect(screen.getByText(/sketch changed while editing/)).toBeVisible();
  expect(useCadStore.getState().history).toBe(before);
});
it("retains invalid dimension intent with visible diagnostics and unavailable labels while precision is collapsed", async () => {
  const { sketch } = await open();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Edit drawing D/ }), {
    key: "Enter",
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Sketch size expression" }),
    { target: { value: "missing" } },
  );
  fireEvent.submit(screen.getByRole("form", { name: "Selected sketch size" }));
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("failed"),
  );
  expect(
    useCadStore.getState().history.present.sketches[sketch.id].dimensions[0]
      .expression.expression,
  ).toBe("missing");
  expect(
    screen.getByRole("button", { name: /^Edit drawing D.*unavailable/ }),
  ).toBeVisible();
  expect(
    screen
      .getAllByRole("alert")
      .some((e) => e.textContent?.includes("missing")),
  ).toBe(true);
  expect(screen.getByLabelText("Canvas tool")).not.toBeVisible();
});
it("clears the previous expression when choosing a new dimension and keeps Focused disclosures collapsed after Full", async () => {
  await open();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Edit drawing D/ }), {
    key: "Enter",
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Sketch size expression" }),
    { target: { value: "42deg" } },
  );
  fireEvent.click(
    screen.getByText("Dimension tools and display", { exact: true }),
  );
  fireEvent.change(screen.getByLabelText("Canvas dimension selection"), {
    target: { value: "" },
  });
  expect(screen.getByLabelText("Canvas dimension expression")).toHaveValue(
    "10mm",
  );
  act(() => resetWorkspace("full"));
  expect(screen.getByLabelText("Canvas tool")).toBeVisible();
  act(() => resetWorkspace("focused"));
  expect(screen.getByLabelText("Canvas tool")).not.toBeVisible();
});
it("closes a size draft when choosing a drawing tool and resets deleted dimension intent", async () => {
  await open();
  const before = useCadStore.getState().history;
  fireEvent.keyDown(screen.getByRole("button", { name: /^Edit drawing D/ }), {
    key: "Enter",
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Sketch size expression" }),
    { target: { value: "30mm" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: rectangle" }));
  expect(
    screen.queryByRole("form", { name: "Selected sketch size" }),
  ).toBeNull();
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.click(
    screen.getByText("Dimension tools and display", { exact: true }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Delete canvas dimension" }),
  );
  expect(screen.getByLabelText("Canvas dimension expression")).toHaveValue(
    "10mm",
  );
  expect(
    Object.values(useCadStore.getState().history.present.sketches)[0]
      .dimensions,
  ).toHaveLength(0);
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(before.present);
});

it("reports unmeasurable reference sizes without replacing the previous dimension form intent", async () => {
  await open(false);
  const before = useCadStore.getState().history;
  vi.spyOn(dimensionModule, "canvasEntitySize").mockReturnValue({
    type: "radius",
    value: 1e30,
  });
  fireEvent.keyDown(screen.getByRole("button", { name: /^Inspect drawing/ }), {
    key: "Enter",
  });
  expect(screen.getByText(/Reference size is unavailable/)).toBeVisible();
  expect(
    screen.queryByRole("form", { name: "Selected sketch size" }),
  ).toBeNull();
  expect(screen.getByLabelText("Canvas dimension reference 1")).toHaveValue("");
  expect(screen.getByLabelText("Canvas dimension expression")).toHaveValue(
    "10mm",
  );
  expect(useCadStore.getState().history).toBe(before);
});

it("selects geometry on the canvas and deletes it with the visible button as one undoable edit", async () => {
  const { id, sketch } = await open();
  const before = useCadStore.getState().history;
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  const button = screen.getByRole("button", {
    name: "Delete selected sketch item",
  });
  expect(button).toBeDisabled();
  fireEvent.pointerDown(
    window.document.querySelector(`[data-entity-id="${id}"]`)!,
    { button: 0 },
  );
  expect(button).toBeEnabled();
  expect(screen.getByLabelText("Selected sketch item")).toHaveValue(id);
  expect(
    screen.getByText(/Removes 2 geometry item\(s\), 1 dimension/),
  ).toBeVisible();
  expect(
    screen.queryByRole("form", { name: "Selected sketch size" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit selected size" }));
  expect(screen.getByLabelText("Selected sketch item")).toHaveValue(id);
  expect(button).toBeEnabled();
  fireEvent.keyDown(screen.getByLabelText("Sketch size expression"), {
    key: "Delete",
  });
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Cancel size edit" }));
  fireEvent.click(button);
  const after = useCadStore.getState().history;
  expect(after.present.sketches[sketch.id].entities[id]).toBeUndefined();
  expect(after.present.sketches[sketch.id].dimensions).toEqual([]);
  expect(
    Object.values(after.present.sketches[sketch.id].entities).map(
      (e) => e.type,
    ),
  ).toEqual([]);
  expect(after.past.length).toBe(before.past.length + 1);
  expect(button).toBeDisabled();
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(before.present);
});

it.each(["Delete", "Backspace"])(
  "deletes a selected point and its attached circle with %s, while typing never deletes geometry",
  async (key) => {
    const { sketch } = await open();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Edit drawing D/ }), {
      key: "Enter",
    });
    const before = useCadStore.getState().history;
    fireEvent.keyDown(screen.getByLabelText("Sketch size expression"), { key });
    expect(useCadStore.getState().history).toBe(before);
    const pointId = Object.values(sketch.entities).find(
      (e) => e.type === "point",
    )!.id;
    fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
    fireEvent.change(screen.getByLabelText("Selected sketch item"), {
      target: { value: pointId },
    });
    expect(screen.getByText(/Removes 2 geometry/)).toBeVisible();
    const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
    expect(canvas).toHaveFocus();
    fireEvent.keyDown(canvas, { key, ctrlKey: true });
    expect(useCadStore.getState().history).toBe(before);
    fireEvent.keyDown(canvas, { key });
    expect(
      Object.keys(
        useCadStore.getState().history.present.sketches[sketch.id].entities,
      ),
    ).toEqual([]);
    expect(useCadStore.getState().history.past.length).toBe(
      before.past.length + 1,
    );
    fireEvent.keyDown(canvas, { key, repeat: true });
    expect(useCadStore.getState().history.past.length).toBe(
      before.past.length + 1,
    );
  },
);

it("supports Shift-click toggles and focused Select All without affecting size input typing; bulk deletion is one undo edit", async () => {
  const { id, sketch } = await open();
  const point = Object.values(sketch.entities).find(
    (e) => e.type === "point",
  )!.id;
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  const circle = window.document.querySelector(`[data-entity-id="${id}"]`)!;
  const center = window.document.querySelector(`[data-point-id="${point}"]`)!;
  fireEvent.pointerDown(circle, { button: 0 });
  fireEvent.pointerDown(center, { button: 0, shiftKey: true });
  expect(screen.getByLabelText("Sketch selection count")).toHaveTextContent(
    "2 selected",
  );
  expect(circle).toHaveClass("canvas-entity-selected");
  expect(center).toHaveClass("canvas-entity-selected");
  expect(
    screen.getByRole("button", { name: "Edit selected size" }),
  ).toBeDisabled();
  fireEvent.pointerDown(center, { button: 0, shiftKey: true });
  expect(screen.getByLabelText("Selected sketch item")).toHaveValue(id);
  fireEvent.click(screen.getByRole("button", { name: "Edit selected size" }));
  const input = screen.getByLabelText("Sketch size expression");
  fireEvent.keyDown(input, { key: "a", ctrlKey: true });
  expect(screen.getByLabelText("Sketch selection count")).toHaveTextContent(
    "1 selected",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel size edit" }));
  const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
  const before = useCadStore.getState().history;
  fireEvent.keyDown(canvas, { key: "a", ctrlKey: true });
  expect(screen.getByLabelText("Sketch selection count")).toHaveTextContent(
    "2 selected",
  );
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.keyDown(canvas, { key: "Delete" });
  expect(
    useCadStore.getState().history.present.sketches[sketch.id].entities,
  ).toEqual({});
  expect(useCadStore.getState().history.past).toHaveLength(
    before.past.length + 1,
  );
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(before.present);
  fireEvent.click(
    screen.getByRole("button", { name: "Select all sketch geometry" }),
  );
  expect(screen.getByLabelText("Sketch selection count")).toHaveTextContent(
    "2 selected",
  );
  act(() => useCadStore.setState({ fileBusy: true }));
  expect(
    screen.getByRole("button", { name: "Select all sketch geometry" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Delete selected sketch item" }),
  ).toBeDisabled();
  act(() => useCadStore.setState({ fileBusy: false }));
});

it("selects circles with a window gesture and cancels captured selection on Escape or document changes", async () => {
  const { id } = await open(false);
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 450,
    width: 600,
    height: 450,
    toJSON: () => ({}),
  });
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => true },
    releasePointerCapture: { value: vi.fn() },
  });
  const view = canvas.getAttribute("viewBox")!.split(" ").map(Number);
  const at = (x: number, y: number) => ({
    pointerId: 1,
    button: 0,
    clientX: ((x - view[0]) / view[2]) * 600,
    clientY: ((-y - view[1]) / view[3]) * 450,
  });
  const before = useCadStore.getState().history;
  fireEvent.pointerDown(canvas, at(-7, -6));
  fireEvent.pointerMove(canvas, at(7, 6));
  expect(
    canvas.querySelector('[data-selection-box="window"]'),
  ).toBeInTheDocument();
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(canvas.querySelector("[data-selection-box]")).toBeNull();
  expect(useSketchCanvas.getState().active).toBeDefined();
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.pointerDown(canvas, at(-7, -6));
  fireEvent.pointerMove(canvas, at(7, 6));
  fireEvent.pointerUp(canvas, at(7, 6));
  expect(screen.getByLabelText("Sketch selection count")).toHaveTextContent(
    "1 selected",
  );
  expect(screen.getByLabelText("Selected sketch item")).toHaveValue(id);
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.pointerDown(canvas, at(-7, -6));
  fireEvent.pointerMove(canvas, at(7, 6));
  act(() =>
    useCadStore
      .getState()
      .updateDocument((d) => ({ ...d, name: "Changed during selection" })),
  );
  fireEvent.pointerUp(canvas, at(7, 6));
  expect(canvas.querySelector("[data-selection-box]")).toBeNull();
  expect(screen.getByLabelText("Sketch selection count")).toHaveTextContent(
    "0 selected",
  );
});

it("keeps dimension-overlay presses separate from box selection", async () => {
  const { id } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  fireEvent.pointerDown(
    window.document.querySelector(`[data-entity-id="${id}"]`)!,
    { button: 0 },
  );
  const selection = useSketchCanvas.getState().selection;
  const history = useCadStore.getState().history;
  const label = screen.getByRole("button", { name: /^Edit drawing D/ });
  const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
  Object.defineProperty(canvas, "getScreenCTM", {
    value: () => null,
    configurable: true,
  });
  fireEvent.pointerDown(label, {
    button: 0,
    pointerId: 42,
    clientX: 10,
    clientY: 10,
  });
  expect(window.document.querySelector("[data-selection-box]")).toBeNull();
  expect(useSketchCanvas.getState().selection).toBe(selection);
  expect(useCadStore.getState().history).toBe(history);
  fireEvent.pointerCancel(label, { pointerId: 42 });
});

it("shows transient center snap feedback without editing history, and clears it when drafting becomes unavailable", async () => {
  await open(false);
  const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 300,
    width: 600,
    height: 300,
    toJSON: () => ({}),
  });
  const view = canvas.getAttribute("viewBox")!.split(" ").map(Number);
  const before = useCadStore.getState().history;
  // viewBox already uses SVG Y: local +0.1 maps to SVG -0.1.
  fireEvent.pointerMove(canvas, {
    clientX: ((0.2 - view[0]) / view[2]) * 600,
    clientY: ((-0.1 - view[1]) / view[3]) * 300,
  });
  expect(screen.getByRole("img", { name: "Center snap" })).toBeVisible();
  expect(useCadStore.getState().history).toBe(before);
  act(() => useCadStore.setState({ fileBusy: true }));
  expect(screen.queryByRole("img", { name: "Center snap" })).toBeNull();
  expect(useCadStore.getState().history).toBe(before);
  act(() => useCadStore.setState({ fileBusy: false }));
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  fireEvent.pointerMove(canvas, { clientX: 300, clientY: 150 });
  expect(canvas.querySelector("[data-snap-kind]")).toBeNull();
});

it.each(["line", "circle", "rectangle"] as const)(
  "draws a small %s in the empty 200-unit viewport with geometry inference enabled",
  async (tool) => {
    const sketch = createXySketch();
    const document = upsertSketch(createEmptyDocument(), sketch);
    useCadStore.getState().setDocument(document);
    await waitFor(() =>
      expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
    );
    useCadStore.getState().select({
      kind: "sketch",
      id: sketch.id,
      documentId: document.id,
    });
    beginSketchCanvas();
    render(<SketchCanvasPanel />);
    fireEvent.click(screen.getByRole("button", { name: `Draw tool: ${tool}` }));
    const canvas = screen.getByRole("group", { name: "Sketch drawing canvas" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 500,
      bottom: 300,
      width: 500,
      height: 300,
      toJSON: () => ({}),
    });
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    const view = canvas.getAttribute("viewBox")!.split(" ").map(Number);
    expect(view[2]).toBe(200);
    const click = (x: number, y: number) => {
      const event = {
        button: 0,
        pointerId: 51,
        clientX: ((x - view[0]) / view[2]) * 500,
        clientY: ((-y - view[1]) / view[3]) * 300,
      };
      fireEvent.pointerDown(canvas, event);
      fireEvent.pointerUp(canvas, event);
    };
    const before = useCadStore.getState().history.past.length;
    click(0, 0);
    click(2, tool === "rectangle" ? 2 : 0);
    const solved = solveSketch(
      useCadStore.getState().history.present.sketches[sketch.id],
      {},
    );
    if (tool === "circle") expect(solved.circles[0].radius).toBeCloseTo(2);
    else if (tool === "line")
      expect(solved.lines[0]).toMatchObject({
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
      });
    else {
      expect(solved.lines).toHaveLength(4);
      expect(
        Math.max(...Object.values(solved.points).map((p) => p.x)),
      ).toBeCloseTo(2);
      expect(
        Math.max(...Object.values(solved.points).map((p) => p.y)),
      ).toBeCloseTo(2);
    }
    expect(useCadStore.getState().history.past.length).toBe(before + 1);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
