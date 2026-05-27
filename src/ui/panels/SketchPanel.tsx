import { useMemo } from "react";
import { useCadStore } from "../../state/useCadStore";
import { orderedFeatures, orderedSketches } from "../../state/selectors";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { detectProfiles } from "../../cad/sketch/profileDetection";

export function SketchPanel() {
  const document = useCadStore((state) => state.history.present);
  const select = useCadStore((state) => state.select);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const sketches = useMemo(() => orderedSketches(document), [document]);
  const features = useMemo(() => orderedFeatures(document), [document]);
  const activeSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? sketches.find((sketch) => Boolean(sketch.entities[selection.id]))
        : sketches[0];
  const entities = activeSketch ? Object.values(activeSketch.entities) : [];
  const evaluatedParameters = useMemo(() => evaluateParameters(document.parameters), [document.parameters]);
  const activeProfileResult = useMemo(
    () => {
      if (!activeSketch) return undefined;
      try {
        return detectProfiles(solveSketch(activeSketch, evaluatedParameters.values));
      } catch (error) {
        return { profiles: [], errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    [activeSketch, evaluatedParameters.values],
  );
  return (
    <section className="panel browser-panel">
      <h2>Browser</h2>
      <div className="panel-list">
        <div className="browser-root">
          <strong>{document.name}</strong>
          <span className="muted">{document.units} document</span>
        </div>
        <div className="browser-folder">
          <span className="folder-label">Origin</span>
          <span className="muted">XY plane</span>
        </div>
        <div className="browser-folder">
          <span className="folder-label">Bodies</span>
          <span className="muted">{features.length} feature outputs</span>
        </div>
        <div className="browser-folder">
          <span className="folder-label">Sketches</span>
          <span className="muted">{sketches.length} sketches</span>
        </div>
        {sketches.map((sketch) => (
          <button
            className={`item-card ${activeSketch?.id === sketch.id ? "selected" : ""}`}
            key={sketch.id}
            onClick={() => select({ kind: "sketch", id: sketch.id, documentId: document.id })}
          >
            <strong>{sketch.name}</strong>
            <span className="muted"> {Object.keys(sketch.entities).length} entities</span>
          </button>
        ))}
        {sketches.length === 0 ? <p className="muted">Create an XY sketch or use a template.</p> : null}
      </div>
      {activeSketch ? (
        <div className="sketch-detail">
          <h3>{activeSketch.name} Entities</h3>
          <div className="panel-list">
            {entities.map((entity) => (
              <button
                className={`item-card ${selection?.kind === "sketchEntity" && selection.id === entity.id ? "selected" : ""}`}
                key={entity.id}
                onClick={() => select({ kind: "sketchEntity", id: entity.id, documentId: document.id })}
              >
                <strong>{entity.type}</strong>
                <span className="muted"> {entity.id}</span>
              </button>
            ))}
          </div>
          <p className="muted">
            {activeSketch.constraints.length} constraints, {activeSketch.dimensions.length} dimensions, {activeProfileResult?.profiles.length ?? 0} profiles
          </p>
          {activeProfileResult?.errors.map((error, index) => (
            <div className="warning-text" key={`${index}:${error}`}>{error}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
