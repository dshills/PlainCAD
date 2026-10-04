import { runCommand } from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { useEffect, useMemo, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { SketchCircle, SketchPoint } from "../../cad/document/schema";
import * as documentOps from "../../cad/document/CadDocument";
import { sketchPlaneLabel } from "../../cad/sketch/planes";

import { SketchEntityReferences } from "./SketchEntityReferences";
import { CommitInput } from "./CommitInput";
import {
  ModelingFeatureControls,
  ToFaceControl,
} from "./ModelingFeatureControls";

import { FeatureReferenceControls } from "./FeatureReferenceControls";
import { HoleFeatureControls } from "./HoleFeatureControls";
import { AUTHORED_UNITS, validAuthoredUnit, displayUnits, formatParameterQuantity } from "../../cad/parameters/parameterUnits";
import { AuthoredUnitsNote } from "./AuthoredUnitsNote";

const EXTRUDE_OPERATIONS = ["newBody", "join", "cut"] as const;
const EXTRUDE_OPERATION_OPTIONS = [
  { value: "newBody", label: "New body", disabled: false },
  { value: "join", label: "Join", disabled: false },
  { value: "cut", label: "Cut", disabled: false },
] as const;
const EXTRUDE_DIRECTIONS = ["positive", "negative", "symmetric"] as const;
const EXTRUDE_TERMINATIONS = ["distance", "throughAll", "toFace"] as const;
const DEFAULT_SKETCH_NAME = "Untitled Sketch";
const DEFAULT_FEATURE_NAME = "Untitled Feature";

export function InspectorPanel() {
  const enablement = useCommandEnablement();
  const [pendingToFace, setPendingToFace] = useState<string>();
  const [groupError, setGroupError] = useState<{ id: string; message: string }>();
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const document = useCadStore((state) => state.history.present);
  const rebuild = useCadStore((state) => state.rebuild.result);
  const rebuildStatus = useCadStore((state) => state.rebuild.status);
  const parameterValues = (rebuildStatus === "succeeded" || rebuildStatus === "failed") && rebuild?.documentId === document.id ? rebuild.parameterValues : undefined;
  const select = useCadStore((state) => state.select);
  const updateDocument = useCadStore((state) => state.updateDocument);
  const updateParameter = useCadStore((state) => state.updateParameter);
  const parameterById = useMemo(
    () =>
      new Map(
        Object.values(document?.parameters ?? {}).map((item) => [
          item.id,
          item,
        ]),
      ),
    [document?.parameters],
  );
  const body = useMemo(
    () =>
      selection?.kind === "body"
        ? rebuild?.bodies.find((item) => item.id === selection.id)
        : undefined,
    [rebuild?.bodies, selection?.id, selection?.kind],
  );
  const bodyMesh = useMemo(
    () => rebuild?.meshes.find((item) => item.bodyId === body?.id),
    [body?.id, rebuild?.meshes],
  );
  const parameter = useMemo(
    () =>
      selection?.kind === "parameter"
        ? (document?.parameters[selection.id] ??
          parameterById.get(selection.id))
        : undefined,
    [document?.parameters, parameterById, selection?.id, selection?.kind],
  );
  const sketch =
    selection?.kind === "sketch" ? document?.sketches[selection.id] : undefined;
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
    () =>
      selection?.kind === "feature"
        ? document?.features.find((item) => item.id === selection.id)
        : undefined,
    [document, selection?.id, selection?.kind],
  );
  const bodyFeature = useMemo(
    () =>
      body?.featureId
        ? document?.features.find((item) => item.id === body.featureId)
        : undefined,
    [body?.featureId, document],
  );

  useEffect(() => setPendingToFace(undefined), [feature?.id, feature?.type === "extrude" ? feature.direction : undefined]);

  useEffect(() => setGroupError(undefined), [selection?.id, selection?.kind]);

  return (
    <section className="panel">
      <h2>Inspector</h2>
      {!selection ? (
        <p className="muted">Select a parameter, sketch, feature, or body.</p>
      ) : null}
      {parameter ? (
        <div
          key={`parameter:${parameter.id || parameter.name}`}
          className="item-card"
        >
          <strong>{parameter.name}</strong>
          <p className="muted">
            {parameter.expression} = <output aria-label="Inspected parameter value">{formatParameterQuantity(parameterValues?.[parameter.name], displayUnits(document))}</output>
          </p>
          <div className="inspector-form">
            <label>
              Bare-number unit for {parameter.name}
              <select value={parameter.authoredUnit ?? "legacy"} onChange={(event) => { const unit = event.target.value; if (validAuthoredUnit(unit)) updateParameter(parameter.id, { authoredUnit: unit }); }}>
                <option value="legacy" disabled>Legacy — explicit units required for dimensions</option>
                {AUTHORED_UNITS.map((unit) => <option value={unit} key={unit}>{unit || "Scalar (no units)"}</option>)}
              </select>
            </label>
            <label>
              {parameter.name} expression
              <CommitInput
                value={parameter.expression}
                onCommit={(value) =>
                  updateParameter(parameter.name, { expression: value })
                }
              />
            </label>
            <label>
              {parameter.name} description
              <CommitInput
                value={parameter.description ?? ""}
                onCommit={(value) =>
                  updateParameter(parameter.name, { description: value })
                }
              />
            </label>
            <label>
              {parameter.name} group
              <CommitInput value={parameter.group ?? ""} onCommit={(value) => {
                const group = value.trim().normalize("NFC");
                if (group.length > 80) { setGroupError({ id: parameter.id, message: "Parameter group must be at most 80 characters." }); return; }
                setGroupError(undefined);
                updateParameter(parameter.id, { group: group || undefined });
              }} />
            </label>
            {groupError?.id === parameter.id ? <p className="error-text" role="alert">{groupError.message}</p> : null}
          </div>
        </div>
      ) : null}
      {sketch ? (
        <div key={`sketch:${sketch.id}`} className="item-card">
          <strong>{sketch.name}</strong>
          <p className="muted">Plane {sketchPlaneLabel(sketch.plane)}</p>
          <p className="muted">
            {Object.keys(sketch.entities).length} entities,{" "}
            {sketch.constraints.length} constraints, {sketch.dimensions.length}{" "}
            dimensions
          </p>
          <div className="inspector-form">
            <label>
              Name
              <CommitInput
                value={sketch.name}
                onCommit={(value) =>
                  updateSketchName(updateDocument, sketch.id, value)
                }
              />
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
          <button disabled={!enablement.editFeature} onClick={() => void runCommand("feature.edit")}>Edit feature with preview</button>
          <ModelingFeatureControls feature={feature} />
          <AuthoredUnitsNote expressions={
            feature.type === "extrude" ? [["Distance", feature.termination?.type === "distance" ? feature.termination.distance ?? feature.distance : feature.distance]] :
            feature.type === "revolve" ? [["Angle", feature.angle]] :
            feature.type === "hole" ? [["Diameter", feature.diameter], ...(feature.depth === "throughAll" ? [] : [["Depth", feature.depth] as [string, typeof feature.diameter]])] :
            feature.type === "fillet" ? [["Radius", feature.radius]] : feature.type === "chamfer" ? [["Distance", feature.distance]] : []
          } />
          {feature.type === "hole" ? <HoleFeatureControls feature={feature} /> : null}
          {"sketchId" in feature ? (
            <FeatureReferenceControls feature={feature} />
          ) : null}
          {feature.type === "extrude" ? (
            <div className="inspector-form">
              <label>
                Name
                <CommitInput
                  value={feature.name}
                  onCommit={(value) =>
                    updateFeatureName(updateDocument, feature.id, value)
                  }
                />
              </label>
              {(feature.termination?.type ?? "distance") === "distance" ? (
                <label>
                  Distance
                  <CommitInput
                    value={feature.distance.expression}
                    onCommit={(value) =>
                      updateExtrudeDistance(updateDocument, feature.id, value)
                    }
                  />
                </label>
              ) : null}
              <label>
                Termination
                <select
                  value={
                    pendingToFace === feature.id
                      ? "toFace"
                      : (feature.termination?.type ?? "distance")
                  }
                  onChange={(event) => {
                    if (event.target.value === "toFace")
                      setPendingToFace(feature.id);
                    else {
                      setPendingToFace(undefined);
                      updateExtrudeTermination(
                        updateDocument,
                        feature.id,
                        event.target.value,
                      );
                    }
                  }}
                >
                  <option value="distance">Distance</option>
                  <option value="throughAll">Through all</option>
                  <option value="toFace" disabled={feature.direction !== "positive"}>To face{feature.direction !== "positive" ? " (positive only)" : ""}</option>
                </select>
              </label>
              <ToFaceControl
                feature={feature}
                pending={pendingToFace === feature.id}
                onCommit={() => setPendingToFace(undefined)}
              />
              <label>
                Operation
                <select
                  value={feature.operation}
                  onChange={(event) =>
                    updateExtrudeOperation(
                      updateDocument,
                      feature.id,
                      event.target.value,
                    )
                  }
                >
                  {EXTRUDE_OPERATION_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      {option.label}
                      {option.disabled ? " unavailable" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Direction
                <select
                  value={feature.direction}
                  onChange={(event) =>
                    updateExtrudeDirection(
                      updateDocument,
                      feature.id,
                      event.target.value,
                    )
                  }
                >
                  {EXTRUDE_DIRECTIONS.map((direction) => (
                    <option
                      key={direction}
                      value={direction}
                      disabled={direction !== "positive" && feature.termination?.type === "toFace"}
                    >
                      {direction[0].toUpperCase() + direction.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              {feature.direction === "symmetric" ? <p className="muted">Distance is the total span, split equally across the sketch plane.</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {sketchEntity ? (
        <div key={`entity:${sketchEntity.entity.id}`} className="item-card">
          <strong>{sketchEntity.entity.type}</strong>
          <p className="muted">{sketchEntity.entity.id}</p>
          <AuthoredUnitsNote expressions={sketchEntity.entity.type === "point" ? [["X", sketchEntity.entity.x], ["Y", sketchEntity.entity.y]] : sketchEntity.entity.type === "circle" ? [["Radius", sketchEntity.entity.radius]] : []} />
          {sketchEntity.entity.type === "point" ? (
            <div className="inspector-form">
              <label>
                X
                <CommitInput
                  value={(sketchEntity.entity as SketchPoint).x.expression}
                  onCommit={(value) =>
                    updateSketchEntityExpression(
                      updateDocument,
                      sketchEntity.sketch.id,
                      sketchEntity.entity.id,
                      "x",
                      value,
                    )
                  }
                />
              </label>
              <label>
                Y
                <CommitInput
                  value={(sketchEntity.entity as SketchPoint).y.expression}
                  onCommit={(value) =>
                    updateSketchEntityExpression(
                      updateDocument,
                      sketchEntity.sketch.id,
                      sketchEntity.entity.id,
                      "y",
                      value,
                    )
                  }
                />
              </label>
            </div>
          ) : null}
          {sketchEntity.entity.type === "circle" ? (
            <div className="inspector-form">
              <label>
                Radius
                <CommitInput
                  value={
                    (sketchEntity.entity as SketchCircle).radius.expression
                  }
                  onCommit={(value) =>
                    updateSketchEntityExpression(
                      updateDocument,
                      sketchEntity.sketch.id,
                      sketchEntity.entity.id,
                      "radius",
                      value,
                    )
                  }
                />
              </label>
            </div>
          ) : null}
          <SketchEntityReferences sketch={sketchEntity.sketch} entity={sketchEntity.entity} />
          {sketchEntity.entity.type === "line" ? (
            <p className="muted">
              Line endpoints are edited through their point entities.
            </p>
          ) : null}
        </div>
      ) : null}
      {body ? (
        <div key={`body:${body.id}`} className="item-card">
          <strong>{body.name}</strong>
          <p className="muted">
            Generated from {body.featureId ?? "unknown feature"}
          </p>
          {bodyFeature ? (
            <button
              onClick={() =>
                select({
                  kind: "feature",
                  id: bodyFeature.id,
                  documentId: document.id,
                })
              }
            >
              Select Source Feature
            </button>
          ) : null}
          {bodyMesh ? (
            <dl className="inspector-facts">
              <div>
                <dt>Vertices</dt>
                <dd>{bodyMesh.positions.length / 3}</dd>
              </div>
              <div>
                <dt>Triangles</dt>
                <dd>
                  {body.triangleCount !== undefined
                    ? body.triangleCount
                    : Math.floor(bodyMesh.indices.length / 3)}
                </dd>
              </div>
              {bodyMesh.geometryAssertions ? (
                <>
                  <div>
                    <dt>Volume (mm³)</dt>
                    <dd>{bodyMesh.geometryAssertions.volume.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>Solids</dt>
                    <dd>{bodyMesh.geometryAssertions.solidCount}</dd>
                  </div>
                </>
              ) : null}
              {body.bounds ? (
                <div>
                  <dt>Bounds</dt>
                  <dd>
                    {formatBounds(body.bounds.min)} to{" "}
                    {formatBounds(body.bounds.max)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatBounds(value: [number, number, number]): string {
  return value.map((item) => item.toFixed(3)).join(", ");
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
    if (
      !feature ||
      feature.type !== "extrude" ||
      feature.distance.expression === expression
    )
      return document;
    const distance = { ...feature.distance, expression };
    const termination =
      feature.termination?.type === "distance"
        ? { ...feature.termination, distance }
        : (feature.termination ?? { type: "distance", distance });
    return documentOps.upsertFeature(document, {
      ...feature,
      distance,
      termination,
    });
  });
}

function updateExtrudeOperation(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  operation: string,
) {
  if (!isExtrudeOperation(operation)) return;
  updateDocument((document) => {
    if (!document) return document;
    const feature = document.features.find((item) => item.id === featureId);
    if (
      !feature ||
      feature.type !== "extrude" ||
      feature.operation === operation
    )
      return document;
    return documentOps.upsertFeature(document, { ...feature, operation });
  });
}

function isExtrudeOperation(
  value: string,
): value is (typeof EXTRUDE_OPERATIONS)[number] {
  return EXTRUDE_OPERATIONS.includes(
    value as (typeof EXTRUDE_OPERATIONS)[number],
  );
}

function updateExtrudeDirection(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  direction: string,
) {
  if (!EXTRUDE_DIRECTIONS.includes(direction as (typeof EXTRUDE_DIRECTIONS)[number])) return;
  updateDocument((document) => {
    if (!document) return document;
    const feature = document.features.find((item) => item.id === featureId);
    if (
      !feature ||
      feature.type !== "extrude" ||
      feature.direction === direction
    )
      return document;
    return documentOps.upsertFeature(document, { ...feature, direction: direction as (typeof EXTRUDE_DIRECTIONS)[number] });
  });
}

function updateExtrudeTermination(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  featureId: string,
  value: string,
) {
  if (
    !EXTRUDE_TERMINATIONS.includes(
      value as (typeof EXTRUDE_TERMINATIONS)[number],
    )
  )
    return;
  updateDocument((document) => {
    const feature = document.features.find((item) => item.id === featureId);
    if (!feature || feature.type !== "extrude") return document;
    if (value === "throughAll")
      return documentOps.upsertFeature(document, {
        ...feature,
        termination: { type: "throughAll" },
      });
    if (value === "toFace") return document;
    return documentOps.upsertFeature(document, {
      ...feature,
      termination: { type: "distance", distance: feature.distance },
    });
  });
}

function updateSketchEntityExpression(
  updateDocument: ReturnType<typeof useCadStore.getState>["updateDocument"],
  sketchId: string,
  entityId: string,
  field: "x" | "y" | "radius",
  expression: string,
) {
  const current =
    useCadStore.getState().history.present?.sketches[sketchId]?.entities[
      entityId
    ];
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
