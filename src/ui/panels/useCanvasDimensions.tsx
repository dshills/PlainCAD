import { useCanvasLabelDrag } from "./useCanvasLabelDrag";
import {
  layoutCanvasLabels,
  MAX_CANVAS_LABELS,
  type CanvasLabelView,
} from "../../cad/sketch/canvasLabelLayout";
import { useEffect, useMemo, useState } from "react";
import {
  canvasAnnotations,
  CANVAS_DIMENSION_TYPES,
  dimensionReferenceCount,
  pointDimension,
  type CanvasDimensionInput,
} from "../../cad/sketch/canvasDimensions";
import type { SketchDimension } from "../../cad/document/schema";
import {
  canvasContext,
  commitCanvasDimension,
  type CanvasSession,
} from "../commands/sketchCanvasCommand";

type Context = ReturnType<typeof canvasContext>;
/** Controls and SVG annotations share one selection; every edit goes through document history. */
export function useCanvasDimensions(
  active: CanvasSession,
  context: Context | undefined,
  span: number,
  cancelDrawing: () => void,
  view: CanvasLabelView,
) {
  const [showReference, setShowReference] = useState(true),
    [showDimensions, setShowDimensions] = useState(true),
    [positionReferences, setPositionReferences] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [type, setType] = useState<SketchDimension["type"]>("length"),
    [ref1, setRef1] = useState(""),
    [ref2, setRef2] = useState("");
  const [expression, setExpression] = useState("10mm"),
    [error, setError] = useState<string>();
  const sketch = context?.sketch,
    document = context?.document,
    selected = sketch?.dimensions.find((d) => d.id === selectedId);
  useEffect(() => {
    if (!sketch) return;
    if (selectedId && !selected) {
      setSelectedId("");
      setError("Dimension was removed. Select a current dimension.");
    }
    setExpression(
      selected
        ? selected.expression.expression
        : type === "angle"
          ? "90deg"
          : "10mm",
    );
  }, [selectedId, selected?.expression.expression, !!selected]);
  const annotations = useMemo(
    () =>
      context
        ? canvasAnnotations(
            context.sketch,
            context.solved,
            context.document.displayUnits ?? context.document.unitSettings,
            span,
            showReference,
            context.pending,
          )
        : [],
    [context, span, showReference],
  );
  const visible = useMemo(
    () =>
      showDimensions
        ? annotations.filter((a) => a.anchored).slice(0, MAX_CANVAS_LABELS)
        : [],
    [annotations, showDimensions],
  );
  const labelDrag = useCanvasLabelDrag(
    document,
    view,
    annotations
      .filter((a) => a.anchored)
      .slice(0, MAX_CANVAS_LABELS)
      .map((a) => a.id),
  );
  const placements = useMemo(
    () =>
      layoutCanvasLabels(
        visible.map((a) => ({
          ...a,
          align: "middle" as const,
          manualPosition: labelDrag.positions[a.id],
        })),
        span / 48,
        view,
        [],
        Object.values(context?.solved.points ?? {}),
      ),
    [visible, span, view, context?.solved, labelDrag.positions],
  );
  const labelBoxes = useMemo(
    () => [...placements.values()].map((p) => p.box),
    [placements],
  );
  const crowded = [...placements.values()].filter((p) => p.crowded).length;
  const select = (id: string) => {
    cancelDrawing();
    setError(undefined);
    setSelectedId(id);
  };
  const save = () => {
    if (!context || !document) return;
    cancelDrawing();
    try {
      const input: CanvasDimensionInput = selected
        ? {
            id: selected.id,
            type: selected.type,
            refs: pointDimension(selected.type)
              ? (selected.pointIds ?? [])
              : selected.entityIds,
            expression,
          }
        : {
            type,
            refs: [
              ref1,
              ...(dimensionReferenceCount(type) === 2 ? [ref2] : []),
            ],
            expression,
          };
      const id = commitCanvasDimension(active, document, input);
      if (id) setSelectedId(id);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const choices = Object.values(sketch?.entities ?? {}).filter((e) =>
    pointDimension(type)
      ? e.type === "point"
      : type === "radius" || type === "diameter"
        ? e.type === "circle" || e.type === "arc"
        : e.type === "line",
  );
  const options = (
    <>
      <option value="">Select geometry</option>
      {choices.map((e, i) => (
        <option key={e.id} value={e.id}>
          {e.type} {i + 1} ({e.id})
        </option>
      ))}
    </>
  );
  const controls = (
    <section
      aria-label="Canvas dimensions"
      className="canvas-dimension-controls"
    >
      <h3>Drawing dimensions</h3>
      <div className="canvas-toolbar">
        <label>
          <input
            type="checkbox"
            checked={showDimensions}
            onChange={(e) => setShowDimensions(e.target.checked)}
          />
          Show drawing dimensions
        </label>
        <label>
          <input
            type="checkbox"
            checked={showReference}
            onChange={(e) => setShowReference(e.target.checked)}
          />
          Show reference measurements
        </label>
        <label>
          <input
            type="checkbox"
            checked={positionReferences}
            onChange={(event) => {
              labelDrag.cancel();
              setPositionReferences(event.target.checked);
            }}
          />
          Position reference labels
        </label>
        <label>
          Dimension
          <select
            aria-label="Canvas dimension selection"
            value={selectedId}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">New driving dimension</option>
            {sketch?.dimensions.map((d, i) => (
              <option key={d.id} value={d.id}>
                D{i + 1} {d.type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="canvas-toolbar">
        {selected ? (
          <span>
            D{sketch!.dimensions.indexOf(selected) + 1} {selected.type}
          </span>
        ) : (
          <>
            <label>
              Type
              <select
                aria-label="Canvas dimension type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as SketchDimension["type"]);
                  setRef1("");
                  setRef2("");
                  setExpression(e.target.value === "angle" ? "90deg" : "10mm");
                }}
              >
                {CANVAS_DIMENSION_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Reference 1
              <select
                aria-label="Canvas dimension reference 1"
                value={ref1}
                onChange={(e) => setRef1(e.target.value)}
              >
                {options}
              </select>
            </label>
            {dimensionReferenceCount(type) === 2 ? (
              <label>
                Reference 2
                <select
                  aria-label="Canvas dimension reference 2"
                  value={ref2}
                  onChange={(e) => setRef2(e.target.value)}
                >
                  {options}
                </select>
              </label>
            ) : null}
          </>
        )}
        <label>
          Expression
          <input
            aria-label="Canvas dimension expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>
        <button
          disabled={
            !context ||
            (!selected &&
              (!ref1 ||
                (dimensionReferenceCount(type) === 2 &&
                  (!ref2 || ref1 === ref2))))
          }
          onClick={save}
        >
          {sketch?.solveMode === "validate"
            ? "Enable driving and apply dimension"
            : "Apply driving dimension"}
        </button>
        {selected ? (
          <button
            onClick={() => {
              if (!context || !document) return;
              cancelDrawing();
              try {
                commitCanvasDimension(active, document, undefined, selected.id);
                setSelectedId("");
                setError(undefined);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Delete canvas dimension
          </button>
        ) : null}
      </div>
      <p>
        Reference measurements describe solved geometry. D labels are editable
        driving dimensions; click a D label or choose it above. Drag any
        dimension label to reposition it in this open canvas. Focus a label and
        use arrow keys (Shift for larger steps); Home restores automatic
        placement. Escape cancels a drag. Placement does not edit or save the
        model. Failed solves report unavailable values. Display units follow
        project settings.
      </p>
      <button
        type="button"
        disabled={!Object.keys(labelDrag.positions).length}
        onClick={labelDrag.reset}
      >
        Reset dimension label placement
      </button>
      {showDimensions &&
      annotations.filter((a) => a.anchored).length > MAX_CANVAS_LABELS ? (
        <p>
          Canvas shows the first {MAX_CANVAS_LABELS} dimension labels. All
          driving dimensions remain available in the list.
        </p>
      ) : null}
      {showDimensions && crowded ? (
        <p role="status">
          {crowded} dimension labels remain crowded in this view. Zoom in or
          hide reference measurements.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {context?.solved.errors
        .filter((e) => e.severity === "error")
        .map((e, i) => (
          <p role="alert" key={`${e.constraintId}:${i}`}>
            {e.message}
          </p>
        ))}
      <ul className="canvas-dimension-list">
        {annotations
          .filter((a) => a.dimensionId)
          .map((a, i) => (
            <li key={a.id}>
              <button
                aria-label={`Edit canvas dimension ${i + 1}`}
                title={a.title}
                onClick={() => select(a.dimensionId!)}
              >
                {a.label}
              </button>
              <span>{a.title}</span>
            </li>
          ))}
      </ul>
    </section>
  );
  const overlay = showDimensions ? (
    <g
      className="canvas-dimensions"
      fontSize={span / 48}
      strokeWidth={span / 850}
    >
      {visible.map((a, i) => {
        const placed = placements.get(a.id);
        if (!placed) return null;
        return (
          <g
            key={a.id}
            data-annotation-id={a.id}
            data-dimension-id={a.dimensionId}
            data-layout-crowded={placed.crowded}
            className={`${a.dimensionId ? "canvas-driving-dimension" : "canvas-reference-dimension"}${a.unavailable ? " canvas-dimension-unavailable" : ""}`}
            {...(a.dimensionId || positionReferences
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": a.dimensionId
                    ? `Edit drawing ${a.label}`
                    : `Position drawing ${a.label}`,
                  ...labelDrag.handlers(a.id, placed.position, () => {
                    if (a.dimensionId) select(a.dimensionId);
                  }),
                }
              : {})}
          >
            <title>
              {a.title}
              {placed.crowded ? " — label layout remains crowded" : ""}
            </title>
            {a.lines
              .filter(([p, q]) => [p.x, p.y, q.x, q.y].every(Number.isFinite))
              .map(([p, q], j) => (
                <line key={j} x1={p.x} y1={-p.y} x2={q.x} y2={-q.y} />
              ))}
            {[a.position.x, a.position.y].every(Number.isFinite) &&
            (placed.position.x !== a.position.x ||
              placed.position.y !== a.position.y) ? (
              <line
                x1={a.position.x}
                y1={-a.position.y}
                x2={placed.position.x}
                y2={-placed.position.y}
              />
            ) : null}
            {a.dimensionId || positionReferences ? (
              <rect
                className="canvas-label-focus"
                aria-hidden="true"
                x={placed.box.minX}
                y={-placed.box.maxY}
                width={placed.box.maxX - placed.box.minX}
                height={placed.box.maxY - placed.box.minY}
              />
            ) : null}
            <text
              data-testid={`canvas-annotation-${i}`}
              x={placed.position.x}
              y={-placed.position.y}
              textAnchor="middle"
            >
              {a.label}
            </text>
          </g>
        );
      })}
    </g>
  ) : null;
  return { controls, overlay, labelBoxes };
}
