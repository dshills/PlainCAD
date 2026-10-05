import { useShallow } from "zustand/react/shallow";
import { useSyncExternalStore } from "react";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
const query = "(max-width: 1060px)";
function subscribe(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(query);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  media.addListener(listener);
  return () => media.removeListener(listener);
}
export const compactSnapshot = () =>
  typeof window.matchMedia === "function" && window.matchMedia(query).matches;
const selectHasHistory = (s: CadStore) =>
  s.history.present.features.length > 0 ||
  Object.keys(s.history.present.sketches).length > 0;

export function useWorkspacePresentation() {
  const compact = useSyncExternalStore(subscribe, compactSnapshot, () => false);
  const workspace = useWorkspaceState(
    useShallow(
      ({ layout, activePanel, partsOpen, historyOpen, pins, sheet }) => ({
        layout,
        activePanel,
        partsOpen,
        historyOpen,
        pins,
        sheet,
      }),
    ),
  );
  const selected = useCadStore((s) => s.selection.selectedIds[0]);
  const hasHistory = useCadStore(selectHasHistory);
  const sketching = useSketchCanvas((s) => Boolean(s.active));
  return workspacePresentation(
    workspace,
    compact,
    Boolean(selected),
    sketching,
    hasHistory,
  );
}

export function workspacePresentation(
  workspace: Pick<
    ReturnType<typeof useWorkspaceState.getState>,
    "layout" | "activePanel" | "partsOpen" | "historyOpen" | "pins" | "sheet"
  >,
  compact: boolean,
  selected: boolean,
  sketching: boolean,
  hasHistory: boolean,
) {
  const full = workspace.layout === "full";

  const currentPanel =
    workspace.activePanel === "auto"
      ? selected && !sketching
        ? "inspector"
        : undefined
      : workspace.activePanel === "none"
        ? undefined
        : workspace.activePanel;
  const partsRequested =
    workspace.partsOpen || workspace.pins.includes("parts");
  const detailsRequested =
    Boolean(currentPanel) ||
    workspace.pins.some((p) => p !== "parts" && p !== "history");
  return {
    full,
    hasHistory,
    currentPanel,
    partsVisible:
      full ||
      (partsRequested &&
        (!compact || !detailsRequested || workspace.sheet !== "details")),
    detailsVisible:
      full ||
      (detailsRequested &&
        (!compact || !partsRequested || workspace.sheet === "details")),
    historyVisible:
      full ||
      (hasHistory &&
        (workspace.historyOpen || workspace.pins.includes("history"))),
  };
}

export function getWorkspacePresentation() {
  const cad = useCadStore.getState();
  return workspacePresentation(
    useWorkspaceState.getState(),
    compactSnapshot(),
    Boolean(cad.selection.selectedIds[0]),
    Boolean(useSketchCanvas.getState().active),
    selectHasHistory(cad),
  );
}
