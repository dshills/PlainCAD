import { describe, expect, it, vi } from "vitest";
import { runCommand, commands } from "../ui/commands/commandRegistry";
import { useCadStore } from "../state/useCadStore";

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

describe("file commands", () => {
  it("exposes project save/open/export commands", () => {
    expect(commands.map((command) => command.id)).toEqual(expect.arrayContaining(["file.openProject", "file.saveProject", "file.exportJson"]));
  });

  it("reports open project import errors in the store", async () => {
    const file = { text: async () => "{bad json" } as File;

    await runCommand("file.openProject", { file });

    expect(useCadStore.getState().fileError).toBe("Project file is not valid JSON.");
  });
});
