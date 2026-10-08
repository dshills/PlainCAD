import { useShallow } from "zustand/react/shallow";
import { useWorkbenchState } from "../../state/useWorkbenchState";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { InspectorPanel } from "../panels/InspectorPanel";
import { MeasurementPanel } from "../panels/MeasurementPanel";
import { DependencyPanel } from "../panels/DependencyPanel";
import { ViewPanel } from "../panels/ViewPanel";
import { CommandButton } from "../design-system/CommandButton";
import { CubeIcon, PencilSimpleIcon, XIcon } from "../design-system/Icons";
import { RetainedPanel } from "./RetainedPanel";
import { DockResize } from "./DockResize";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { nextModelingAction, modelingPrerequisite } from "./modelingReadiness";
import { toggleAiDrawer, useAiDrawer } from "../commands/aiCommand";
import { sketchSolidHandoffCurrent, useSketchSolidHandoff } from "../commands/sketchSolidHandoffCommand";
import { useCompactWorkbench } from "./useCompactWorkbench";

export function WorkbenchDetailsDock() {
  const compact = useCompactWorkbench();
  const dock = useWorkbenchState(
    useShallow((state) => ({
      rightOpen: state.rightOpen,
      rightTab: state.rightTab,
      mobileDock: state.mobileDock,
      showRight: state.showRight,
      configure: state.configure,
    })),
  );
  const panel = useWorkspaceState((state) => state.activePanel);
  const current = ["measure", "views", "dependencies", "help"].includes(panel)
    ? panel
    : "inspector";
  const sketching = Boolean(useSketchCanvas((state) => state.active));
  const properties = dock.rightTab === "properties";
  return (
    <aside
      id="workbench-details"
      className={`workbench-dock workbench-right ${dock.mobileDock === "right" ? "mobile-current" : ""}`}
      aria-label="Workspace details"
      hidden={sketching || (compact ? dock.mobileDock !== "right" : !dock.rightOpen)}
    >
      <div className="dock-header">
        <div role="group" aria-label="Task dock tabs">
          <button
            type="button"
            aria-pressed={!properties}
            onClick={() => dock.showRight("task")}
          >
            Task
          </button>
          <button
            type="button"
            aria-pressed={properties}
            onClick={() => dock.showRight("properties")}
          >
            Properties
          </button>
        </div>
        <button
          type="button"
          className="dock-close"
          aria-label="Close Details"
          onClick={() => {
            if (compact) useWorkbenchState.setState({ mobileDock: "none" });
            else dock.configure({ rightOpen: false });
            window.document.getElementById("workspace-details-toggle")?.focus();
          }}
        >
          <XIcon size={16} aria-hidden={true} />
        </button>
      </div>
      <div className="dock-body">
        <div hidden={properties}>
          <TaskGuide />
        </div>
        <div hidden={!properties}>
          <label className="dock-tool-select">
            Show
            <select
              id="workspace-task-panel"
              aria-label="Task panel"
              value={current}
              onChange={(event) => {
                const id = event.target.value;
                if (
                  id === "inspector" ||
                  id === "measure" ||
                  id === "views" ||
                  id === "dependencies" ||
                  id === "help"
                )
                  useWorkspaceState.getState().setPanel(id);
              }}
            >
              <option value="inspector">Selection details</option>
              <option value="measure">Measure</option>
              <option value="views">Views & sections</option>
              <option value="dependencies">Dependencies</option>
              <option value="help">Help</option>
            </select>
          </label>
          {[
            { id: "inspector", content: <InspectorPanel /> },
            { id: "measure", content: <MeasurementPanel /> },
            { id: "views", content: <ViewPanel /> },
            { id: "dependencies", content: <DependencyPanel /> },
            {
              id: "help",
              content: (
                <section className="panel">
                  <h2>Navigation</h2>
                  <p>
                    Click to select. Drag to orbit. Right-drag to pan. Scroll to
                    zoom. Press F to fit.
                  </p>
                  <p>
                    Draw a sketch, finish it, then Extrude. Double-click a
                    sketch in Project to edit it. Select a feature in History to
                    edit, suppress or delete it.
                  </p>
                </section>
              ),
            },
          ].map(({ id, content }) => (
            <div key={id} hidden={current !== id}>
              <RetainedPanel visible={properties && current === id}>
                {content}
              </RetainedPanel>
            </div>
          ))}
        </div>
      </div>
      <DockResize dock="right" />
    </aside>
  );
}
export function TaskGuide() {
  const handoff = useSketchSolidHandoff((state) => state.source);
  const state = useCadStore(useShallow((store) => ({
    history: store.history,
    selection: store.selection,
    rebuild: store.rebuild,
    activeComponentId: store.activeComponentId,
    fileBusy: store.fileBusy,
    documentSession: store.documentSession,
  })));
  const enabled = useCommandEnablement();
  const guide = nextModelingAction(state);
  const prerequisite = guide.command
    ? modelingPrerequisite(guide.command, state, enabled)
    : undefined;
  const repair = guide.issue && state.rebuild.result ? {
    document: state.history.present,
    result: state.rebuild.result,
    session: state.documentSession,
    issueId: guide.issue.id,
  } : undefined;
  const more = [
    { command: "component.create", label: "New component" },
    { command: "feature.hole", label: "Hole from selected sketch" },
    { command: "feature.delete", label: "Delete selected feature" },
    { command: "feature.suppress", label: "Suppress or unsuppress feature" },
  ];
  if (handoff && sketchSolidHandoffCurrent(handoff, state)) return (
    <section className="task-guide panel" aria-label="Next modeling action" data-readiness="sketch-handoff">
      <span className="ds-eyebrow">YOUR NEXT STEP</span>
      <h2>Finish your sketch task</h2>
      <p>Use the sketch task in the canvas to choose a highlighted closed region, then Make solid to preview its thickness.</p>
      <p>Its Edit sketch and Cancel actions return control without creating a feature. Apply in the preview creates the solid.</p>
    </section>
  );
  return (
    <section className="task-guide panel" aria-label="Next modeling action" data-readiness={guide.state}>
      <span className="ds-eyebrow">YOUR NEXT STEP</span>
      <h2>{guide.title}</h2>
      <p>{guide.description}</p>
      {guide.note ? <p className="muted">{guide.note}</p> : null}
      <div className="task-guide-actions">
        {guide.command && guide.label ? (
          <CommandButton
            command={guide.command}
            label={guide.label}
            title={prerequisite ?? guide.label}
            icon={guide.command === "feature.extrude" ? CubeIcon : guide.command.startsWith("sketch.") ? PencilSimpleIcon : undefined}
            context={repair ? { repair } : undefined}
            primary
          />
        ) : null}
        {guide.state === "ready-sketch" ? (
          <CommandButton command="sketch.editCanvas" label="Edit sketch" accessibleLabel="Edit sketch canvas" />
        ) : null}
        {guide.state === "empty-sketch" || guide.state === "open-sketch" ? (
          <CommandButton command="feature.extrude" label="Extrude sketch" title={modelingPrerequisite("feature.extrude", state, enabled)} />
        ) : null}
        {guide.state === "broken-sketch" || guide.state === "failed-model" || guide.state === "open-sketch" || (guide.state === "ready-solid" && !guide.command) ? (
          <button type="button" className="ds-command" onClick={() => {
            if (useAiDrawer.getState().open) toggleAiDrawer();
            useWorkspaceState.getState().setPanel("issues");
          }}>Open Issues</button>
        ) : null}
      </div>
      {prerequisite ? <p className="muted">{prerequisite}</p> : null}
      {guide.state === "empty-sketch" || guide.state === "open-sketch" ? (
        <p className="muted">{modelingPrerequisite("feature.extrude", state, enabled)}</p>
      ) : null}
      <details className="ds-advanced">
        <summary>More options</summary>
        {more.map(({ command, label }) => {
          const reason = modelingPrerequisite(command, state, enabled);
          return <div key={command}>
            <CommandButton command={command} label={label} title={reason ?? label} />
            {reason ? <p className="muted">{reason}</p> : null}
          </div>;
        })}
      </details>
      <div className="task-guide-note">
        <strong>Prefer to describe it?</strong>
        <p>Open the bottom AI tab. Review its geometry and dimensions before applying.</p>
      </div>
    </section>
  );
}
