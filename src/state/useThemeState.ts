import { create } from "zustand";
import {
  applyTheme,
  isThemeId,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "../ui/themes/themes";

interface ThemeState {
  theme: ThemeId;
  persistenceError?: string;
  setTheme(theme: ThemeId): void;
}

export const useThemeState = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    if (!isThemeId(theme)) return;
    applyTheme(theme);
    let persistenceError: string | undefined;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      persistenceError =
        "Theme changed for this session. Browser storage is unavailable.";
    }
    set({ theme, persistenceError });
  },
}));
