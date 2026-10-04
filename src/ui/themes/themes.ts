export const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "saturn", label: "Saturn Command" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export const THEME_STORAGE_KEY = "plaincad.ui.theme";

export function isThemeId(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function readStoredTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(value) ? value : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}

// Viewer colors change in place; model colors and selection remain CAD data.
// The lit 3D grid and unlit 2D sketch use distinct contrast palettes intentionally;
// background matches CSS --viewer-bg, while --canvas-bg belongs to the sketch.
export const viewerThemeColors = {
  light: {
    background: "#e7ebe8",
    gridMajor: "#7f918b",
    gridMinor: "#c1cbc7",
    line: "#245c87",
    construction: "#a66b23",
    error: "#c53a35",
    circle: "#7b3f98",
  },
  dark: {
    background: "#161e26",
    gridMajor: "#647588",
    gridMinor: "#303e4b",
    line: "#71c7ef",
    construction: "#ecc06e",
    error: "#ff9790",
    circle: "#cea6f5",
  },
  saturn: {
    background: "#030e14",
    gridMajor: "#2d6477",
    gridMinor: "#133a48",
    line: "#45d9ff",
    construction: "#ffcc70",
    error: "#ff9084",
    circle: "#c8a9ed",
  },
} satisfies Record<ThemeId, Record<string, string>>;
