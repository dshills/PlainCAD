import { ReusablePartPanel } from "../ui/panels/ReusablePartPanel";
import { FacePocketPanel } from "../ui/panels/FacePocketPanel";
import { cancelFacePocket, useFacePocket } from "../ui/commands/facePocketCommand";
import { SolidDimensionEditor } from "../ui/panels/SolidDimensionEditor";
import { SketchSolidHandoffPanel } from "../ui/panels/SketchSolidHandoffPanel";
import { OperationDropPanel } from "../ui/panels/OperationDropPanel";
import { GuidedHolePanel } from "../ui/panels/GuidedHolePanel";
import { useShallow } from "zustand/react/shallow";
import { useWorkspacePresentation } from "../ui/workspace/useWorkspacePresentation";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { WorkspacePanels, PinPanel } from "../ui/workspace/WorkspacePanels";
import { WorkspaceControls } from "../ui/workspace/WorkspaceControls";
import { ProjectStart } from "../ui/workspace/ProjectStart";
import { ProjectFileDrop } from "../ui/workspace/ProjectFileDrop";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { ModelingCreationPanel } from "../ui/panels/ModelingCreationPanel";
import { WorkbenchBottomDock } from "../ui/workspace/WorkbenchBottomDock";
import { WorkbenchHeader } from "../ui/workspace/WorkbenchHeader";
import { WorkbenchProjectDock } from "../ui/workspace/WorkbenchProjectDock";
import { useWorkbenchState } from "../state/useWorkbenchState";
import type { CSSProperties } from "react";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { ExtrudeCreationPanel } from "../ui/panels/ExtrudeCreationPanel";
import { ProjectWorkflowPanel } from "../ui/panels/ProjectWorkflowPanel";
import { RetainedPanel } from "../ui/workspace/RetainedPanel";
import { ThemeSelector } from "../ui/themes/ThemeSelector";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { RecoveryPanel } from "../ui/panels/RecoveryPanel";
import { FabricationPanel } from "../ui/panels/FabricationPanel";
import { HoleCreationPanel } from "../ui/panels/HoleCreationPanel";
import { FeaturePatternPanel } from "../ui/panels/FeaturePatternPanel";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { CadViewer } from "../viewer/CadViewer";
import {
  CommandContext,
  isCommandEnabledForSnapshot,
  runCommand,
} from "../ui/commands/commandRegistry";
import { CommandPalette } from "../ui/commands/CommandPalette";
import { FeatureTimeline } from "../ui/panels/FeatureTimeline";
import { SketchPanel } from "../ui/panels/SketchPanel";
import { useCadStore } from "../state/useCadStore";
import { usePartLibrary } from "../ui/commands/partLibraryState";
import { useStepExport } from "../ui/commands/stepExportState";

const ComponentPlacementPanel = lazy(() => import("../ui/panels/ComponentPlacementPanel").then(module => ({ default: module.ComponentPlacementPanel })));
const PartLibraryPanel = lazy(() => import("../ui/panels/PartLibraryPanel").then(module => ({ default: module.PartLibraryPanel })));
const StepExportPanel = lazy(() => import("../ui/panels/StepExportPanel").then(module => ({ default: module.StepExportPanel })));

