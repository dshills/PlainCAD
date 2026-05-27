import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { CadViewer } from "../viewer/CadViewer";
import { isCommandEnabledForSnapshot, runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import { CommandPalette } from "../ui/commands/CommandPalette";
import { ParameterPanel } from "../ui/panels/ParameterPanel";
import { FeatureTimeline } from "../ui/panels/FeatureTimeline";
import { SketchPanel } from "../ui/panels/SketchPanel";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { RebuildErrorsPanel } from "../ui/panels/RebuildErrorsPanel";
import { useCadStore } from "../state/useCadStore";

type ToolbarButton = {
  command: string;
  label: string;
  title: string;
  ariaLabel: string;
};

const toolbarButtons: ToolbarButton[] = [
  { command: "file.openProject", label: "Open", title: "Open a .pcaddoc or JSON project file", ariaLabel: "Open project" },
  { command: "file.newProject", label: "New", title: "Create a new mounting plate project", ariaLabel: "New project" },
  { command: "file.saveProject", label: "Save", title: "Download this project as a .pcaddoc file", ariaLabel: "Save project" },
  { command: "file.exportStl", label: "STL", title: "Export the current rebuilt model as STL", ariaLabel: "Export STL" },
  { command: "history.undo", label: "Undo", title: "Undo the last document edit", ariaLabel: "Undo" },
  { command: "history.redo", label: "Redo", title: "Redo the last undone edit", ariaLabel: "Redo" },
  { command: "view.fit", label: "Fit", title: "Fit the model in the viewer", ariaLabel: "Fit view" },
  { command: "view.resetCamera", label: "Reset", title: "Reset the viewer camera", ariaLabel: "Reset camera" },
  { command: "template.createMountingPlate", label: "Mounting Plate", title: "Load the mounting plate template", ariaLabel: "Load mounting plate template" },
  { command: "template.createBox", label: "Box", title: "Load the parametric box template", ariaLabel: "Load parametric box template" },
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
  const documentName = useCadStore((state) => state.history.present?.name ?? "Untitled");
  const rebuild = useCadStore((state) => state.rebuild);
  const fileError = useCadStore((state) => state.fileError);
  const initializeKernel = useCadStore((state) => state.initializeKernel);
  const select = useCadStore((state) => state.select);
  const setFileError = useCadStore((state) => state.setFileError);
  const commandContext = useMemo(() => ({ fileInputRef }), []);
  const toolbarEnablement = useCadStore(useShallow(selectCommandEnablement));

  useEffect(() => {
    initializeKernel();
  }, [initializeKernel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
        <nav className="toolbar-actions" aria-label="Main CAD commands">
          {toolbarButtons.map((button) => (
            <button
              key={button.command}
              title={button.title}
              aria-label={button.ariaLabel}
              onClick={() => runCommand(button.command, commandContext)}
              disabled={!isCommandEnabledForSnapshot(button.command, toolbarEnablement)}
            >
              {button.label}
            </button>
          ))}
        </nav>
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
      <main className="workspace">
        <aside className="left-panel">
          <SketchPanel />
          <FeatureTimeline />
        </aside>
        <section className="viewer-region" aria-label="3D CAD viewer">
          <CadViewer />
        </section>
        <aside className="right-panel">
          <ParameterPanel />
          <InspectorPanel />
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
