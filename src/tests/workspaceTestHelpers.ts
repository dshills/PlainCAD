import { useWorkspaceState } from "../state/useWorkspaceState";
export function resetWorkspace(layout: "focused" | "full" = "full") {
  useWorkspaceState.setState({
    layout,
    pins: [],
    activePanel: "auto",
    partsOpen: false,
    historyOpen: false,
    sheet: undefined,
    persistenceError: undefined,
  });
}
