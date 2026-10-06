import { useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import type { CommandContext } from "../commands/commandRegistry";
import { CommandButton } from "../design-system/CommandButton";
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CaretDownIcon,
  CircleIcon,
  CubeIcon,
  CylinderIcon,
  FloppyDiskIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  RulerIcon,
  SquareIcon,
  ArrowsOutSimpleIcon,
} from "../design-system/Icons";
import { ThemeSelector } from "../themes/ThemeSelector";
import { useWorkbenchState } from "../../state/useWorkbenchState";

type Mode = "draw" | "solid" | "inspect";
const groups = {
  draw: [
    ["sketch.create", "Create sketch", "Create sketch", PencilSimpleIcon],
    ["sketch.facePocket", "Draw on face", "Draw on face", PencilSimpleIcon],
    [
      "sketch.editCanvas",
      "Edit sketch",
      "Edit sketch canvas",
      PencilSimpleIcon,
    ],
    [
      "sketch.addCenterRectangle",
      "Rectangle",
      "Add center rectangle",
      SquareIcon,
    ],
    ["sketch.addCircle", "Circle", "Add circle", CircleIcon],
  ],
  solid: [
    ["feature.extrude", "Extrude", "Extrude selected sketch", CubeIcon],
    ["feature.revolve", "Revolve", "Revolve selected sketch", CylinderIcon],
    ["feature.guidedHole", "Hole", "Place holes on face", CircleIcon],
    ["feature.fillet", "Fillet", "Fillet extrusion edges", CylinderIcon],
    ["feature.chamfer", "Chamfer", "Chamfer extrusion edges", CubeIcon],
  ],
} as const;
export function WorkbenchHeader({ context }: { context: CommandContext }) {
  const name = useCadStore((state) => state.history.present.name);
  const rebuild = useCadStore((state) => state.rebuild);
  const sketching = Boolean(useSketchCanvas((state) => state.active));
  const [mode, setMode] = useState<Mode>("solid");
  const current = sketching ? "draw" : mode;
  const palette = useCadStore((state) => state.setPaletteOpen);
  return (
    <header className="workbench-header">
      <nav aria-label="Main CAD commands">
        <div className="workbench-project-bar">
          <div className="brand">
            <CubeIcon size={24} aria-hidden={true} />
            <strong>PlainCAD</strong>
          </div>
          <strong className="project-title" title={name}>
            {name}
          </strong>
          <details className="ds-menu file-menu">
            <summary>
              File <CaretDownIcon size={14} aria-hidden={true} />
            </summary>
            <section
              className="ds-popover"
              aria-label="File"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button"))
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
              }}
            >
              <CommandButton
                command="file.newProject"
                label="New project"
                context={context}
              />
              <CommandButton
                command="file.openProject"
                label="Open project"
                context={context}
              />
              <CommandButton
                command="file.saveOrExport"
                label="Save or export"
                context={context}
              />
              <CommandButton
                command="file.exportStl"
                label="Export STL"
                context={context}
              />
              <CommandButton command="file.exportProjectPng" label="Download project view PNG" context={context} />
              <CommandButton command="file.exportBodyPng" label="Download selected part PNG" context={context} />
              <CommandButton command="file.exportSketchPng" label="Download sketch PNG" context={context} />
              <hr />
              <CommandButton
                command="component.create"
                label="New component"
                context={context}
              />
              <CommandButton
                command="template.createMountingPlate"
                label="Mounting plate example"
                accessibleLabel="Load mounting plate template"
                context={context}
              />
              <CommandButton
                command="template.createBox"
                label="Box example"
                accessibleLabel="Load parametric box template"
                context={context}
              />
            </section>
          </details>
          <div className="workbench-history-actions">
            <CommandButton
              command="history.undo"
              label=""
              accessibleLabel="Undo"
              icon={ArrowUUpLeftIcon}
              context={context}
            />
            <CommandButton
              command="history.redo"
              label=""
              accessibleLabel="Redo"
              icon={ArrowUUpRightIcon}
              context={context}
            />
          </div>
          <button
            type="button"
            className="ds-command command-search"
            aria-label="All tools"
            onClick={(event) => {
              event.currentTarget.focus();
              palette(true);
            }}
          >
            <MagnifyingGlassIcon size={18} aria-hidden={true} />
            Search commands <kbd>⌘ K</kbd>
          </button>
          <CommandButton
            command="file.saveProject"
            label="Save"
            accessibleLabel="Save project"
            icon={FloppyDiskIcon}
            context={context}
          />
          <details className="ds-menu workbench-settings">
            <summary>
              <GearSixIcon size={18} aria-hidden={true} />
              <span>Settings</span>
            </summary>
            <div className="ds-popover">
              <ThemeSelector />
              <label>
                Workspace
                <select
                  aria-label="Workspace layout"
                  value="workbench"
                  onChange={(event) => {
                    const layout = event.target.value;
                    if (
                      layout === "workbench" ||
                      layout === "focused" ||
                      layout === "full"
                    )
                      useWorkspaceState.getState().setLayout(layout);
                  }}
                >
                  <option value="workbench">Docked workbench</option>
                  <option value="focused">Minimal workspace</option>
                  <option value="full">Full workspace</option>
                </select>
              </label>
            </div>
          </details>
        </div>
        <div
          className="workbench-tools"
          role="toolbar"
          aria-label="Contextual CAD tools"
        >
          <div
            className="workbench-modes"
            role="group"
            aria-label="Tool groups"
          >
            {(["draw", "solid", "inspect"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={current === id}
                onClick={() => setMode(id)}
                disabled={sketching && id !== "draw"}
              >
                {id === "draw" ? (
                  <PencilSimpleIcon size={18} aria-hidden={true} />
                ) : id === "solid" ? (
                  <CubeIcon size={18} aria-hidden={true} />
                ) : (
                  <RulerIcon size={18} aria-hidden={true} />
                )}
                {id === "draw" ? "Draw" : id === "solid" ? "Solid" : "Inspect"}
              </button>
            ))}
          </div>
          <div className="workbench-context-commands">
            {current !== "inspect" ? (
              groups[current].map(([command, label, accessibleLabel, icon]) => (
                <CommandButton
                  key={command}
                  {...{ command, label, accessibleLabel, icon, context }}
                />
              ))
            ) : (
              <>
                <button
                  type="button"
                  className="ds-command"
                  onClick={() => {
                    useWorkspaceState.getState().setPanel("measure");
                    useWorkbenchState.getState().showRight("properties");
                  }}
                >
                  <RulerIcon size={18} aria-hidden={true} />
                  Measure
                </button>
                <button
                  type="button"
                  className="ds-command"
                  onClick={() => {
                    useWorkspaceState.getState().setPanel("views");
                    useWorkbenchState.getState().showRight("properties");
                  }}
                >
                  Views & sections
                </button>
                <CommandButton
                  command="view.resetCamera"
                  label="Reset camera"
                  context={context}
                />
              </>
            )}
          </div>
          <CommandButton
            command="view.fit"
            label="Fit"
            accessibleLabel="Fit view"
            icon={ArrowsOutSimpleIcon}
            context={context}
          />
          <span
            className={`rebuild-pill ${rebuild.status}`}
            title={rebuild.message}
          >
            {rebuild.status}
          </span>
        </div>
      </nav>
    </header>
  );
}
