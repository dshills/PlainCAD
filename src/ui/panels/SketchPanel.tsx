import "./PartsBrowser.css";
import { CaretDownIcon, CaretRightIcon } from "../design-system/Icons";
import { useViewerState } from "../../state/viewerState";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { CommitInput } from "./CommitInput";
import { runCommand } from "../commands/commandRegistry";
import { activeComponentId } from "../commands/projectWorkflowCommand";
import {
  bodyComponentId,
  featureComponentId,
  sketchComponentId,
} from "../../cad/document/components";
import { SketchTools } from "./SketchTools";
import { BodyPanel } from "./BodyPanel";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCadStore } from "../../state/useCadStore";
import { orderedSketches } from "../../state/selectors";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { detectProfiles } from "../../cad/sketch/profileDetection";
import { sketchPlaneLabel } from "../../cad/sketch/planes";

export function SketchPanel({ compact = false }: { compact?: boolean }) {
  const [search, setSearch] = useState("");
  const filter = compact ? search.trim().toLocaleLowerCase() : "";
  const bodies = useCadStore((state) =>
    state.rebuild.result?.documentId === state.history.present.id
      ? state.rebuild.result.bodies
      : undefined,
  );
  const document = useCadStore((state) => state.history.present);
  const componentId = useCadStore(activeComponentId);
  const session = useCadStore((state) => state.documentSession);
  useEffect(() => setSearch(""), [session]);
  const view = useViewerState();
  const hiddenSketches = view.session === session ? view.hiddenSketchIds : [];
  const hidden = view.session === session ? view.hiddenComponentIds : [];
  const enablement = useCommandEnablement();
  const canExtrude = enablement.createExtrude;
  const select = useCadStore((state) => state.select);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const sketches = useMemo(() => orderedSketches(document), [document]);
  const names = useMemo(() => bodyDisplayNames(document, bodies ?? []), [document, bodies]);
  const activeSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? sketches.find((sketch) => Boolean(sketch.entities[selection.id]))
        : sketches.find(
            (sketch) => sketchComponentId(document, sketch.id) === componentId,
          );
  const entities = activeSketch ? Object.values(activeSketch.entities) : [];
  const evaluatedParameters = useMemo(
    () => evaluateParameters(document.parameters),
    [document.parameters],
  );
  const activeProfileResult = useMemo(() => {
    if (!activeSketch) return undefined;
    try {
      return detectProfiles(
        solveSketch(activeSketch, evaluatedParameters.values),
      );
    } catch (error) {
      return {
        profiles: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }, [activeSketch, evaluatedParameters.values]);
  return (
    <section
      className={`panel browser-panel parts-browser${compact ? " compact-browser" : ""}`}
    >
      <h2>Browser</h2>
      {compact ? (
        <label className="project-search">
          <span className="sr-only">Search project</span>
          <input
            type="search"
            aria-label="Search project"
            placeholder="Search project…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      ) : null}
      <div className="panel-list">
        <div className="browser-root">
          <strong>{document.name}</strong>
          <span className="muted">{document.units} local project</span>
        </div>
        {hidden.length ? (
          <button className="exit-isolation" onClick={() => void runCommand("view.exitIsolation")}>
            Exit isolation
          </button>
        ) : null}
        <details className="project-settings" open={!compact}>
          <summary>Project settings</summary>
          <label className="component-name">
            Project name
            <CommitInput
              value={document.name}
              onCommit={(name) =>
                void runCommand("file.renameProject", { projectName: name })
              }
            />
          </label>
          <p className="workflow-hint">
            Activate a component → Create Sketch → Finish Sketch → Extrude.
          </p>
          <div className="workflow-actions">
            <button
              disabled={!enablement.newComponent}
              onClick={() => void runCommand("component.create")}
            >
              New Component
            </button>
            <button
              disabled={!enablement.createSketch}
              onClick={() => void runCommand("sketch.create")}
            >
              Create Sketch
            </button>
          </div>
          <p className="muted">
            Active: <strong>{document.components[componentId]?.name}</strong>
          </p>
          {/* View commands are always available for a loaded document, including sketch mode. */}
          <button onClick={() => void runCommand("view.showAllComponents")}>
            Show all components
          </button>
        </details>
        <div className="component-tree">
          {Object.values(document.components)
            .sort((a, b) =>
              a.id === document.rootComponentId
                ? -1
                : b.id === document.rootComponentId
                  ? 1
                  : a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
            )
            .map((component) => {
              const owned = sketches.filter(
                (sketch) =>
                  sketchComponentId(document, sketch.id) === component.id,
              );
              const active = component.id === componentId;
              const ownedBodies = bodies?.filter(
                (body) => bodyComponentId(document, body.id) === component.id,
              ) ?? [];
              const emptyRoot =
                component.id === document.rootComponentId &&
                !owned.length && !ownedBodies.length &&
                !document.features.some((feature) =>
                  featureComponentId(document, feature) === component.id,
                );
              return (
                <ComponentFolder
                  key={`${session}:${component.id}`}
                  hidden={
                    Boolean(filter) &&
                    ![
                      component.name,
                      ...owned.map((sketch) => sketch.name),
                      ...ownedBodies.map((body) => names[body.id] ?? body.name),
                    ].some((name) => name.toLocaleLowerCase().includes(filter))
                  }
                  name={component.name}
                  forceExpanded={Boolean(filter)}
                  partCount={ownedBodies.length}
                  sketchCount={owned.length}
                  active={active}
                  root={component.id === document.rootComponentId}
                  canActivate={enablement.editProject}
                  visible={!hidden.includes(component.id)}
                  onVisibility={() =>
                    void runCommand("component.toggleVisibility", {
                      componentId: component.id,
                      documentSession: session,
                    })
                  }
                  onIsolate={() =>
                    void runCommand("component.isolate", {
                      componentId: component.id,
                      documentSession: session,
                    })
                  }
                  onActivate={() =>
                    void runCommand("component.activate", {
                      componentId: component.id,
                    })
                  }
                  settings={active ? (
                    <div className="component-settings">
                      <button type="button" disabled={!enablement.manufacturingCoach} onClick={() => void runCommand("manufacturing.coach")}>Manufacturing coach</button>
                      <button type="button" disabled={!enablement.productFamily} onClick={() => void runCommand("family.manage")}>Product configurations</button>
                      <button type="button" disabled={!enablement.createFit} onClick={() => void runCommand("fit.create")}>Build a fitted part</button>
                      <button type="button" disabled={!enablement.editFit} onClick={() => void runCommand("fit.edit")}>Edit fitted part</button>
                      <button type="button" disabled={!enablement.removeJoint} onClick={() => void runCommand("assembly.removeJoint")}>Remove joint</button>
                      <button type="button" disabled={!enablement.assemblyMotion} onClick={() => void runCommand("assembly.motion")}>Assembly motion</button>
                      <button type="button" disabled={!enablement.moveComponent} onClick={() => void runCommand("component.move", { componentId: component.id })}>Move component</button>
                      <label className="component-name">
                        Component name
                        <CommitInput
                          value={component.name}
                          onCommit={(name) =>
                            void runCommand("component.rename", {
                              componentId: component.id,
                              componentName: name,
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : undefined}
                >
                  {!emptyRoot ? (
                    <>
                      {!compact ? <div className="browser-folder">
                        <span className="folder-label">Origin</span>
                        <span className="muted">XY, XZ, YZ · component frame</span>
                      </div> : null}
                      <BodyPanel
                        componentId={component.id}
                        controls={active && !compact}
                        compact={compact}
                      />
                      <div className="browser-folder">
                        <span className="folder-label">Sketches</span>
                        <span className="muted">{owned.length} {owned.length === 1 ? "sketch" : "sketches"}</span>
                      </div>
                      {owned.map((sketch) => (
                        <div className="sketch-browser-row" key={sketch.id}>
                          <button
                            className={`item-card ${activeSketch?.id === sketch.id ? "selected" : ""}`}
                            onClick={() =>
                              select({
                                kind: "sketch",
                                id: sketch.id,
                                documentId: document.id,
                              })
                            }
                            onDoubleClick={() => {
                              select({
                                kind: "sketch",
                                id: sketch.id,
                                documentId: document.id,
                              });
                              void runCommand("sketch.editCanvas");
                            }}
                          >
                            <strong>{sketch.name}</strong>
                            <span className="muted">
                              {" "}
                              {sketchPlaneLabel(sketch.plane)} plane,{" "}
                              {Object.keys(sketch.entities).length} entities
                            </span>
                          </button>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Show sketch ${sketch.name} in 3D`}
                              checked={
                                !hidden.includes(component.id) &&
                                !hiddenSketches.includes(sketch.id)
                              }
                              disabled={hidden.includes(component.id)}
                              title={
                                hidden.includes(component.id)
                                  ? "Show the component to change sketch visibility."
                                  : "3D overlay visibility; Edit Sketch keeps the canvas visible."
                              }
                              onChange={() =>
                                void runCommand("sketch.toggleVisibility", {
                                  sketchId: sketch.id,
                                  documentSession: session,
                                })
                              }
                            />
                            <span className={compact ? "sr-only" : undefined}>3D</span>
                          </label>
                        </div>
                      ))}
                      {!owned.length && !compact ? (
                        <p className="muted">Create a sketch in this component.</p>
                      ) : null}
                    </>
                  ) : null}
                </ComponentFolder>
              );
            })}
        </div>
        {selection?.kind === "sketch" ? (
          <div className="workflow-actions">
            <button
              disabled={!enablement.sketchCanvas}
              onClick={() => void runCommand("sketch.editCanvas")}
            >
              Edit Sketch
            </button>
            <button
              disabled={!canExtrude}
              onClick={() => void runCommand("feature.extrude")}
            >
              Extrude Sketch
            </button>
          </div>
        ) : null}
      </div>
      {activeSketch ? (
        <details className="sketch-detail" open={!compact}>
          <summary>Sketch details</summary>
          <details open={!compact}>
            <summary>Sketch Properties</summary>
            <SketchTools
              key={activeSketch.id}
              sketch={activeSketch}
              document={document}
            />
          </details>
          <h3>{activeSketch.name} Entities</h3>
          <div className="panel-list">
            {entities.map((entity) => (
              <button
                className={`item-card ${selection?.kind === "sketchEntity" && selection.id === entity.id ? "selected" : ""}`}
                key={entity.id}
                onClick={() =>
                  select({
                    kind: "sketchEntity",
                    id: entity.id,
                    documentId: document.id,
                  })
                }
              >
                <strong>{entity.type}</strong>
                <span className="muted"> {entity.id}</span>
              </button>
            ))}
          </div>
          <p className="muted">
            {activeSketch.constraints.length} constraints,{" "}
            {activeSketch.dimensions.length} dimensions,{" "}
            {activeProfileResult?.profiles.length ?? 0} profiles
          </p>
          {activeProfileResult?.errors.map((error, index) => (
            <div className="warning-text" key={`${index}:${error}`}>
              {error}
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}

function ComponentFolder({
  hidden = false,
  name,
  active,
  root,
  forceExpanded,
  partCount,
  sketchCount,
  canActivate,
  onActivate,
  visible,
  onVisibility,
  onIsolate,
  settings,
  children,
}: {
  hidden?: boolean;
  name: string;
  active: boolean;
  root: boolean;
  forceExpanded: boolean;
  partCount: number;
  sketchCount: number;
  canActivate: boolean;
  onActivate: () => void;
  visible: boolean;
  onVisibility: () => void;
  onIsolate: () => void;
  settings?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(active);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const menu = menuRef.current;
    if (!menuOpen || !menu) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !menu.contains(event.target)) {
        // CommitInput applies a pending rename on blur. Hiding the native
        // disclosure first can suppress that blur in some browsers.
        const focused = menu.ownerDocument.activeElement;
        if (focused instanceof HTMLInputElement && menu.contains(focused)) {
          focused.blur();
        }
        menu.open = false;
      }
    };
    const ownerDocument = menu.ownerDocument;
    ownerDocument.addEventListener("pointerdown", closeOutside);
    ownerDocument.addEventListener("focusin", closeOutside);
    return () => {
      ownerDocument.removeEventListener("pointerdown", closeOutside);
      ownerDocument.removeEventListener("focusin", closeOutside);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);
  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);
  return (
    <div className={`component-node ${active ? "active" : ""}`} hidden={hidden}>
      <div className="component-heading">
        <button
          className="component-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} component ${name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <CaretDownIcon size={14} aria-hidden={true} />
          ) : (
            <CaretRightIcon size={14} aria-hidden={true} />
          )}
        </button>
        <button
          className="component-activate"
          title={`${name}${root ? " · Project root" : ""}${active ? " · Active component" : ""} · ${partCount} ${partCount === 1 ? "part" : "parts"} · ${sketchCount} ${sketchCount === 1 ? "sketch" : "sketches"}`}
          disabled={!canActivate}
          aria-pressed={active}
          aria-label={`Activate component ${name}`}
          onClick={onActivate}
        >
          <strong>{name}</strong>
          {active ? (
            <span className="component-active-mark" aria-hidden="true">●</span>
          ) : null}
        </button>
        <label className="component-visibility" title={`Show component ${name}`}>
          <input
            type="checkbox"
            aria-label={`Show component ${name}`}
            checked={visible}
            onChange={onVisibility}
          />
          <span className="sr-only">Visible</span>
        </label>
        <details
          className="component-actions"
          ref={menuRef}
          onToggle={(event) => setMenuOpen(event.currentTarget.open)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.stopPropagation();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label={`Actions for component ${name}`} title={`Actions for component ${name}`}>⋯</summary>
          <div className="component-action-content">
            <button aria-label={`Isolate component ${name}`} onClick={(event) => {
              onIsolate();
              const menu = event.currentTarget.closest("details");
              if (menu) {
                menu.open = false;
                menu.querySelector("summary")?.focus();
              }
            }}>
              Isolate
            </button>
            {settings}
          </div>
        </details>
      </div>
      {expanded ? children : null}
    </div>
  );
}
