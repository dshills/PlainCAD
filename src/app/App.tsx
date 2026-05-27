import { useEffect, useMemo, useRef } from "react";
import { CadViewer } from "../viewer/CadViewer";
import { canExportStl, runCommand } from "../ui/commands/commandRegistry";
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
  const fileError = useCadStore((state) => state.fileError);
  const initializeKernel = useCadStore((state) => state.initializeKernel);
  const select = useCadStore((state) => state.select);
  const setFileError = useCadStore((state) => state.setFileError);
  const stlExportEnabled = useCadStore(canExportStl);
  const commandContext = useMemo(() => ({ fileInputRef }), []);

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
          <button onClick={() => runCommand("file.newProject", commandContext)}>New</button>
          <button onClick={() => fileInputRef.current?.click()}>Open</button>
          <button onClick={() => runCommand("file.saveProject", commandContext)}>Save</button>
          <button onClick={() => runCommand("file.exportStl", commandContext)} disabled={!stlExportEnabled}>
            STL
          </button>
          <button onClick={() => runCommand("history.undo", commandContext)}>Undo</button>
          <button onClick={() => runCommand("history.redo", commandContext)}>Redo</button>
          <button onClick={() => runCommand("view.fit", commandContext)}>Fit</button>
          <button onClick={() => runCommand("view.resetCamera", commandContext)}>Reset</button>
          <button onClick={() => runCommand("template.createMountingPlate", commandContext)}>Mounting Plate</button>
          <button onClick={() => runCommand("template.createBox", commandContext)}>Box</button>
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
