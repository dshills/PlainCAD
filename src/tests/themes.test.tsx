import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeState } from "../state/useThemeState";
import { useCadStore } from "../state/useCadStore";
import { ThemeSelector } from "../ui/themes/ThemeSelector";
import {
  isThemeId,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from "../ui/themes/themes";

const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
beforeEach(() => {
  values.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  useThemeState.setState({ theme: "light", persistenceError: undefined });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalStorage)
    Object.defineProperty(window, "localStorage", originalStorage);
  else Reflect.deleteProperty(window, "localStorage");
  document.documentElement.removeAttribute("data-theme");
});

describe("UI themes", () => {
  it("accepts only supported preferences and safely defaults missing or invalid storage", () => {
    expect(readStoredTheme()).toBe("light");
    window.localStorage.setItem(THEME_STORAGE_KEY, "saturn");
    expect(readStoredTheme()).toBe("saturn");
    window.localStorage.setItem(THEME_STORAGE_KEY, "unknown");
    expect(readStoredTheme()).toBe("light");
    expect(isThemeId({ id: "dark" })).toBe(false);
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(readStoredTheme()).toBe("light");
  });

  it("switches themes accessibly and persists outside project history and rebuild state", async () => {
    const user = userEvent.setup(),
      before = useCadStore.getState();
    render(<ThemeSelector />);
    const select = screen.getByRole("combobox", { name: "UI theme" });
    for (const theme of ["saturn", "dark", "light"] as const) {
      await user.selectOptions(select, theme);
      expect(select).toHaveValue(theme);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
      expect(useCadStore.getState().history).toBe(before.history);
      expect(useCadStore.getState().rebuild).toBe(before.rebuild);
    }
  });

  it("keeps theme switching usable when storage fails and clears the message on a successful write", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Quota");
    });
    render(<ThemeSelector />);
    await user.selectOptions(screen.getByLabelText("UI theme"), "saturn");
    expect(document.documentElement.dataset.theme).toBe("saturn");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Theme changed for this session",
    );
    write.mockRestore();
    await user.selectOptions(screen.getByLabelText("UI theme"), "dark");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(readStoredTheme()).toBe("dark");
  });
});
