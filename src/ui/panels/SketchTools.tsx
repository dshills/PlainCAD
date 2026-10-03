import { runCommand } from "../commands/commandRegistry";
import { useMemo, useState } from "react";
import {
  CadDocument,
  ConstraintType,
  FacePlaneReference,
  OriginPlane,
  Sketch,
  SketchDimension,
} from "../../cad/document/schema";
import { createId } from "../../cad/document/ids";
import { upsertSketch } from "../../cad/document/CadDocument";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  expressionRef,
  setConstruction,
} from "../../cad/sketch/SketchModel";
import {
  faceOwnerModifiedBefore,
  resolveDocumentPlanes,
} from "../../cad/sketch/planes";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { useCadStore } from "../../state/useCadStore";
import { AuthoredUnitsNote } from "./AuthoredUnitsNote";

const constraintTypes: ConstraintType[] = [
  "fixed",
  "coincident",
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "tangent",
  "equalLength",
  "equalRadius",
  "midpoint",
  "symmetric",
];
const dimensionTypes: SketchDimension["type"][] = [
  "length",
  "radius",
  "diameter",
  "horizontalDistance",
  "verticalDistance",
  "distance",
  "angle",
];

export function SketchTools({
  sketch,
  document,
}: {
  sketch: Sketch;
  document: CadDocument;
}) {
  const updateDocument = useCadStore((s) => s.updateDocument);
  const selected = useCadStore((s) => s.selection.selectedIds[0]);
  const [kind, setKind] = useState("point"),
    [x, setX] = useState("0mm"),
    [y, setY] = useState("0mm"),
    [radius, setRadius] = useState("10mm");
  const [a, setA] = useState(""),
    [b, setB] = useState(""),
    [c, setC] = useState(""),
    [clockwise, setClockwise] = useState(false),
    [construction, setIsConstruction] = useState(false);
  const [dimension, setDimension] = useState<SketchDimension["type"]>("length"),
    [dimensionA, setDimensionA] = useState(""),
    [dimensionB, setDimensionB] = useState(""),
    [value, setValue] = useState("10mm");
  const [constraint, setConstraint] = useState<ConstraintType>("fixed"),
    [constraintEntities, setConstraintEntities] = useState<string[]>([]),
    [constraintPoints, setConstraintPoints] = useState<string[]>([]);
  const initialBase =
    sketch.plane.type === "origin"
      ? sketch.plane.plane
      : sketch.plane.type === "face"
        ? sketch.plane.stableFaceId
        : typeof sketch.plane.base === "string"
          ? sketch.plane.base
          : sketch.plane.base.stableFaceId;
  const [base, setBase] = useState(initialBase),
    [offset, setOffset] = useState(
      sketch.plane.type === "offset" ? sketch.plane.offset.expression : "0mm",
    ),
    [planeKind, setPlaneKind] = useState<string>(sketch.plane.type);
  const parameters = useMemo(
    () => evaluateParameters(document.parameters).values,
    [document.parameters],
  );
  const rebuild = useCadStore((s) => s.rebuild);
  const canonical = useMemo(
    () => solveSketch(sketch, parameters),
    [sketch, parameters],
  );
  const solved =
    rebuild.status === "succeeded" && rebuild.result?.documentId === document.id
      ? (rebuild.result.solvedSketches?.[sketch.id] ?? canonical)
      : canonical;
  const planes = useMemo(
    () =>
      resolveDocumentPlanes(
        document,
        parameters,
        rebuild.status === "succeeded" && rebuild.result?.solvedSketches
          ? new Map(Object.entries(rebuild.result.solvedSketches))
          : undefined,
      ),
    [document, parameters, rebuild],
  );
  const entities = Object.values(sketch.entities);
  const points = entities.filter((e) => e.type === "point"),
    curves = entities.filter((e) => e.type !== "point");
  const labels = new Map<string, string>();
  for (const type of ["point", "line", "circle", "arc"])
    entities
      .filter((e) => e.type === type)
      .forEach((e, i) => labels.set(e.id, `${type} ${i + 1}`));
  const [inputError, setInputError] = useState<string>();
  const change = (mutator: (s: Sketch) => Sketch) => {
    try {
      updateDocument((d) => upsertSketch(d, mutator(d.sketches[sketch.id])));
      setInputError(undefined);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    }
  };
  const opts = (list: typeof entities) => (
    <>
      <option value="">Select geometry</option>
      {list.map((e) => (
        <option value={e.id} key={e.id}>
          {labels.get(e.id)}
        </option>
      ))}
    </>
  );
  const refs =
    dimension === "horizontalDistance" ||
    dimension === "verticalDistance" ||
    dimension === "distance"
      ? points
      : curves.filter((e) =>
          dimension === "angle" || dimension === "length"
            ? e.type === "line"
            : e.type === "circle" || e.type === "arc",
        );
  const isPointDimension = [
    "horizontalDistance",
    "verticalDistance",
    "distance",
  ].includes(dimension);
  const selectedEntity =
    selected?.kind === "sketchEntity"
      ? sketch.entities[selected.id]
      : undefined;
  const diagnosticLabel = (error: (typeof solved.errors)[number]) => {
    const dimensionIndex = sketch.dimensions.findIndex(
      (d) => d.id === error.constraintId,
    );
    const constraintIndex = sketch.constraints.findIndex(
      (c) => c.id === error.constraintId,
    );
    return dimensionIndex >= 0
      ? `Dimension ${dimensionIndex + 1} (${sketch.dimensions[dimensionIndex].type})`
      : constraintIndex >= 0
        ? `Constraint ${constraintIndex + 1} (${sketch.constraints[constraintIndex].type})`
        : error.entityId
          ? (labels.get(error.entityId) ?? "Geometry")
          : "Sketch";
  };
  const availableFaces = planes.faces.filter((f) => {
    const feature = document.features.find((item) => item.id === f.featureId);
    return (
      !faceOwnerModifiedBefore(document, f.featureId, sketch) &&
      feature?.timelineStep !== undefined &&
      sketch.timelineStep !== undefined &&
      feature.timelineStep < sketch.timelineStep
    );
  });
  const selectedBase = (): OriginPlane | FacePlaneReference => {
    const face = availableFaces.find((f) => f.id === base);
    return face
      ? { type: "face", featureId: face.featureId, stableFaceId: face.id }
      : (base as OriginPlane);
  };
  return (
    <section aria-label="Sketch tools" className="inspector-form sketch-tools">
      <h3>Sketch solve</h3>
      {inputError ? (
        <p role="alert" className="error-text">
          {inputError}
        </p>
      ) : null}
      <p role="status">
        {solved.status}, {solved.degreesOfFreedom} degrees of freedom
      </p>
      {solved.errors.map((e, i) => (
        <p className="error-text" key={`${e.constraintId ?? e.entityId}:${i}`}>
          {diagnosticLabel(e)}: {e.message}
        </p>
      ))}
      {sketch.solveMode === "validate" ? (
        <>
          <p>Legacy dimensions validate coordinates.</p>
          <button
            onClick={() => change((s) => ({ ...s, solveMode: "driving" }))}
          >
            Enable driving dimensions
          </button>
        </>
      ) : null}
      <button
        onClick={() =>
          change((s) => ({ ...s, solveRevision: (s.solveRevision ?? 0) + 1 }))
        }
      >
        Reset sketch solve
      </button>
      <h3>Draw geometry</h3>
      <button onClick={() => { useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id }); void runCommand("sketch.editCanvas"); }}>Open sketch canvas</button>
      <label>
        Geometry type
        <select
          aria-label="Geometry type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {["point", "line", "circle", "arc"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      {kind === "point" ? (
        <>
          <label>
            X
            <input
              aria-label="New point X"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          </label>
          <label>
            Y
            <input
              aria-label="New point Y"
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            {kind === "circle" || kind === "arc" ? "Center" : "Start"}
            <select
              aria-label="Geometry point 1"
              value={a}
              onChange={(e) => setA(e.target.value)}
            >
              {opts(points)}
            </select>
          </label>
          {kind !== "circle" ? (
            <label>
              {kind === "arc" ? "Start" : "End"}
              <select
                aria-label="Geometry point 2"
                value={b}
                onChange={(e) => setB(e.target.value)}
              >
                {opts(points)}
              </select>
            </label>
          ) : (
            <label>
              Radius
              <input
                aria-label="New circle radius"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
              />
            </label>
          )}
          {kind === "arc" ? (
            <>
              <label>
                End
                <select
                  aria-label="Geometry point 3"
                  value={c}
                  onChange={(e) => setC(e.target.value)}
                >
                  {opts(points)}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={clockwise}
                  onChange={(e) => setClockwise(e.target.checked)}
                />
                Clockwise arc
              </label>
            </>
          ) : null}
        </>
      )}
      <label>
        <input
          type="checkbox"
          checked={construction}
          onChange={(e) => setIsConstruction(e.target.checked)}
        />
        New construction geometry
      </label>
      <button
        disabled={
          kind !== "point" &&
          (!a || (kind !== "circle" && (!b || (kind === "arc" && !c))))
        }
        onClick={() =>
          change((s) => {
            if (kind === "point") {
              const result = addPoint(s, x, y);
              return setConstruction(
                result.sketch,
                result.pointId,
                construction,
              );
            }
            if (kind === "line") {
              const result = addLine(s, a, b);
              return setConstruction(
                result.sketch,
                result.lineId,
                construction,
              );
            }
            if (kind === "circle") {
              const result = addCircle(s, a, radius);
              return setConstruction(
                result.sketch,
                result.circleId,
                construction,
              );
            }
            const result = addArc(s, a, b, c, clockwise);
            return setConstruction(result.sketch, result.arcId, construction);
          })
        }
      >
        Add geometry
      </button>
      {selectedEntity ? (
        <label>
          <input
            aria-label="Selected entity construction"
            type="checkbox"
            checked={selectedEntity.construction ?? false}
            onChange={(e) =>
              change((s) =>
                setConstruction(s, selectedEntity.id, e.target.checked),
              )
            }
          />
          Construction {labels.get(selectedEntity.id)}
        </label>
      ) : null}
      <h3>Dimensions</h3>
      <label>
        Dimension type
        <select
          aria-label="Dimension type"
          value={dimension}
          onChange={(e) => {
            setDimension(e.target.value as SketchDimension["type"]);
            setDimensionA("");
            setDimensionB("");
            setValue(e.target.value === "angle" ? "90deg" : "10mm");
          }}
        >
          {dimensionTypes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Reference 1
        <select
          aria-label="Dimension reference 1"
          value={dimensionA}
          onChange={(e) => setDimensionA(e.target.value)}
        >
          {opts(refs)}
        </select>
      </label>
      {isPointDimension || dimension === "angle" ? (
        <label>
          Reference 2
          <select
            aria-label="Dimension reference 2"
            value={dimensionB}
            onChange={(e) => setDimensionB(e.target.value)}
          >
            {opts(refs)}
          </select>
        </label>
      ) : null}
      <label>
        Expression
        <input
          aria-label="New dimension expression"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button
        disabled={
          !dimensionA ||
          ((isPointDimension || dimension === "angle") && !dimensionB)
        }
        onClick={() =>
          change((s) => ({
            ...s,
            dimensions: [
              ...s.dimensions,
              {
                id: createId("dimension"),
                type: dimension,
                entityIds: isPointDimension
                  ? []
                  : [
                      dimensionA,
                      ...(dimension === "angle" ? [dimensionB] : []),
                    ],
                ...(isPointDimension
                  ? { pointIds: [dimensionA, dimensionB] }
                  : {}),
                expression: expressionRef(
                  value,
                  dimension === "angle" ? "deg" : "mm",
                ),
              },
            ],
          }))
        }
      >
        Add dimension
      </button>
      {sketch.dimensions.map((d, i) => (
        <div key={d.id}>
          <AuthoredUnitsNote expressions={[[d.type, d.expression]]} />
          <label>
            {d.type}
            <input
              aria-label={`Dimension ${i + 1} expression`}
              key={`${d.id}:${d.expression.expression}`}
              defaultValue={d.expression.expression}
              onBlur={(e) => {
                const expression = e.target.value;
                if (expression !== d.expression.expression)
                  change((s) => ({
                    ...s,
                    dimensions: s.dimensions.map((item) =>
                      item.id === d.id
                        ? {
                            ...item,
                            expression: { ...item.expression, expression },
                          }
                        : item,
                    ),
                  }));
              }}
            />
          </label>
          <button
            aria-label={`Remove dimension ${i + 1}`}
            onClick={() =>
              change((s) => ({
                ...s,
                dimensions: s.dimensions.filter((item) => item.id !== d.id),
              }))
            }
          >
            Remove dimension
          </button>
        </div>
      ))}
      <h3>Constraints</h3>
      <label>
        Constraint type
        <select
          aria-label="Constraint type"
          value={constraint}
          onChange={(e) => setConstraint(e.target.value as ConstraintType)}
        >
          {constraintTypes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Entities
        <select
          aria-label="Constraint entities"
          multiple
          value={constraintEntities}
          onChange={(e) =>
            setConstraintEntities(
              Array.from(e.target.selectedOptions, (o) => o.value),
            )
          }
        >
          {curves.map((e) => (
            <option key={e.id} value={e.id}>
              {labels.get(e.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Points
        <select
          aria-label="Constraint points"
          multiple
          value={constraintPoints}
          onChange={(e) =>
            setConstraintPoints(
              Array.from(e.target.selectedOptions, (o) => o.value),
            )
          }
        >
          {points.map((e) => (
            <option key={e.id} value={e.id}>
              {labels.get(e.id)}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!constraintEntities.length && !constraintPoints.length}
        onClick={() =>
          change((s) =>
            addConstraint(s, constraint, {
              entityIds: constraintEntities,
              pointIds: constraintPoints,
            }),
          )
        }
      >
        Add constraint
      </button>
      {sketch.constraints.map((c, i) => (
        <div key={c.id}>
          {c.type}{" "}
          {c.entityIds
            .concat(c.pointIds ?? [])
            .map((id) => labels.get(id))
            .join(", ")}
          <button
            aria-label={`Remove constraint ${i + 1}`}
            onClick={() =>
              change((s) => ({
                ...s,
                constraints: s.constraints.filter((item) => item.id !== c.id),
              }))
            }
          >
            Remove constraint
          </button>
        </div>
      ))}
      <h3>Sketch plane</h3>
      {sketch.plane.type === "offset" ? <AuthoredUnitsNote expressions={[["Offset", sketch.plane.offset]]} /> : null}
      {planes.errors.has(sketch.id) ? (
        <p className="error-text">
          {planes.errors.get(sketch.id)} Geometry is preserved; select a
          replacement plane.
        </p>
      ) : null}
      <label>
        Plane type
        <select
          aria-label="Sketch plane type"
          value={planeKind}
          onChange={(e) => {
            const type = e.target.value;
            setPlaneKind(type);
            if (type === "origin") setBase("XY");
            else if (
              type === "face" &&
              !availableFaces.some((f) => f.id === base)
            )
              setBase(availableFaces[0]?.id ?? "");
          }}
        >
          {["origin", "offset", "face"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Plane reference
        <select
          aria-label="Sketch plane reference"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        >
          {planeKind !== "face"
            ? ["XY", "XZ", "YZ"].map((p) => <option key={p}>{p}</option>)
            : null}
          {planeKind !== "origin"
            ? availableFaces.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))
            : null}
        </select>
      </label>
      {planeKind === "offset" ? (
        <label>
          Offset
          <input
            aria-label="Sketch plane offset"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
          />
        </label>
      ) : null}
      <button
        disabled={
          planeKind === "face"
            ? !availableFaces.some((f) => f.id === base)
            : !["XY", "XZ", "YZ"].includes(base) &&
              !availableFaces.some((f) => f.id === base)
        }
        onClick={() =>
          change((s) => ({
            ...s,
            plane:
              planeKind === "origin"
                ? { type: "origin", plane: base as OriginPlane }
                : planeKind === "offset"
                  ? {
                      type: "offset",
                      base: selectedBase(),
                      offset: expressionRef(offset),
                    }
                  : (selectedBase() as FacePlaneReference),
          }))
        }
      >
        Apply sketch plane
      </button>
    </section>
  );
}
