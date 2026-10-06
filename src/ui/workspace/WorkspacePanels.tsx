import { useShallow } from "zustand/react/shallow";
import { WorkbenchDetailsDock } from "./WorkbenchDetailsDock";
import { RetainedPanel } from "./RetainedPanel";
import {
  useWorkspacePresentation,
  getWorkspacePresentation,
} from "./useWorkspacePresentation";
import type { ReactNode } from "react";
import {
  useWorkspaceState,
  type WorkspacePanel,
  type TaskPanel,
} from "../../state/useWorkspaceState";
import { ParameterPanel } from "../panels/ParameterPanel";
import { InspectorPanel } from "../panels/InspectorPanel";
import { DependencyPanel } from "../panels/DependencyPanel";
import { MeasurementPanel } from "../panels/MeasurementPanel";
import { ViewPanel } from "../panels/ViewPanel";
import { RebuildErrorsPanel } from "../panels/RebuildErrorsPanel";

export const TASK_PANELS: Array<{ id: TaskPanel; label: string }> = [
  { id: "auto", label: "Selection details" },
  { id: "none", label: "Hidden" },
  { id: "parameters", label: "Parameters" },
  { id: "inspector", label: "Inspector" },
  { id: "measure", label: "Measure" },
  { id: "views", label: "Views" },
  { id: "dependencies", label: "Dependencies" },
  { id: "issues", label: "Model issues" },
  { id: "help", label: "Help" },
];
export function PinPanel({
  panel,
  label,
}: {
  panel: WorkspacePanel;
  label: string;
}) {
  const pinned = useWorkspaceState((s) => s.pins.includes(panel));
  return (
    <button
      type="button"
      className="panel-pin"
      aria-label={`Pin ${label} panel`}
      aria-pressed={pinned}
      onClick={() => {
        const state = useWorkspaceState.getState();
        state.togglePin(panel);
        const presentation = getWorkspacePresentation();
        const visible =
          panel === "parts"
            ? presentation.partsVisible
            : panel === "history"
              ? presentation.historyVisible
              : presentation.detailsVisible &&
                (presentation.full ||
                  presentation.currentPanel === panel ||
                  useWorkspaceState.getState().pins.includes(panel));
        const willHide = pinned && !visible;
        if (willHide) {
          const target =
            panel === "parts"
              ? "#workspace-parts-toggle"
              : panel === "history"
                ? "#workspace-history-toggle"
                : "#workspace-task-panel";
          window.document.querySelector<HTMLElement>(target)?.focus();
        }
      }}
    >
      {pinned ? "Unpin" : "Pin"}
    </button>
  );
}
export function WorkspacePanels() {
  const layout = useWorkspaceState((state) => state.layout);
  return layout === "workbench" ? (
    <WorkbenchDetailsDock />
  ) : (
    <LegacyWorkspacePanels />
  );
}
function LegacyWorkspacePanels() {
  const { layout, pins } = useWorkspaceState(
    useShallow(({ layout, pins }) => ({ layout, pins })),
  );
  const { currentPanel: current, detailsVisible: visible } =
    useWorkspacePresentation();
  const panels: Array<{
    id: Exclude<TaskPanel, "auto" | "none">;
    label: string;
    content: ReactNode;
  }> = [
    { id: "parameters", label: "Parameters", content: <ParameterPanel /> },
    { id: "inspector", label: "Inspector", content: <InspectorPanel /> },
    { id: "dependencies", label: "Dependencies", content: <DependencyPanel /> },
    { id: "measure", label: "Measure", content: <MeasurementPanel /> },
    { id: "views", label: "Views", content: <ViewPanel /> },
    { id: "issues", label: "Model issues", content: <RebuildErrorsPanel /> },
    {
      id: "help",
      label: "Help",
      content: (
        <section className="panel help-panel">
          <h2>Help</h2>
          <dl className="help-list">
            {[
              ["Select", "Click objects in the viewer or side panels."],
              ["Orbit", "Drag in the viewer."],
              ["Pan", "Right-drag or middle-drag."],
              ["Zoom", "Scroll over the viewer."],
              ["Fit", "Press F or use Fit."],
              ["Cancel", "Press Escape."],
            ].map(([term, description]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ),
    },
  ];
  return (
    <aside
      className="right-panel"
      aria-label="Workspace details"
      hidden={!visible}
    >
      {layout === "focused" && (
        <div className="workspace-panel-header">
          <strong>Details</strong>
          <button
            type="button"
            onClick={() => {
              useWorkspaceState.getState().setPanel("none");
              window.document
                .querySelector<HTMLSelectElement>("#workspace-task-panel")
                ?.focus();
            }}
          >
            Close Details
          </button>
        </div>
      )}
      {panels.map((panel) => (
        <div
          key={panel.id}
          hidden={
            layout !== "full" &&
            current !== panel.id &&
            !pins.includes(panel.id)
          }
        >
          <PinPanel panel={panel.id} label={panel.label} />
          <RetainedPanel
            visible={
              visible &&
              (layout === "full" ||
                current === panel.id ||
                pins.includes(panel.id))
            }
          >
            {panel.content}
          </RetainedPanel>
        </div>
      ))}
    </aside>
  );
}
