import { useEffect, useMemo, useRef, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { SketchCircle, SketchPoint } from "../../cad/document/schema";
import * as documentOps from "../../cad/document/CadDocument";

const EXTRUDE_OPERATIONS = ["newBody", "join", "cut"] as const;
const EXTRUDE_OPERATION_OPTIONS = [
  { value: "newBody", label: "New body", disabled: false },
  { value: "join", label: "Join", disabled: true },
  { value: "cut", label: "Cut", disabled: true },
] as const;
const EXTRUDE_DIRECTIONS = ["positive", "negative", "symmetric"] as const;
const DEFAULT_SKETCH_NAME = "Untitled Sketch";
const DEFAULT_FEATURE_NAME = "Untitled Feature";

export function InspectorPanel() {
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const document = useCadStore((state) => state.history.present);
  const rebuild = useCadStore((state) => state.rebuild.result);
  const select = useCadStore((state) => state.select);
  const updateDocument = useCadStore((state) => state.updateDocument);
  const updateParameter = useCadStore((state) => state.updateParameter);
  const parameterById = useMemo(
    () => new Map(Object.values(document?.parameters ?? {}).map((item) => [item.id, item])),
    [document?.parameters],
  );
  const body = useMemo(
    () => (selection?.kind === "body" ? rebuild?.bodies.find((item) => item.id === selection.id) : undefined),
    [rebuild?.bodies, selection?.id, selection?.kind],
  );
  const bodyMesh = useMemo(() => rebuild?.meshes.find((item) => item.bodyId === body?.id), [body?.id, rebuild?.meshes]);
  const parameter = useMemo(
    () =>
      selection?.kind === "parameter"
        ? document?.parameters[selection.id] ?? parameterById.get(selection.id)
        : undefined,
    [document?.parameters, parameterById, selection?.id, selection?.kind],
  );
  const sketch = selection?.kind === "sketch" ? document?.sketches[selection.id] : undefined;
  const sketchEntity = useMemo(() => {
    if (selection?.kind !== "sketchEntity") return undefined;
    if (!document) return undefined;
    for (const item of Object.values(document.sketches)) {
      const entity = item.entities[selection.id];
      if (entity) return { sketch: item, entity };
    }
    return undefined;
  }, [document, selection?.id, selection?.kind]);
  const feature = useMemo(
    () => (selection?.kind === "feature" ? document?.features.find((item) => item.id === selection.id) : undefined),
    [document, selection?.id, selection?.kind],
  );
  const bodyFeature = useMemo(
    () => (body?.featureId ? document?.features.find((item) => item.id === body.featureId) : undefined),
    [body?.featureId, document],
  );

  return (
    <section className="panel">
      <h2>Inspector</h2>
      {!selection ? <p className="muted">Select a parameter, sketch, feature, or body.</p> : null}
      {parameter ? (
        <div key={`parameter:${parameter.id || parameter.name}`} className="item-card">
          <strong>{parameter.name}</strong>
          <p className="muted">
            {parameter.expression} = {parameter.value.toFixed(3)}
            {parameter.unit}
          </p>
          <div className="inspector-form">
            <label>
              {parameter.name} expression
              <CommitInput value={parameter.expression} onCommit={(value) => updateParameter(parameter.name, { expression: value })} />
            </label>
            <label>
              {parameter.name} description
              <CommitInput value={parameter.description ?? ""} onCommit={(value) => updateParameter(parameter.name, { description: value })} />
            </label>
          </div>
        </div>
      ) : null}
      {sketch ? (
        <div key={`sketch:${sketch.id}`} className="item-card">
          <strong>{sketch.name}</strong>
          <p className="muted">Plane {sketch.plane}</p>
          <p className="muted">
            {Object.keys(sketch.entities).length} entities, {sketch.constraints.length} constraints, {sketch.dimensions.length} dimensions
          </p>
          <div className="inspector-form">
            <label>
              Name
              <CommitInput value={sketch.name} onCommit={(value) => updateSketchName(updateDocument, sketch.id, value)} />
            </label>
          </div>
        </div>
      ) : null}
      {feature ? (
        <div key={`feature:${feature.id}`} className="item-card">
          <strong>{feature.name}</strong>
          <p className="muted">
            {feature.type}
            {feature.suppressed ? " suppressed" : ""}
          </p>
          {"sketchId" in feature ? <p className="muted">Sketch {feature.sketchId}</p> : null}
          {feature.type === "extrude" ? (
            <div className="inspector-form">
              <label>
                Name
                <CommitInput value={feature.name} onCommit={(value) => updateFeatureName(updateDocument, feature.id, value)} />
              </label>
              <label>
                Distance
                <CommitInput value={feature.distance.expression} onCommit={(value) => updateExtrudeDistance(updateDocument, feature.id, value)} />
              </label>
              <label>
                Operation
                <select
                  value={feature.operation}
                  onChange={(event) => updateExtrudeOperation(updateDocument, feature.id, event.target.value)}
                >
                  {EXTRUDE_OPERATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}{option.disabled ? " unavailable" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Direction
                <select
                  value={feature.direction}
                  onChange={(event) => updateExtrudeDirection(updateDocument, feature.id, event.target.value)}
                >
                  {EXTRUDE_DIRECTIONS.map((direction) => (
                    <option key={direction} value={direction}>
                      {direction[0].toUpperCase() + direction.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      {sketchEntity ? (
        <div key={`entity:${sketchEntity.entity.id}`} className="item-card">
          <strong>{sketchEntity.entity.type}</strong>
          <p className="muted">{sketchEntity.entity.id}</p>
          {sketchEntity.entity.type === "point" ? (
            <div className="inspector-form">
              <label>
                X
                <CommitInput value={(sketchEntity.entity as SketchPoint).x.expression} onCommit={(value) => updateSketchEntityExpression(updateDocument, sketchEntity.sketch.id, sketchEntity.entity.id, "x", value)} />
              </label>
              <label>
                Y
                <CommitInput value={(sketchEntity.entity as SketchPoint).y.expression} onCommit={(value) => updateSketchEntityExpression(updateDocument, sketchEntity.sketch.id, sketchEntity.entity.id, "y", value)} />
              </label>
            </div>
          ) : null}
          {sketchEntity.entity.type === "circle" ? (
            <div className="inspector-form">
              <label>
                Radius
                <CommitInput value={(sketchEntity.entity as SketchCircle).radius.expression} onCommit={(value) => updateSketchEntityExpression(updateDocument, sketchEntity.sketch.id, sketchEntity.entity.id, "radius", value)} />
              </label>
            </div>
          ) : null}
          {sketchEntity.entity.type === "line" ? <p className="muted">Line endpoints are edited through their point entities.</p> : null}
        </div>
      ) : null}
      {body ? (
        <div key={`body:${body.id}`} className="item-card">
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

function CommitInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelCommit = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [focused, value]);
  return (
    <input
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          cancelCommit.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setFocused(false);
        if (cancelCommit.current) {
          cancelCommit.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function updateSketchName(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  sketchId: string,
  name: string,
) {
  const nextName = name.trim() || DEFAULT_SKETCH_NAME;
  updateDocument((document) => {
    if (!document) return document;
    const sketch = document.sketches[sketchId];
    if (!sketch || sketch.name === nextName) return document;
    return documentOps.upsertSketch(document, { ...sketch, name: nextName });
  });
}

function updateFeatureName(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  name: string,
) {
  const nextName = name.trim() || DEFAULT_FEATURE_NAME;
  updateDocument((document) => {
    if (!document) return document;
    const feature = document.features.find((item) => item.id === featureId);
    if (!feature) return document;
    if (nextName === feature.name) return document;
    return documentOps.upsertFeature(document, { ...feature, name: nextName });
  });
}

function updateExtrudeDistance(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  expression: string,
) {
  updateDocument((document) => {
    if (!document) return document;
    const feature = document.features.find((item) => item.id === featureId);
    if (!feature || feature.type !== "extrude" || feature.distance.expression === expression) return document;
    return documentOps.upsertFeature(document, { ...feature, distance: { ...feature.distance, expression } });
  });
}

function updateExtrudeOperation(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  operation: string,
) {
  if (!isExtrudeOperation(operation) || EXTRUDE_OPERATION_OPTIONS.find((option) => option.value === operation)?.disabled) return;
  updateDocument((document) => {
    if (!document) return document;
    const feature = document.features.find((item) => item.id === featureId);
    if (!feature || feature.type !== "extrude" || feature.operation === operation) return document;
    return documentOps.upsertFeature(document, { ...feature, operation });
  });
}

function isExtrudeOperation(value: string): value is (typeof EXTRUDE_OPERATIONS)[number] {
  return EXTRUDE_OPERATIONS.includes(value as (typeof EXTRUDE_OPERATIONS)[number]);
}

function updateExtrudeDirection(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  direction: string,
) {
  if (!isExtrudeDirection(direction)) return;
  updateDocument((document) => {
    if (!document) return document;
    const feature = document.features.find((item) => item.id === featureId);
    if (!feature || feature.type !== "extrude" || feature.direction === direction) return document;
    return documentOps.upsertFeature(document, { ...feature, direction });
  });
}

function isExtrudeDirection(value: string): value is (typeof EXTRUDE_DIRECTIONS)[number] {
  return EXTRUDE_DIRECTIONS.includes(value as (typeof EXTRUDE_DIRECTIONS)[number]);
}

function updateSketchEntityExpression(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  sketchId: string,
  entityId: string,
  field: "x" | "y" | "radius",
  expression: string,
) {
  const current = useCadStore.getState().history.present?.sketches[sketchId]?.entities[entityId];
  const currentExpression =
    current?.type === "point" && (field === "x" || field === "y")
      ? current[field].expression
      : current?.type === "circle" && field === "radius"
        ? current.radius.expression
        : undefined;
  if (currentExpression === undefined) return;
  if (currentExpression === expression) return;

  updateDocument((document) => {
    if (!document) return document;
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
    return documentOps.upsertSketch(document, {
      ...sketch,
      entities: { ...sketch.entities, [entityId]: updatedEntity },
    });
  });
}
