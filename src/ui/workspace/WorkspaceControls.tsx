import { useShallow } from "zustand/react/shallow";
import { useWorkspacePresentation } from "./useWorkspacePresentation";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useCadStore } from "../../state/useCadStore";
import { TASK_PANELS } from "./WorkspacePanels";
import { activeComponentId } from "../commands/projectWorkflowCommand";

export function WorkspaceControls() {
  const workspace = useWorkspaceState(
    useShallow(
      ({
        layout,
        activePanel,
        setLayout,
        setPanel,
        toggleParts,
        toggleHistory,
        persistenceError,
      }) => ({
        layout,
        activePanel,
        setLayout,
        setPanel,
        toggleParts,
        toggleHistory,
        persistenceError,
      }),
    ),
  );
  const { partsVisible, historyVisible, hasHistory } =
    useWorkspacePresentation();
  const document = useCadStore((s) => s.history.present);
  const componentId = useCadStore(activeComponentId);
  const rebuild = useCadStore((s) => s.rebuild);
  const count =
    (rebuild.result?.errors.length ?? 0) +
    (rebuild.result?.warnings.length ?? 0);
  return (
    <div className="workspace-controls">
      <label>
        Workspace{" "}
        <select
          aria-label="Workspace layout"
          value={workspace.layout}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "focused" || value === "full")
              workspace.setLayout(value);
          }}
        >
          <option value="focused">Focused</option>
          <option value="full">Full workspace</option>
        </select>
      </label>
      <button
        id="workspace-parts-toggle"
        disabled={workspace.layout === "full"}
        title={
          workspace.layout === "full"
            ? "Parts is visible in Full workspace; choose Focused to collapse panels."
            : undefined
        }
        type="button"
        aria-expanded={partsVisible}
        aria-controls="workspace-parts"
        onClick={workspace.toggleParts}
      >
        Parts
      </button>
      <button
        type="button"
        aria-expanded={historyVisible}
        id="workspace-history-toggle"
        aria-controls="workspace-history"
        disabled={workspace.layout === "full" || !hasHistory}
        title={!hasHistory ? "Create a sketch to add history." : undefined}
        onClick={workspace.toggleHistory}
      >
        History (
        {document.features.length + Object.keys(document.sketches).length})
      </button>
      <label>
        Details{" "}
        <select
          id="workspace-task-panel"
          aria-label="Task panel"
          value={workspace.activePanel}
          onChange={(e) => {
            const panel = TASK_PANELS.find((p) => p.id === e.target.value);
            if (panel) workspace.setPanel(panel.id);
          }}
        >
          {TASK_PANELS.map((panel) => (
            <option key={panel.id} value={panel.id}>
              {panel.label}
            </option>
          ))}
        </select>
      </label>
      <span className="workspace-target">
        Editing: <strong>{document.components[componentId]?.name}</strong>
      </span>
      {count > 0 || rebuild.status === "failed" ? (
        <button
          type="button"
          className="error-text"
          onClick={() => workspace.setPanel("issues")}
        >
          Model issues ({count})
        </button>
      ) : null}
      {workspace.persistenceError ? (
        <span role="status">{workspace.persistenceError}</span>
      ) : null}
    </div>
  );
}
