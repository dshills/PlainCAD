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
