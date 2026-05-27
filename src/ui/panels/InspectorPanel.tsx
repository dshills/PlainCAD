import { useMemo } from "react";
import { useCadStore } from "../../state/useCadStore";

export function InspectorPanel() {
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const document = useCadStore((state) => state.history.present);
  const rebuild = useCadStore((state) => state.rebuild.result);
  const select = useCadStore((state) => state.select);
  const body = useMemo(() => rebuild?.bodies.find((item) => item.id === selection?.id), [rebuild?.bodies, selection?.id]);
  const bodyMesh = useMemo(() => rebuild?.meshes.find((item) => item.bodyId === body?.id), [body?.id, rebuild?.meshes]);
  const parameter = selection?.kind === "parameter" ? document.parameters[selection.id] : undefined;
  const sketch = selection?.kind === "sketch" ? document.sketches[selection.id] : undefined;
  const feature = useMemo(
    () => (selection?.kind === "feature" ? document.features.find((item) => item.id === selection.id) : undefined),
    [document.features, selection?.id, selection?.kind],
  );
  const bodyFeature = useMemo(
    () => (body?.featureId ? document.features.find((item) => item.id === body.featureId) : undefined),
    [body?.featureId, document.features],
  );

  return (
    <section className="panel">
      <h2>Inspector</h2>
      {!selection ? <p className="muted">Select a parameter, sketch, feature, or body.</p> : null}
      {parameter ? (
        <div className="item-card">
          <strong>{parameter.name}</strong>
          <p className="muted">
            {parameter.expression} = {parameter.value.toFixed(3)}
            {parameter.unit}
          </p>
        </div>
      ) : null}
      {sketch ? (
        <div className="item-card">
          <strong>{sketch.name}</strong>
          <p className="muted">Plane {sketch.plane}</p>
          <p className="muted">
            {Object.keys(sketch.entities).length} entities, {sketch.constraints.length} constraints, {sketch.dimensions.length} dimensions
          </p>
        </div>
      ) : null}
      {feature ? (
        <div className="item-card">
          <strong>{feature.name}</strong>
          <p className="muted">
            {feature.type}
            {feature.suppressed ? " suppressed" : ""}
          </p>
          {"sketchId" in feature ? <p className="muted">Sketch {feature.sketchId}</p> : null}
        </div>
      ) : null}
      {body ? (
        <div className="item-card">
          <strong>{body.name}</strong>
          <p className="muted">Generated from {body.featureId ?? "unknown feature"}</p>
          {bodyFeature ? (
            <button onClick={() => select({ kind: "feature", id: bodyFeature.id, documentId: document.id })}>Select Source Feature</button>
          ) : null}
          {bodyMesh ? (
            <dl className="inspector-facts">
              <div>
                <dt>Vertices</dt>
                <dd>{bodyMesh.positions.length / 3}</dd>
              </div>
              <div>
                <dt>Triangles</dt>
                <dd>{bodyMesh.indices.length / 3}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
