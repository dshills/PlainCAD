import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";

vi.mock("../viewer/CadViewer", () => ({
  CadViewer: () => <div data-testid="cad-viewer" />,
}));

describe("App", () => {
  it("loads and edits a parameter", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("PlainCAD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Load mounting plate template/i }));
    const input = screen.getByLabelText("Parameter plate_width expression");
    await user.clear(input);
    await user.type(input, "100mm");
    expect(input).toHaveValue("100mm");
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

  it("surfaces the sketch to extrude workflow in the top ribbon and bottom timeline", async () => {
    const user = userEvent.setup();
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      paletteOpen: false,
      selection: { selectedIds: [] },
    });
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
