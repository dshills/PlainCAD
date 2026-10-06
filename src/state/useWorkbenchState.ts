import { create } from "zustand";

export const WORKBENCH_STORAGE_KEY = "plaincad.workbench.v1";
export type WorkbenchLeftTab = "project" | "parameters";
export type WorkbenchBottomTab = "history" | "ai" | "issues";
export interface WorkbenchPreferences {
  leftOpen: boolean;
  rightOpen: boolean;
  leftTab: WorkbenchLeftTab;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
}
const defaults = (): WorkbenchPreferences => ({
  leftOpen: true,
  rightOpen: true,
  leftTab: "project",
  leftWidth: 256,
  rightWidth: 304,
  bottomHeight: 224,
});
export const DOCK_LIMITS = {
  leftWidth: { min: 224, max: 400 },
  rightWidth: { min: 280, max: 440 },
  bottomHeight: { min: 160, max: 360 },
} as const;
export function boundedDockSize(key: keyof typeof DOCK_LIMITS, value: unknown) {
  const { min, max } = DOCK_LIMITS[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : defaults()[key];
}
export function readWorkbenchPreferences(): WorkbenchPreferences {
  try {
    const raw = window.localStorage.getItem(WORKBENCH_STORAGE_KEY);
    if (!raw || raw.length > 2048) return defaults();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaults();
    const data = value as Record<string, unknown>;
    if (data.version !== 1) return defaults();
    return {
      leftOpen: typeof data.leftOpen === "boolean" ? data.leftOpen : true,
      rightOpen: typeof data.rightOpen === "boolean" ? data.rightOpen : true,
      leftTab: data.leftTab === "parameters" ? "parameters" : "project",
      leftWidth: boundedDockSize("leftWidth", data.leftWidth),
      rightWidth: boundedDockSize("rightWidth", data.rightWidth),
      bottomHeight: boundedDockSize("bottomHeight", data.bottomHeight),
    };
  } catch {
    return defaults();
  }
}
interface WorkbenchState extends WorkbenchPreferences {
  rightTab: "task" | "properties";
  bottomTab: WorkbenchBottomTab;
  bottomOpen: boolean;
  mobileDock: "left" | "right";
  persistenceError?: string;
  configure(change: Partial<WorkbenchPreferences>): void;
  showLeft(tab: WorkbenchLeftTab): void;
  showRight(tab: "task" | "properties"): void;
  showBottom(tab: WorkbenchBottomTab): void;
}
/** Layout preferences are local UI data. No document edits, rebuilds or runtime CAD data. */
export const useWorkbenchState = create<WorkbenchState>((set, get) => ({
  ...readWorkbenchPreferences(),
  rightTab: "task",
  bottomTab: "history",
  bottomOpen: false,
  mobileDock: "left",
  configure: (change) => {
    const state = get();
    const preferences: WorkbenchPreferences = {
      leftOpen: change.leftOpen ?? state.leftOpen,
      rightOpen: change.rightOpen ?? state.rightOpen,
      leftTab: change.leftTab ?? state.leftTab,
      leftWidth: boundedDockSize(
        "leftWidth",
        change.leftWidth ?? state.leftWidth,
      ),
      rightWidth: boundedDockSize(
        "rightWidth",
        change.rightWidth ?? state.rightWidth,
      ),
      bottomHeight: boundedDockSize(
        "bottomHeight",
        change.bottomHeight ?? state.bottomHeight,
      ),
    };
    let persistenceError: string | undefined;
    try {
      window.localStorage.setItem(
        WORKBENCH_STORAGE_KEY,
        JSON.stringify({ version: 1, ...preferences }),
      );
    } catch {
      persistenceError =
        "Layout changed for this session. Browser storage is unavailable.";
    }
    set({ ...preferences, persistenceError });
  },
  showLeft: (leftTab) => {
    get().configure({ leftTab, leftOpen: true });
    set({ mobileDock: "left" });
  },
  showRight: (rightTab) => {
    get().configure({ rightOpen: true });
    set({ rightTab, mobileDock: "right" });
  },
  showBottom: (bottomTab) => set({ bottomTab, bottomOpen: true }),
}));
