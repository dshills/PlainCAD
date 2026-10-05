import { create } from "zustand";

export const WORKSPACE_STORAGE_KEY = "plaincad.workspace.v1";
export const WORKSPACE_PANELS = [
  "parts",
  "history",
  "parameters",
  "inspector",
  "dependencies",
  "measure",
  "views",
  "issues",
  "help",
] as const;
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number];
export type TaskPanel =
  Exclude<WorkspacePanel, "parts" | "history"> | "auto" | "none";
export interface WorkspacePreferences {
  layout: "focused" | "full";
  pins: WorkspacePanel[];
  partsOpen: boolean;
  historyOpen: boolean;
}
const defaults = (): WorkspacePreferences => ({
  layout: "focused",
  pins: [],
  partsOpen: false,
  historyOpen: false,
});
export function readWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw || raw.length > 8192) return defaults();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaults();
    const data = value as Record<string, unknown>;
    const pins = Array.isArray(data.pins) ? data.pins : [];
    if (
      data.version !== 1 ||
      (data.layout !== "focused" && data.layout !== "full")
    )
      return defaults();
    return {
      layout: data.layout,
      pins: WORKSPACE_PANELS.filter((p) => pins.includes(p)),
      partsOpen: data.partsOpen === true,
      historyOpen: data.historyOpen === true,
    };
  } catch {
    return defaults();
  }
}
interface WorkspaceState extends WorkspacePreferences {
  activePanel: TaskPanel;
  sheet?: "parts" | "details";
  persistenceError?: string;
  setLayout(layout: WorkspacePreferences["layout"]): void;
  togglePin(panel: WorkspacePanel): void;
  toggleParts(): void;
  toggleHistory(): void;
  setPanel(panel: TaskPanel): void;
}
export const useWorkspaceState = create<WorkspaceState>((set, get) => {
  const update = (
    change: Partial<WorkspacePreferences>,
    transient: Pick<WorkspaceState, "sheet"> = {},
  ) => {
    const state = get();
    const preferences = {
      layout: state.layout,
      pins: state.pins,
      partsOpen: state.partsOpen,
      historyOpen: state.historyOpen,
      ...change,
    };
    let persistenceError: string | undefined;
    try {
      window.localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        JSON.stringify({ version: 1, ...preferences }),
      );
    } catch {
      persistenceError =
        "Workspace changed for this session. Browser storage is unavailable.";
    }
    set({ ...preferences, ...transient, persistenceError });
  };
  const preferences = readWorkspacePreferences();
  return {
    ...preferences,
    sheet: preferences.partsOpen ? "parts" : undefined,
    activePanel: "auto",
    setLayout: (layout) => {
      if (layout === "focused" || layout === "full") update({ layout });
    },
    togglePin: (panel) => {
      if (WORKSPACE_PANELS.includes(panel))
        update({
          pins: get().pins.includes(panel)
            ? get().pins.filter((p) => p !== panel)
            : [...get().pins, panel],
        });
    },
    toggleParts: () => {
      const opening = !get().partsOpen || get().sheet === "details";
      update({ partsOpen: opening }, { sheet: opening ? "parts" : undefined });
    },
    toggleHistory: () => update({ historyOpen: !get().historyOpen }),
    setPanel: (activePanel) => {
      if (
        activePanel === "auto" ||
        activePanel === "none" ||
        WORKSPACE_PANELS.includes(activePanel)
      )
        set({
          activePanel,
          sheet: activePanel === "none" ? undefined : "details",
        });
    },
  };
});
