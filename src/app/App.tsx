import { useMemo, useRef } from "react";
import { CadViewer } from "../viewer/CadViewer";
import { runCommand } from "../ui/commands/commandRegistry";
import { CommandPalette } from "../ui/commands/CommandPalette";
import { ParameterPanel } from "../ui/panels/ParameterPanel";
import { FeatureTimeline } from "../ui/panels/FeatureTimeline";
import { SketchPanel } from "../ui/panels/SketchPanel";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { RebuildErrorsPanel } from "../ui/panels/RebuildErrorsPanel";
import { useCadStore } from "../state/useCadStore";

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentName = useCadStore((state) => state.history.present.name);
  const rebuild = useCadStore((state) => state.rebuild);
  const commandContext = useMemo(() => ({ fileInputRef }), []);

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
          <button onClick={() => runCommand("file.newProject", commandContext)}>New</button>
          <button onClick={() => fileInputRef.current?.click()}>Open</button>
          <button onClick={() => runCommand("file.saveProject", commandContext)}>Save</button>
          <button onClick={() => runCommand("file.exportStl", commandContext)}>STL</button>
          <button onClick={() => runCommand("history.undo", commandContext)}>Undo</button>
          <button onClick={() => runCommand("history.redo", commandContext)}>Redo</button>
          <button onClick={() => runCommand("template.createMountingPlate", commandContext)}>Mounting Plate</button>
          <button onClick={() => runCommand("template.createBox", commandContext)}>Box</button>
        </nav>
        <div className={`rebuild-pill ${rebuild.status}`}>{rebuild.status}</div>
      </header>
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
