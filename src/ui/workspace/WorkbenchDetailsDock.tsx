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

export function WorkbenchDetailsDock() {
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
      hidden={!dock.rightOpen || sketching}
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
            dock.configure({ rightOpen: false });
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
function TaskGuide() {
  const sketching = Boolean(useSketchCanvas((state) => state.active));
  const selected = useCadStore((state) => state.selection.selectedIds[0]);
  const feature = selected?.kind === "feature";
  const sketch = selected?.kind === "sketch";
  const title = sketching
    ? "Draw your shape"
    : feature
      ? "Refine this feature"
      : sketch
        ? "Make it solid"
        : "Choose what to work on";
  return (
    <section className="task-guide panel" aria-label="Next modeling action">
      <span className="ds-eyebrow">YOUR NEXT STEP</span>
      <h2>{title}</h2>
      <p>
        {sketching
          ? "Draw with the mouse. Click a dimension to set its exact size. Finish Sketch when the shape is ready."
          : feature
            ? "Edit this feature to see a native preview before applying the change."
            : sketch
              ? "Turn a closed sketch into a solid. Set a thickness or drag the distance handle, then Apply."
              : "Select a sketch or body on the canvas or in Project. Start a new sketch to draw something new."}
      </p>
      <div className="task-guide-actions">
        {feature ? (
          <CommandButton command="feature.edit" label="Edit feature" primary />
        ) : (
          <CommandButton
            command={sketch ? "feature.extrude" : "sketch.create"}
            label={sketch ? "Extrude sketch" : "Create sketch"}
            icon={sketch ? CubeIcon : PencilSimpleIcon}
            primary
          />
        )}
        {sketch ? (
          <CommandButton
            command="sketch.editCanvas"
            label="Edit sketch"
            accessibleLabel="Edit sketch canvas"
          />
        ) : null}
      </div>
      <details className="ds-advanced">
        <summary>More options</summary>
        <CommandButton command="component.create" label="New component" />
        <CommandButton
          command="feature.hole"
          label="Hole from selected sketch"
        />
        <CommandButton
          command="feature.delete"
          label="Delete selected feature"
        />
        <CommandButton
          command="feature.suppress"
          label="Suppress or unsuppress feature"
        />
      </details>
      <div className="task-guide-note">
        <strong>Prefer to describe it?</strong>
        <p>
          Open AI below. Review its geometry and dimensions before applying.
        </p>
      </div>
    </section>
  );
}
