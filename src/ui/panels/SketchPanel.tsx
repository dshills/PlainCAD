import { useViewerState } from "../../state/viewerState";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { CommitInput } from "./CommitInput";
import { runCommand } from "../commands/commandRegistry";
import { activeComponentId } from "../commands/projectWorkflowCommand";
import { sketchComponentId } from "../../cad/document/components";
import { SketchTools } from "./SketchTools";
import { BodyPanel } from "./BodyPanel";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCadStore } from "../../state/useCadStore";
import { orderedSketches } from "../../state/selectors";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { detectProfiles } from "../../cad/sketch/profileDetection";
import { sketchPlaneLabel } from "../../cad/sketch/planes";

export function SketchPanel() {
  const document = useCadStore((state) => state.history.present);
  const componentId = useCadStore(activeComponentId);
  const session = useCadStore(state => state.documentSession);
  const view = useViewerState();
  const hiddenSketches = view.session === session ? view.hiddenSketchIds : [];
  const hidden = view.session === session ? view.hiddenComponentIds : [];
  const enablement = useCommandEnablement();
  const canExtrude = enablement.createExtrude;
  const select = useCadStore((state) => state.select);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const sketches = useMemo(() => orderedSketches(document), [document]);
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
    <section className="panel browser-panel">
      <h2>Browser</h2>
      <div className="panel-list">
        <div className="browser-root">
          <strong>{document.name}</strong>
          <span className="muted">{document.units} local project</span>
        </div>
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
        <button onClick={() => void runCommand("view.showAllComponents")}>Show all components</button>
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
              return (
                <ComponentFolder
                  key={component.id}
                  name={component.name}
                  active={active}
                  root={component.id === document.rootComponentId}
                  canActivate={enablement.editProject}
                  visible={!hidden.includes(component.id)}
                  onVisibility={() => void runCommand("component.toggleVisibility", { componentId: component.id, documentSession: session })}
                  onIsolate={() => void runCommand("component.isolate", { componentId: component.id, documentSession: session })}
                  onActivate={() =>
                    void runCommand("component.activate", {
                      componentId: component.id,
                    })
                  }
                >
                  {active ? (
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
                  ) : null}
                  <div className="browser-folder">
                    <span className="folder-label">Origin</span>
                    <span className="muted">XY, XZ, YZ · project origin</span>
                  </div>
                  <BodyPanel componentId={component.id} controls={active} />
                  <div className="browser-folder">
                    <span className="folder-label">Sketches</span>
                    <span className="muted">{owned.length} sketches</span>
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
                          checked={!hidden.includes(component.id) && !hiddenSketches.includes(sketch.id)}
                          disabled={hidden.includes(component.id)}
                          title={hidden.includes(component.id)
                            ? "Show the component to change sketch visibility."
                            : "3D overlay visibility; Edit Sketch keeps the canvas visible."}
                          onChange={() => void runCommand("sketch.toggleVisibility", {
                            sketchId: sketch.id, documentSession: session,
                          })}
                        />
                        3D
                      </label>
                    </div>
                  ))}
                  {!owned.length ? (
                    <p className="muted">Create a sketch in this component.</p>
                  ) : null}
                </ComponentFolder>
              );
            })}
        </div>
        {selection?.kind === "sketch" ? (
          <div className="workflow-actions">
            <button disabled={!enablement.sketchCanvas} onClick={() => void runCommand("sketch.editCanvas")}>
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
        <div className="sketch-detail">
          <details open>
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
        </div>
      ) : null}
    </section>
  );
}

function ComponentFolder({
  name,
  active,
  root,
  canActivate,
  onActivate,
  visible,
  onVisibility,
  onIsolate,
  children,
}: {
  name: string;
  active: boolean;
  root: boolean;
  canActivate: boolean;
  onActivate: () => void;
  visible: boolean;
  onVisibility: () => void;
  onIsolate: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(active);
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);
  return (
    <div className={`component-node ${active ? "active" : ""}`}>
      <div className="component-heading">
        <button
          className="component-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} component ${name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{" "}
          <strong>{name}</strong>
          {root ? " · Root" : ""}
        </button>
        <button
          disabled={!canActivate}
          aria-pressed={active}
          aria-label={`Activate component ${name}`}
          onClick={onActivate}
        >
          {active ? "Active" : "Activate"}
        </button>
      </div>
      <div className="component-view-actions">
        <label><input type="checkbox" aria-label={`Show component ${name}`} checked={visible} onChange={onVisibility} /> Visible</label>
        <button aria-label={`Isolate component ${name}`} onClick={onIsolate}>Isolate</button>
      </div>
      {expanded ? children : null}
    </div>
  );
}
