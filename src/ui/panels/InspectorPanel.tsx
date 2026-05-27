import { useMemo } from "react";
import { useCadStore } from "../../state/useCadStore";
import { SketchCircle, SketchPoint } from "../../cad/document/schema";
import { upsertSketch } from "../../cad/document/CadDocument";

export function InspectorPanel() {
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const document = useCadStore((state) => state.history.present);
  const rebuild = useCadStore((state) => state.rebuild.result);
  const select = useCadStore((state) => state.select);
  const updateDocument = useCadStore((state) => state.updateDocument);
  const body = useMemo(() => rebuild?.bodies.find((item) => item.id === selection?.id), [rebuild?.bodies, selection?.id]);
  const bodyMesh = useMemo(() => rebuild?.meshes.find((item) => item.bodyId === body?.id), [body?.id, rebuild?.meshes]);
  const parameter = selection?.kind === "parameter" ? document.parameters[selection.id] : undefined;
  const sketch = selection?.kind === "sketch" ? document.sketches[selection.id] : undefined;
  const sketchEntity = useMemo(() => {
    if (selection?.kind !== "sketchEntity") return undefined;
    for (const item of Object.values(document.sketches)) {
      const entity = item.entities[selection.id];
      if (entity) return { sketch: item, entity };
    }
    return undefined;
  }, [document.sketches, selection?.id, selection?.kind]);
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
      {sketchEntity ? (
        <div className="item-card">
          <strong>{sketchEntity.entity.type}</strong>
          <p className="muted">{sketchEntity.entity.id}</p>
          {sketchEntity.entity.type === "point" ? (
            <div className="inspector-form">
              <label>
                X
                <input
                  key={`${sketchEntity.entity.id}:x:${(sketchEntity.entity as SketchPoint).x.expression}`}
                  defaultValue={(sketchEntity.entity as SketchPoint).x.expression}
                  onBlur={(event) => updateSketchEntityExpression(updateDocument, sketchEntity.sketch.id, sketchEntity.entity.id, "x", event.target.value)}
                />
              </label>
              <label>
                Y
                <input
                  key={`${sketchEntity.entity.id}:y:${(sketchEntity.entity as SketchPoint).y.expression}`}
                  defaultValue={(sketchEntity.entity as SketchPoint).y.expression}
                  onBlur={(event) => updateSketchEntityExpression(updateDocument, sketchEntity.sketch.id, sketchEntity.entity.id, "y", event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {sketchEntity.entity.type === "circle" ? (
            <div className="inspector-form">
              <label>
                Radius
                <input
                  key={`${sketchEntity.entity.id}:radius:${(sketchEntity.entity as SketchCircle).radius.expression}`}
                  defaultValue={(sketchEntity.entity as SketchCircle).radius.expression}
                  onBlur={(event) => updateSketchEntityExpression(updateDocument, sketchEntity.sketch.id, sketchEntity.entity.id, "radius", event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {sketchEntity.entity.type === "line" ? <p className="muted">Line endpoints are edited through their point entities.</p> : null}
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

function updateSketchEntityExpression(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  sketchId: string,
  entityId: string,
  field: "x" | "y" | "radius",
  expression: string,
) {
  const current = useCadStore.getState().history.present.sketches[sketchId]?.entities[entityId];
  const currentExpression =
    current?.type === "point" && (field === "x" || field === "y")
      ? current[field].expression
      : current?.type === "circle" && field === "radius"
        ? current.radius.expression
        : undefined;
  if (currentExpression === expression) return;

  updateDocument((document) => {
    const sketch = document.sketches[sketchId];
    if (!sketch) return document;
    const entity = sketch.entities[entityId];
    if (!entity) return document;
    const updatedEntity =
      entity.type === "point" && (field === "x" || field === "y")
        ? { ...entity, [field]: { ...entity[field], expression } }
        : entity.type === "circle" && field === "radius"
          ? { ...entity, radius: { ...entity.radius, expression } }
          : entity;
    return upsertSketch(document, {
      ...sketch,
      entities: { ...sketch.entities, [entityId]: updatedEntity },
    });
  });
}
