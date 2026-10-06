import { useShallow } from "zustand/react/shallow";
import { useSyncExternalStore } from "react";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { COMPACT_QUERY, compactSnapshot } from "../../state/workbenchViewport";
export { compactSnapshot } from "../../state/workbenchViewport";
function subscribe(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(COMPACT_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  media.addListener(listener);
  return () => media.removeListener(listener);
}
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
