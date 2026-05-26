import { render, screen } from "@testing-library/react";
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
    await user.click(screen.getByRole("button", { name: /Mounting Plate/i }));
    const input = screen.getByLabelText("plate_width expression");
    await user.clear(input);
    await user.type(input, "100mm");
    expect(input).toHaveValue("100mm");
  });
});
