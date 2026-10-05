import { ModelingCreationPanel } from "../ui/panels/ModelingCreationPanel";
import { AiDrawer } from "../ui/panels/AiDrawer";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { ExtrudeCreationPanel } from "../ui/panels/ExtrudeCreationPanel";
import { ProjectWorkflowPanel } from "../ui/panels/ProjectWorkflowPanel";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import { ThemeSelector } from "../ui/themes/ThemeSelector";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { ViewPanel } from "../ui/panels/ViewPanel";
import { MeasurementPanel } from "../ui/panels/MeasurementPanel";
import { RecoveryPanel } from "../ui/panels/RecoveryPanel";
import { FabricationPanel } from "../ui/panels/FabricationPanel";
import { HoleCreationPanel } from "../ui/panels/HoleCreationPanel";
import { useEffect, useMemo, useRef } from "react";
import { CadViewer } from "../viewer/CadViewer";
import { CommandContext, isCommandEnabledForSnapshot, runCommand, } from "../ui/commands/commandRegistry";
import { CommandPalette } from "../ui/commands/CommandPalette";
import { ParameterPanel } from "../ui/panels/ParameterPanel";
import { DependencyPanel } from "../ui/panels/DependencyPanel";
import { FeatureTimeline } from "../ui/panels/FeatureTimeline";
import { SketchPanel } from "../ui/panels/SketchPanel";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { RebuildErrorsPanel } from "../ui/panels/RebuildErrorsPanel";
import { useCadStore } from "../state/useCadStore";

type ToolbarButton = {
  command: string;
  label: string;
  icon: string;
  title: string;
  ariaLabel: string;
};

type ToolbarGroup = {
  label: string;
  buttons: ToolbarButton[];
};

const toolbarGroups: ToolbarGroup[] = [
  {
    label: "File",
    buttons: [
      { command: "file.openProject", label: "Open", icon: "O", title: "Open a .pcaddoc or JSON project file", ariaLabel: "Open project" },
      { command: "file.newProject", label: "New", icon: "N", title: "Create a blank local project", ariaLabel: "New project" },
      { command: "file.saveProject", label: "Save", icon: "S", title: "Download this project as a .pcaddoc file", ariaLabel: "Save project" },
      { command: "file.exportStl", label: "STL", icon: "STL", title: "Export the current rebuilt model as STL", ariaLabel: "Export STL" },
    ],
  },
  {
    label: "Sketch",
    buttons: [
      { command: "component.create", label: "Component", icon: "+", title: "Create and activate a component", ariaLabel: "New component" },
      { command: "sketch.create", label: "Create Sketch", icon: "+Sketch", title: "Choose a plane and draw in the active component", ariaLabel: "Create sketch" },
      { command: "sketch.editCanvas", label: "Canvas", icon: "Draw", title: "Draw in the selected sketch plane", ariaLabel: "Edit sketch canvas" },
      { command: "sketch.createXY", label: "XY", icon: "XY", title: "Create an XY sketch", ariaLabel: "Create XY sketch" },
      { command: "sketch.createXZ", label: "XZ", icon: "XZ", title: "Create an XZ sketch", ariaLabel: "Create XZ sketch" },
      { command: "sketch.createYZ", label: "YZ", icon: "YZ", title: "Create a YZ sketch", ariaLabel: "Create YZ sketch" },
      { command: "sketch.addCenterRectangle", label: "Rectangle", icon: "Rect", title: "Add a center rectangle to the active sketch", ariaLabel: "Add center rectangle" },
      { command: "sketch.addCircle", label: "Circle", icon: "Circ", title: "Add a circle to the active sketch", ariaLabel: "Add circle" },
    ],
  },
  {
    label: "Create",
    buttons: [
      { command: "feature.extrude", label: "Extrude", icon: "Ext", title: "Extrude the active sketch profile", ariaLabel: "Extrude selected sketch" },
      { command: "feature.revolve", label: "Revolve", icon: "Rev", title: "Revolve around a coplanar origin axis or sketch line; add a construction line if no axis is usable", ariaLabel: "Revolve selected sketch" },
      { command: "feature.hole", label: "Hole", icon: "Hole", title: "Choose sketch point centers and an explicit target body", ariaLabel: "Hole from selected sketch" },
      { command: "template.createMountingPlate", label: "Mount Plate", icon: "M", title: "Load the mounting plate template", ariaLabel: "Load mounting plate template" },
      { command: "template.createBox", label: "Box", icon: "B", title: "Load the parametric box template", ariaLabel: "Load parametric box template" },
    ],
  },
  {
    label: "Modify",
    buttons: [
      { command: "feature.fillet", label: "Fillet", icon: "Fil", title: "Round feature-owned extrusion edges", ariaLabel: "Fillet extrusion edges" },
      { command: "feature.chamfer", label: "Chamfer", icon: "Cha", title: "Bevel feature-owned extrusion edges", ariaLabel: "Chamfer extrusion edges" },
      { command: "feature.suppress", label: "Suppress", icon: "Sup", title: "Suppress or unsuppress the selected feature", ariaLabel: "Suppress or unsuppress feature" },
      { command: "feature.delete", label: "Delete", icon: "Del", title: "Delete the selected feature", ariaLabel: "Delete selected feature" },
    ],
  },
  {
    label: "View",
    buttons: [
      { command: "history.undo", label: "Undo", icon: "Undo", title: "Undo the last document edit", ariaLabel: "Undo" },
      { command: "history.redo", label: "Redo", icon: "Redo", title: "Redo the last undone edit", ariaLabel: "Redo" },
      { command: "view.fit", label: "Fit", icon: "Fit", title: "Fit the model in the viewer", ariaLabel: "Fit view" },
      { command: "view.resetCamera", label: "Reset", icon: "Reset", title: "Reset the viewer camera", ariaLabel: "Reset camera" },
    ],
  },
];

