import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParameterPanel } from "../ui/panels/ParameterPanel";
import { useCadStore } from "../state/useCadStore";
import { createBoxTemplate } from "../templates/templates";
const previous = useCadStore.getState();
afterEach(() => { cleanup(); useCadStore.setState(previous, true); });
it("reports invalid shared-command parameter edits without an uncaught UI exception", () => {
  useCadStore.getState().setDocument(createBoxTemplate());
  const error = vi.fn();
  window.addEventListener("error", error);
  try {
    render(<ParameterPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rename parameter width" }));
    const input = screen.getByLabelText("Parameter width name");
    fireEvent.change(input, { target: { value: "invalid name" } });
    fireEvent.blur(input);
    expect(useCadStore.getState().fileError).toContain("safe identifier");
    expect(useCadStore.getState().history.present.parameters.width).toBeDefined();
    expect(error).not.toHaveBeenCalled();
  }
  finally {
    window.removeEventListener("error", error);
  }
});
