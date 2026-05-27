import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";

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
});