const SketchCanvasPanel = lazy(() =>
  import("../ui/panels/SketchCanvasPanel").then((module) => ({ default: module.SketchCanvasPanel })),
);

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
      {
        command: "file.openProject",
        label: "Open",
        icon: "O",
        title: "Open a .pcaddoc or JSON project file",
        ariaLabel: "Open project",
      },
      {
        command: "file.newProject",
        label: "New",
        icon: "N",
        title: "Create a blank local project",
        ariaLabel: "New project",
      },
      {
        command: "file.saveOrExport",
        label: "Save or export…",
        icon: "File",
        title:
          "Save an editable project or choose bodies to export for printing",
        ariaLabel: "Save or export",
      },
      {
        command: "file.saveProject",
        label: "Save",
        icon: "S",
        title: "Download this project as a .pcaddoc file",
        ariaLabel: "Save project",
      },
      {
        command: "file.exportStl",
        label: "STL",
        icon: "STL",
        title: "Export the current rebuilt model as STL",
        ariaLabel: "Export STL",
      },
      { command: "file.exportStep", label: "STEP", icon: "STEP", title: "Export separate native solids with verified STEP round trip", ariaLabel: "Export STEP" },
      { command: "file.exportProjectPng", label: "Project PNG", icon: "PNG", title: "Download the current 3D view", ariaLabel: "Download project view PNG" },
      { command: "file.exportBodyPng", label: "Part PNG", icon: "PNG", title: "Select a body to download its image alone", ariaLabel: "Download selected part PNG" },
      { command: "file.exportSketchPng", label: "Sketch PNG", icon: "PNG", title: "Open a sketch to download its drawing", ariaLabel: "Download sketch PNG" },
    ],
  },
  {
    label: "Sketch",
    buttons: [
      {
        command: "component.create",
        label: "Component",
        icon: "+",
        title: "Create and activate a component",
        ariaLabel: "New component",
      },
      {
        command: "sketch.create",
        label: "Create Sketch",
        icon: "+Sketch",
        title: "Choose a plane and draw in the active component",
        ariaLabel: "Create sketch",
      },
      {
        command: "sketch.editCanvas",
        label: "Canvas",
        icon: "Draw",
        title: "Draw in the selected sketch plane",
        ariaLabel: "Edit sketch canvas",
      },
      {
        command: "sketch.facePocket",
        label: "Draw on face",
        icon: "Face",
        title: "Choose a supported planar face and draw a pocket sketch",
        ariaLabel: "Draw on face",
      },
      {
        command: "sketch.createXY",
        label: "XY",
        icon: "XY",
        title: "Create an XY sketch",
        ariaLabel: "Create XY sketch",
      },
      {
        command: "sketch.createXZ",
        label: "XZ",
        icon: "XZ",
        title: "Create an XZ sketch",
        ariaLabel: "Create XZ sketch",
      },
      {
        command: "sketch.createYZ",
        label: "YZ",
        icon: "YZ",
        title: "Create a YZ sketch",
        ariaLabel: "Create YZ sketch",
      },
      {
        command: "sketch.addCenterRectangle",
        label: "Rectangle",
        icon: "Rect",
        title: "Add a center rectangle to the active sketch",
        ariaLabel: "Add center rectangle",
      },
      {
        command: "sketch.addCircle",
        label: "Circle",
        icon: "Circ",
        title: "Add a circle to the active sketch",
        ariaLabel: "Add circle",
      },
    ],
  },
  {
    label: "Create",
    buttons: [
      {
        command: "feature.extrude",
        label: "Extrude",
        icon: "Ext",
        title: "Extrude the active sketch profile",
        ariaLabel: "Extrude selected sketch",
      },
      {
        command: "feature.revolve",
        label: "Revolve",
        icon: "Rev",
        title:
          "Revolve around a coplanar origin axis or sketch line; add a construction line if no axis is usable",
        ariaLabel: "Revolve selected sketch",
      },
      {
        command: "feature.guidedHole",
        label: "Face Holes",
        icon: "FHole",
        title: "Select a supported planar face and place hole centers visually",
        ariaLabel: "Place holes on face",
      },
      {
        command: "feature.hole",
        label: "Hole",
        icon: "Hole",
        title: "Choose sketch point centers and an explicit target body",
        ariaLabel: "Hole from selected sketch",
      },
      {
        command: "feature.pattern",
        label: "Pattern",
        icon: "Pat",
        title: "Repeat a selected Hole or distance Cut Extrude",
        ariaLabel: "Repeat selected hole or pocket",
      },
      {
        command: "template.createMountingPlate",
        label: "Mount Plate",
        icon: "M",
        title: "Load the mounting plate template",
        ariaLabel: "Load mounting plate template",
      },
      {
        command: "template.createBox",
        label: "Box",
        icon: "B",
        title: "Load the parametric box template",
        ariaLabel: "Load parametric box template",
      },
    ],
  },
  {
    label: "Modify",
    buttons: [
      {
        command: "feature.fillet",
        label: "Fillet",
        icon: "Fil",
        title: "Round feature-owned extrusion edges",
        ariaLabel: "Fillet extrusion edges",
      },
      {
        command: "feature.chamfer",
        label: "Chamfer",
        icon: "Cha",
        title: "Bevel feature-owned extrusion edges",
        ariaLabel: "Chamfer extrusion edges",
      },
      {
        command: "feature.suppress",
        label: "Suppress",
        icon: "Sup",
        title: "Suppress or unsuppress the selected feature",
        ariaLabel: "Suppress or unsuppress feature",
      },
      {
        command: "feature.delete",
        label: "Delete",
        icon: "Del",
        title: "Delete the selected feature",
        ariaLabel: "Delete selected feature",
      },
    ],
  },
  {
    label: "View",
    buttons: [
      {
        command: "history.undo",
        label: "Undo",
        icon: "Undo",
        title: "Undo the last document edit",
        ariaLabel: "Undo",
      },
      {
        command: "history.redo",
        label: "Redo",
        icon: "Redo",
        title: "Redo the last undone edit",
        ariaLabel: "Redo",
      },
      {
        command: "view.fit",
        label: "Fit",
        icon: "Fit",
        title: "Fit the model in the viewer",
        ariaLabel: "Fit view",
      },
      {
        command: "view.resetCamera",
        label: "Reset",
        icon: "Reset",
        title: "Reset the viewer camera",
        ariaLabel: "Reset camera",
      },
    ],
  },
];

