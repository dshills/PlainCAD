import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { REBUILD_DEBOUNCE_MS } from "../cad/worker/workerLifecycle";
import { useCadStore } from "../state/useCadStore";

vi.mock("../viewer/CadViewer", () => ({
  CadViewer: () => <div data-testid="cad-viewer" />,
}));

describe("App", () => {
  beforeEach(async () => {
    useCadStore.setState(useCadStore.getInitialState(), true);
    // Replace the queued document as well as the store snapshot from the previous test.
    useCadStore.getState().setDocument(createEmptyDocument());
    await waitFor(() => expect(useCadStore.getState().rebuild.status).toBe("succeeded"));
  });

  afterEach(() => {
    cleanup();
    if (vi.isFakeTimers()) vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("loads and edits a parameter", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("PlainCAD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Load mounting plate template/i }));
    const input = screen.getByLabelText("Parameter plate_width expression");
    await user.clear(input);
    await user.type(input, "100mm");
    expect(input).toHaveValue("100mm");
    await user.tab();
    await waitFor(() => expect(screen.getByRole("button", { name: "Export STL" })).toBeEnabled());
    expect(useCadStore.getState().history.present.parameters.plate_width.expression).toBe("100mm");
  });

  it("opens the command palette and shows interaction help", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByRole("dialog", { name: /Command Palette/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Filter commands/i })).toHaveFocus();
    expect(screen.getByText("Orbit")).toBeInTheDocument();
    const palette = screen.getByRole("dialog", { name: /Command Palette/i });
    expect(within(palette).getByRole("button", { name: /Export STL/i })).toBeDisabled();
  });

  it("enables STL export in the ribbon and palette after the queued model rebuilds", async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Load mounting plate template/i }));
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });

    const ribbon = screen.getByRole("navigation", { name: /Main CAD commands/i });
    const palette = screen.getByRole("dialog", { name: /Command Palette/i });
    expect(within(ribbon).getByRole("button", { name: "Export STL" })).toBeDisabled();
    expect(within(palette).getByRole("button", { name: /Export STL/i })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REBUILD_DEBOUNCE_MS);
    });

    expect(useCadStore.getState().rebuild.status).toBe("succeeded");
    expect(within(ribbon).getByRole("button", { name: "Export STL" })).toBeEnabled();
    expect(within(palette).getByRole("button", { name: /Export STL/i })).toBeEnabled();
  });

  it("surfaces the sketch to extrude workflow in the top ribbon and bottom timeline", async () => {
    const user = userEvent.setup();
    render(<App />);

    const ribbon = screen.getByRole("navigation", { name: /Main CAD commands/i });
    expect(ribbon).toBeInTheDocument();
    expect(within(ribbon).getByRole("region", { name: "File" })).toBeInTheDocument();
    expect(within(ribbon).getByRole("region", { name: "Sketch" })).toBeInTheDocument();
    expect(within(ribbon).getByRole("region", { name: "Create" })).toBeInTheDocument();
    expect(within(ribbon).getByRole("button", { name: /Extrude selected sketch/i })).toBeDisabled();
    expect(screen.getByRole("heading", { name: /Browser/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Parametric Timeline/i })).toBeInTheDocument();

    await user.click(within(ribbon).getByRole("button", { name: /Create XY sketch/i }));
    await user.click(within(ribbon).getByRole("button", { name: /Add center rectangle/i }));
    await user.click(within(ribbon).getByRole("button", { name: /Extrude selected sketch/i }));

    const timeline = screen.getByRole("list", { name: /Sketch and feature history/i });
    expect(within(timeline).getByRole("button", { name: /Sketch 1/i })).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: /Extrude 1/i })).toBeInTheDocument();
  });
});