const helpItems = [
  ["Select", "Click objects in the viewer or side panels."],
  ["Orbit", "Drag in the viewer."],
  ["Pan", "Right-drag or middle-drag."],
  ["Zoom", "Scroll over the viewer."],
  ["Fit", "Press F or use Fit."],
  ["Cancel", "Press Escape."],
] as const;

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sketchActive = useSketchCanvas(state => state.active);
  const documentName = useCadStore((state) => state.history.present?.name ?? "Untitled");
  const rebuild = useCadStore((state) => state.rebuild);
  const fileError = useCadStore((state) => state.fileError);
  const initializeKernel = useCadStore((state) => state.initializeKernel);
  const select = useCadStore((state) => state.select);
  const setFileError = useCadStore((state) => state.setFileError);
  const commandContext: CommandContext = useMemo(() => ({ fileInputRef }), []);
  const toolbarEnablement = useCommandEnablement();

  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [sketchActive]);

  useEffect(() => {
    initializeKernel();
  }, [initializeKernel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]") || useSketchCanvas.getState().active) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toUpperCase();
      const isTyping = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable === true;
      if (!isTyping && event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        void runCommand("view.fit", commandContext);
      }
      if (!isTyping && event.key === "Escape") {
        select(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandContext, select]);

  return (
    <div className="app-shell">
      <header className="top-toolbar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <div>
            <strong>PlainCAD</strong>
            <span>{documentName}</span>
          </div>
        </div>
        <nav className="ribbon" aria-label="Main CAD commands">
          {toolbarGroups.map((group) => (
            <section className="ribbon-group" aria-label={group.label} key={group.label}>
              <div className="ribbon-buttons">
                {group.buttons.map((button) => (
                  <button
                    className="ribbon-button"
                    key={button.command}
                    title={button.title}
                    aria-label={button.ariaLabel}
                    onClick={() => runCommand(button.command, commandContext)}
                    disabled={!isCommandEnabledForSnapshot(button.command, toolbarEnablement)}
                  >
                    <span className="ribbon-icon" aria-hidden="true">{button.icon}</span>
                    <span>{button.label}</span>
                  </button>
                ))}
              </div>
              <span className="ribbon-label">{group.label}</span>
            </section>
          ))}
        </nav>
        <ThemeSelector />
        <div className={`rebuild-pill ${rebuild.status}`}>{rebuild.status}</div>
      </header>
      {rebuild.status === "loadingKernel" ? (
        <div className="kernel-banner" role="status">
          <strong>Loading CAD kernel...</strong>
          <span>{rebuild.message ?? "OpenCascade is starting in a worker. Geometry commands will run when it is ready."}</span>
        </div>
      ) : null}
      {fileError ? (
        <div className="kernel-banner error" role="alert">
          <strong>File error</strong>
          <span>{fileError}</span>
          <button type="button" onClick={() => setFileError(undefined)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <RecoveryPanel />
      <FabricationPanel />
      <HoleCreationPanel />
      <ExtrudeCreationPanel />
      <ModelingCreationPanel />
      <main className="workspace">
        <aside className="left-panel">
          <SketchPanel />
        </aside>
        <div className="model-area">
          <ProjectWorkflowPanel />
          <section className="viewer-region" aria-label="3D CAD viewer">
            <div className="model-view" hidden={Boolean(sketchActive)}><CadViewer /></div>
            <SketchCanvasPanel />
          </section>
          <FeatureTimeline commandContext={commandContext} />
        </div>
        <aside className="right-panel">
          <ParameterPanel />
          <InspectorPanel />
          <DependencyPanel />
          <MeasurementPanel />
          <ViewPanel />
          <RebuildErrorsPanel />
          <section className="panel help-panel" aria-labelledby="help-heading">
            <h2 id="help-heading">Help</h2>
            <dl className="help-list">
              {helpItems.map(([term, description]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </main>
      <AiDrawer />
      <CommandPalette context={commandContext} />
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept=".pcaddoc,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void runCommand("file.openProject", { ...commandContext, file });
          }
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
