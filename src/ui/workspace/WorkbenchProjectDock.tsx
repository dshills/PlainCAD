import { useWorkbenchState } from "../../state/useWorkbenchState";
import { SketchPanel } from "../panels/SketchPanel";
import { ParameterPanel } from "../panels/ParameterPanel";
import { XIcon } from "../design-system/Icons";
import { RetainedPanel } from "./RetainedPanel";
import { DockResize } from "./DockResize";
export function WorkbenchProjectDock() {
  const dock = useWorkbenchState();
  return (
    <aside
      id="workbench-project"
      aria-label="Parts browser"
      className={`workbench-dock workbench-left ${dock.mobileDock === "left" ? "mobile-current" : ""}`}
      hidden={!dock.leftOpen}
    >
      <div className="dock-header">
        <div role="group" aria-label="Project dock tabs">
          <button
            type="button"
            aria-pressed={dock.leftTab === "project"}
            onClick={() => dock.showLeft("project")}
          >
            Project
          </button>
          <button
            type="button"
            aria-pressed={dock.leftTab === "parameters"}
            onClick={() => dock.showLeft("parameters")}
          >
            Parameters
          </button>
        </div>
        <button
          type="button"
          className="dock-close"
          aria-label="Close Parts"
          onClick={() => {
            dock.configure({ leftOpen: false });
            window.document.getElementById("workspace-parts-toggle")?.focus();
          }}
        >
          <XIcon size={16} aria-hidden={true} />
        </button>
      </div>
      <div className="dock-body">
        <div hidden={dock.leftTab !== "project"}>
          <SketchPanel compact />
        </div>
        <div hidden={dock.leftTab !== "parameters"}>
          <RetainedPanel visible={dock.leftTab === "parameters"}>
            <ParameterPanel />
          </RetainedPanel>
        </div>
      </div>
      <DockResize dock="left" />
    </aside>
  );
}