const FOCUSED_ALWAYS = new Set([
  "history.undo",
  "history.redo",
  "view.fit",
  "sketch.create",
]);
const FOCUSED_WHEN_ENABLED = new Set([
  "sketch.editCanvas",
  "feature.extrude",
  "feature.revolve",
  "feature.hole",
  "feature.pattern",
  "feature.guidedHole",
]);

export function App() {
  const partLibraryOpen = usePartLibrary(state => Boolean(state.frame));
  const stepExportOpen = useStepExport(state => Boolean(state.frame));
  const workspace = useWorkspaceState(
    useShallow(({ layout, activePanel, pins, toggleParts }) => ({
      layout,
      activePanel,
      pins,
      toggleParts,
    })),
  );
  const workbench = workspace.layout === "workbench";
  const dock = useWorkbenchState(
    useShallow(
      ({
        leftOpen,
        rightOpen,
        leftWidth,
        rightWidth,
        bottomHeight,
        bottomOpen,
      }) => ({
        leftOpen,
        rightOpen,
        leftWidth,
        rightWidth,
        bottomHeight,
        bottomOpen,
      }),
    ),
  );
  const setPaletteOpen = useCadStore((s) => s.setPaletteOpen);
  const { full, partsVisible, historyVisible } =
    useWorkspacePresentation();
  const aiOpen = useAiDrawer((s) => s.open);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sketchActive = useSketchCanvas((state) => state.active);
  const documentName = useCadStore(
    (state) => state.history.present?.name ?? "Untitled",
  );
  const rebuild = useCadStore((state) => state.rebuild);
  const fileError = useCadStore((state) => state.fileError);
  const initializeKernel = useCadStore((state) => state.initializeKernel);
  const select = useCadStore((state) => state.select);
  const setFileError = useCadStore((state) => state.setFileError);
  const commandContext: CommandContext = useMemo(() => ({ fileInputRef }), []);
  const toolbarEnablement = useCommandEnablement();

  useEffect(() => {
    const notify = () => window.dispatchEvent(new Event("resize"));
    if (typeof window.requestAnimationFrame !== "function") {
      notify();
      return;
    }
    const frame = window.requestAnimationFrame(notify);
    return () => window.cancelAnimationFrame(frame);
  }, [
    sketchActive,
    workspace.layout,
    partsVisible,
    historyVisible,
    workspace.activePanel,
    workspace.pins,
    dock.leftOpen,
    dock.rightOpen,
    dock.leftWidth,
    dock.rightWidth,
    dock.bottomHeight,
    dock.bottomOpen,
    aiOpen,
  ]);

  useEffect(() => {
    initializeKernel();
  }, [initializeKernel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        useSketchCanvas.getState().active
      )
        return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toUpperCase();
      const isTyping =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target?.isContentEditable === true;
      if (
        !isTyping &&
        event.key.toLowerCase() === "f" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        void runCommand("view.fit", commandContext);
      }
      if (!isTyping && event.key === "Escape") {
        if (useFacePocket.getState().frame) { cancelFacePocket(); return; }
        select(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandContext, select]);

  const shell = (
    <div
      className={`app-shell ${workbench ? "docked-workbench" : full ? "full-workspace" : "focused-workspace"}`}
      style={
        workbench
          ? ({
              "--left-width": `${dock.leftWidth}px`,
              "--right-width": `${dock.rightWidth}px`,
              "--bottom-height": `${dock.bottomHeight}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {workbench ? (
        <WorkbenchHeader context={commandContext} />
      ) : (
        <header className="top-toolbar">
          <div className="brand">
            <span className="brand-mark">P</span>
            <div>
              <strong>PlainCAD</strong>
              <span>{documentName}</span>
            </div>
          </div>
          <nav className="ribbon" aria-label="Main CAD commands">
            {toolbarGroups.map((group) => {
              const buttons = group.buttons.filter(
                (button) =>
                  full ||
                  group.label === "File" ||
                  FOCUSED_ALWAYS.has(button.command) ||
                  (FOCUSED_WHEN_ENABLED.has(button.command) &&
                    isCommandEnabledForSnapshot(
                      button.command,
                      toolbarEnablement,
                    )),
              );
              if (!buttons.length) return null;
              return (
                <section
                  className="ribbon-group"
                  aria-label={group.label}
                  key={group.label}
                >
                  <div className="ribbon-buttons">
                    {buttons.map((button) => (
                      <button
                        className="ribbon-button"
                        key={button.command}
                        title={button.title}
                        aria-label={button.ariaLabel}
                        onClick={() =>
                          runCommand(button.command, commandContext)
                        }
                        disabled={
                          !isCommandEnabledForSnapshot(
                            button.command,
                            toolbarEnablement,
                          )
                        }
                      >
                        <span className="ribbon-icon" aria-hidden="true">
                          {button.icon}
                        </span>
                        <span>{button.label}</span>
                      </button>
                    ))}
                  </div>
                  <span className="ribbon-label">{group.label}</span>
                </section>
              );
            })}
          </nav>
          <button
            type="button"
            className="all-tools-button"
            title="Search all CAD commands (Ctrl/Cmd+K)"
            onClick={(event) => {
              // WebKit does not focus buttons on mouse click; capture a stable modal return target.
              event.currentTarget.focus();
              setPaletteOpen(true);
            }}
          >
            All tools
          </button>
          {full ? (
            <ThemeSelector />
          ) : (
            <details className="appearance-settings">
              <summary>Settings</summary>
              <ThemeSelector />
            </details>
          )}
          <div className={`rebuild-pill ${rebuild.status}`}>
            {rebuild.status}
          </div>
        </header>
      )}
      {rebuild.status === "loadingKernel" ? (
        <div className="kernel-banner" role="status">
          <strong>Loading CAD kernel...</strong>
          <span>
            {rebuild.message ??
              "OpenCascade is starting in a worker. Geometry commands will run when it is ready."}
          </span>
        </div>
      ) : null}
      {fileError ? (
        <div className="kernel-banner error" role="alert">
          <strong>
            {fileError.startsWith("Command failed:")
              ? "Command error"
              : "File error"}
          </strong>
          <span>{fileError}</span>
          <button type="button" onClick={() => setFileError(undefined)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <RecoveryPanel />
      <FabricationPanel />
      <HoleCreationPanel />
      <Suspense fallback={<p role="status">Loading component controls…</p>}><ComponentPlacementPanel /></Suspense>
      <FeaturePatternPanel />
      <SolidDimensionEditor />
      <ExtrudeCreationPanel />
      <FacePocketPanel />
      <ModelingCreationPanel />
      <div className="workspace-control-row">
        <WorkspaceControls />
        <ProjectStart context={commandContext} />
      </div>
      <main
        className={`workspace ${workbench ? "workbench-workspace" : full ? "" : "workspace-focused"} ${partsVisible ? "parts-open" : ""}`}
      >
        {workbench ? (
          <WorkbenchProjectDock />
        ) : (
          <aside
            id="workspace-parts"
            className="left-panel"
            aria-label="Parts browser"
            hidden={!partsVisible}
          >
            <div className="workspace-panel-header">
              <PinPanel panel="parts" label="Parts" />
              {!full && (
                <button
                  type="button"
                  onClick={() => {
                    workspace.toggleParts();
                    window.document
                      .getElementById("workspace-parts-toggle")
                      ?.focus();
                  }}
                  disabled={workspace.pins.includes("parts")}
                >
                  Close Parts
                </button>
              )}
            </div>
            <SketchPanel />
          </aside>
        )}
        <div className="model-area">
          <ReusablePartPanel />
          <ProjectWorkflowPanel />
          <GuidedHolePanel />
          <section className="viewer-region" aria-label="3D CAD viewer">
            {partLibraryOpen ? <Suspense fallback={<p role="status">Loading local parts…</p>}><PartLibraryPanel /></Suspense> : null}
            {stepExportOpen ? <Suspense fallback={<p role="status">Loading STEP export…</p>}><StepExportPanel /></Suspense> : null}
            {!sketchActive ? <><SketchSolidHandoffPanel /><OperationDropPanel /></> : null}
            <div className="model-view" hidden={Boolean(sketchActive)}>
              <CadViewer />
            </div>
            <RetainedPanel visible={Boolean(sketchActive)}>
              <Suspense fallback={<p role="status">Loading sketch editor…</p>}>
                <SketchCanvasPanel />
              </Suspense>
            </RetainedPanel>
          </section>
          {!workbench ? (
            <div
              id="workspace-history"
              className="workspace-history"
              hidden={!historyVisible}
            >
              <PinPanel panel="history" label="History" />
              <FeatureTimeline commandContext={commandContext} />
            </div>
          ) : null}
        </div>
        <WorkspacePanels />
      </main>
      <WorkbenchBottomDock context={commandContext} enabled={workbench} />
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
  return <ProjectFileDrop>{shell}</ProjectFileDrop>;
}
