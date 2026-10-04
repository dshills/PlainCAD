import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCenterRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { runCommand } from "../ui/commands/commandRegistry";
vi.mock("../viewer/CadViewer", () => ({
  CadViewer: () => <div data-testid="retained-viewer" />,
}));
afterEach(() => {
  cleanup();
  useSketchCanvas.setState({ active: undefined });
});
it("edits inline, blocks competing creation commands, and returns to the same model viewer", async () => {
  const sketch = addCenterRectangle(createXySketch(), "10mm", "6mm");
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore
    .getState()
    .setDocument(upsertSketch(createEmptyDocument(), sketch));
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
  );
  useCadStore
    .getState()
    .select({
      kind: "sketch",
      id: sketch.id,
      documentId: useCadStore.getState().history.present.id,
    });
  render(<App />);
  const viewer = screen.getByTestId("retained-viewer");
  act(() => {
    runCommand("sketch.editCanvas");
  });
  const canvas = screen.getByRole("region", { name: "Sketch canvas" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(canvas.closest("main")).not.toBeNull();
  expect(
    within(canvas).getByRole("toolbar", { name: "Sketch drawing controls" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Browser" })).toBeVisible();
  const ribbon = screen.getByRole("navigation", { name: "Main CAD commands" });
  for (const name of [
    "Extrude selected sketch",
    "Create sketch",
    "Create XY sketch",
    "New component",
  ])
    expect(within(ribbon).getByRole("button", { name })).toBeDisabled();
  const before = useCadStore.getState().history;
  act(() => {
    runCommand("feature.extrude");
    runCommand("sketch.createXY");
  });
  expect(useCadStore.getState().history).toBe(before);
  expect(viewer).not.toBeVisible();
  fireEvent.click(
    within(canvas).getByRole("button", { name: "Finish Sketch" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Sketch canvas" })).toBeNull(),
  );
  expect(screen.getByTestId("retained-viewer")).toBe(viewer);
  expect(viewer).toBeVisible();
  expect(
    within(ribbon).getByRole("button", { name: "Extrude selected sketch" }),
  ).toBeEnabled();
});
