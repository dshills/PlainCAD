import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../ui/commands/commandRegistry";

describe("view commands", () => {
  it("dispatches fit and reset camera events", () => {
    const fit = vi.fn();
    const reset = vi.fn();
    window.addEventListener("plaincad:fit-view", fit);
    window.addEventListener("plaincad:reset-camera", reset);

    try {
      runCommand("view.fit");
      runCommand("view.resetCamera");

      expect(fit).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("plaincad:fit-view", fit);
      window.removeEventListener("plaincad:reset-camera", reset);
    }
  });
});
