import { useCanvasLabelDrag } from "./useCanvasLabelDrag";
import {
  layoutCanvasLabels,
  MAX_CANVAS_LABELS,
  type CanvasLabelView,
} from "../../cad/sketch/canvasLabelLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  canvasAnnotations,
  canvasEntitySize,
  canvasSizeExpression,
  CANVAS_DIMENSION_TYPES,
  dimensionReferenceCount,
  pointDimension,
  type CanvasDimensionInput,
} from "../../cad/sketch/canvasDimensions";
import type { SketchDimension } from "../../cad/document/schema";
import { useRepairFocus } from "../commands/repairCommand";
import {
  canvasContext,
  commitCanvasDimension,
  type CanvasSession,
} from "../commands/sketchCanvasCommand";

const EMPTY_GEOMETRY_SELECTION: readonly string[] = [];
type Context = ReturnType<typeof canvasContext>;
/** Controls and SVG annotations share one selection; every edit goes through document history. */
export function useCanvasDimensions(
  active: CanvasSession,
  context: Context | undefined,
  span: number,
  cancelDrawing: () => void,
  view: CanvasLabelView,
  focused = false,
  inspectReferences = true,
  onInspect?: () => void,
  selectedGeometry: readonly string[] = EMPTY_GEOMETRY_SELECTION,
) {
  const [showReference, setShowReference] = useState(false),
    [showDimensions, setShowDimensions] = useState(true),
    [positionReferences, setPositionReferences] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false),
    [advancedOpen, setAdvancedOpen] = useState(!focused);
  useEffect(() => setAdvancedOpen(!focused), [focused]);
  const editorRef = useRef<HTMLInputElement>(null);
  const editorDocument = useRef(context?.document);
  const finishEditing = () => {
    setEditorOpen(false);
    editorRef.current
      ?.closest(".sketch-workspace-drawing")
      ?.querySelector<SVGSVGElement>('svg[aria-label="Sketch drawing canvas"]')
      ?.focus({ preventScroll: true });
  };
  const [type, setType] = useState<SketchDimension["type"]>("length"),
    [ref1, setRef1] = useState(""),
    [ref2, setRef2] = useState("");
  useEffect(() => {
    if (editorOpen) {
      editorRef.current?.focus({ preventScroll: true });
      editorRef.current?.select();
    }
  }, [editorOpen, selectedId, ref1]);
  const [expression, setExpression] = useState("10mm"),
    [error, setError] = useState<string>();
  const sketch = context?.sketch,
    document = context?.document,
    selected = sketch?.dimensions.find((d) => d.id === selectedId);
  useEffect(() => {
    if (!sketch) return;
    if (selectedId && !selected) {
      setSelectedId("");
      setExpression(type === "angle" ? "90deg" : "10mm");
      setEditorOpen(false);
      setError("Dimension was removed. Select a current dimension.");
    }
    if (selected) setExpression(selected.expression.expression);
  }, [selectedId, selected?.expression.expression, !!selected]);
  const annotations = useMemo(
    () =>
      context
        ? canvasAnnotations(
            context.sketch,
            context.solved,
            context.document.displayUnits ?? context.document.unitSettings,
            span,
            true,
            context.pending,
          ).filter(
            (annotation) => annotation.dimensionId || showReference ||
              (annotation.id.startsWith("reference:") && selectedGeometry.includes(annotation.id.slice("reference:".length))),
          )
        : [],
    [context, span, showReference, selectedGeometry],
  );
  const visible = useMemo(
    () =>
      showDimensions
        ? annotations
            .filter((a) => a.anchored)
            .sort(
              (a, b) =>
                Number(b.dimensionId === selectedId) -
                Number(a.dimensionId === selectedId),
            )
            .slice(0, MAX_CANVAS_LABELS)
        : [],
    [annotations, showDimensions, selectedId],
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
  const select = (id: string, openEditor = true) => {
    onInspect?.();
    cancelDrawing();
    setError(undefined);
    setSelectedId(id);
    if (!id) setExpression(type === "angle" ? "90deg" : "10mm");
    editorDocument.current = document;
    setEditorOpen(openEditor && Boolean(id));
  };
  const appliedRepair = useRef<ReturnType<typeof useRepairFocus.getState>["focus"]>(undefined);
  const repairFocus = useRepairFocus((state) => state.focus);
  useEffect(() => {
    if (repairFocus && appliedRepair.current !== repairFocus && repairFocus.document === document && repairFocus.session === active.session &&
      repairFocus.sketchId === active.sketchId && repairFocus.dimensionId) {
      appliedRepair.current = repairFocus;
      select(repairFocus.dimensionId);
      setShowDimensions(true);
    }
  }, [repairFocus, document, active.session, active.sketchId]);
  const selectEntity = (id: string) => {
    onInspect?.();
    if (!context) return;
    const size = canvasEntitySize(context.solved, id);
    if (!size) return;
    const existing = sketch?.dimensions.find(
      (d) =>
        d.entityIds.length === 1 &&
        d.entityIds[0] === id &&
        (size?.type === "length"
          ? d.type === "length"
          : d.type === "radius" || d.type === "diameter"),
    );
    if (existing) {
      select(existing.id);
      return;
    }
    const measuredExpression = canvasSizeExpression(
      size.value,
      context.document.unitSettings.length,
    );
    if (measuredExpression === undefined) {
      setEditorOpen(false);
      setError(
        "Reference size is unavailable or exceeds supported dimension limits. Inspect sketch diagnostics.",
      );
      return;
    }
    cancelDrawing();
    setSelectedId("");
    setType(size.type);
    setRef1(id);
    setRef2("");
    setExpression(measuredExpression);
    editorDocument.current = document;
    setError(undefined);
    setEditorOpen(true);
  };
  const removeSelected = () => {
    if (!context || !document || !selected) return;
    cancelDrawing();
    try {
      commitCanvasDimension(active, document, undefined, selected.id);
      setSelectedId("");
      setExpression(type === "angle" ? "90deg" : "10mm");
      setEditorOpen(false);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = (inline = false) => {
    if (!context || !document) return;
    cancelDrawing();
    try {
      if (inline && editorDocument.current !== document)
        throw new Error(
          "The sketch changed while editing. Cancel and select the size again.",
        );
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
      if (inline)
        input.authoredUnit =
          selected?.expression.authoredUnit ??
          (input.type === "angle"
            ? context.document.unitSettings.angle
            : context.document.unitSettings.length);
      const id = commitCanvasDimension(active, document, input);
      if (id) setSelectedId(id);
      setError(undefined);
      if (inline) finishEditing();
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
      {focused ? (
        <p>
          Click a D label to edit its driving dimension. Select geometry to
          inspect its reference measurement; show all references in display tools.
        </p>
      ) : null}
      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>Dimension tools and display</summary>
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
              onChange={(e) => select(e.target.value, false)}
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
                    setExpression(
                      e.target.value === "angle" ? "90deg" : "10mm",
                    );
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
            onClick={() => save()}
          >
            {sketch?.solveMode === "validate"
              ? "Enable driving and apply dimension"
              : "Apply driving dimension"}
          </button>
          {selected ? (
            <button
              onClick={removeSelected}
            >
              Delete canvas dimension
            </button>
          ) : null}
        </div>
        <p>
          Reference measurements describe solved geometry. D labels are editable
          driving dimensions; click a D label or choose it above. Drag any
          dimension label to reposition it in this open canvas. Focus a label
          and use arrow keys (Shift for larger steps); Home restores automatic
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
      </details>
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
      <details open={!focused}>
        <summary>
          All driving dimensions ({sketch?.dimensions.length ?? 0})
        </summary>
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
      </details>
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
            style={{
              pointerEvents:
                !a.dimensionId && !positionReferences && !inspectReferences
                  ? "none"
                  : undefined,
            }}
            data-dimension-id={a.dimensionId}
            data-layout-crowded={placed.crowded}
            className={`${a.dimensionId ? "canvas-driving-dimension" : "canvas-reference-dimension"}${focused && selectedId && a.dimensionId !== selectedId ? " canvas-dimension-muted" : ""}${a.unavailable ? " canvas-dimension-unavailable" : ""}`}
            {...(a.dimensionId || positionReferences || focused
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": a.dimensionId
                    ? `Edit drawing ${a.label}`
                    : positionReferences
                      ? `Position drawing ${a.label}`
                      : `Inspect drawing ${a.label}`,
                  ...(a.dimensionId || positionReferences
                    ? labelDrag.handlers(a.id, placed.position, () => {
                        if (a.dimensionId) select(a.dimensionId);
                        else if (focused)
                          selectEntity(a.id.slice("reference:".length));
                      })
                    : {
                        onPointerDown: (
                          event: React.PointerEvent<SVGGElement>,
                        ) => event.stopPropagation(),
                        onClick: (event: React.MouseEvent<SVGGElement>) => {
                          event.stopPropagation();
                          selectEntity(a.id.slice("reference:".length));
                        },
                        onKeyDown: (
                          event: React.KeyboardEvent<SVGGElement>,
                        ) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            selectEntity(a.id.slice("reference:".length));
                          }
                        },
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
                <line
                  pointerEvents="none"
                  key={j}
                  x1={p.x}
                  y1={-p.y}
                  x2={q.x}
                  y2={-q.y}
                />
              ))}
            {[a.position.x, a.position.y].every(Number.isFinite) &&
            (placed.position.x !== a.position.x ||
              placed.position.y !== a.position.y) ? (
              <line
                pointerEvents="none"
                x1={a.position.x}
                y1={-a.position.y}
                x2={placed.position.x}
                y2={-placed.position.y}
              />
            ) : null}
            {a.dimensionId || positionReferences || focused ? (
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
  const selectedAnnotation = annotations.find(
    (a) =>
      a.dimensionId === selectedId ||
      (!selectedId && a.id === `reference:${ref1}`),
  );
  const selectedEntityId = selected?.entityIds[0] ?? ref1;
  const position = selectedAnnotation?.position;
  const inlineEditor =
    editorOpen && context ? (
      <form
        className="canvas-inline-dimension"
        aria-label="Selected sketch size"
        style={{
          left: `min(${position ? Math.max(2, Math.min(65, ((position.x - view.x) / view.width) * 100)) : 4}%, max(2%, calc(100% - 260px)))`,
          top: `min(${position ? Math.max(2, Math.min(75, ((view.y + view.height - position.y) / view.height) * 100)) : 4}%, max(2%, calc(100% - 200px)))`,
        }}
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finishEditing();
            setError(undefined);
          }
        }}
      >
        <strong>
          {selected ? "Edit driving dimension" : "Reference measurement"}
        </strong>
        <label>
          {selected?.type ?? type} (
          {selected?.expression.authoredUnit ??
            ((selected?.type ?? type) === "angle"
              ? context.document.unitSettings.angle
              : context.document.unitSettings.length)}
          )
          <input
            ref={editorRef}
            aria-label="Sketch size expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            maxLength={2000}
          />
        </label>
        <button type="submit">
          {selected ? "Apply size" : "Make driving dimension"}
        </button>
        {selected ? <button type="button" onClick={removeSelected}>Delete this dimension</button> : null}
        <button
          type="button"
          onClick={() => {
            finishEditing();
            setError(undefined);
          }}
        >
          Cancel size edit
        </button>
        {selectedAnnotation?.unavailable ? (
          <p role="status">
            The current size is unavailable. Repair the expression or inspect
            the sketch diagnostics.
          </p>
        ) : null}
      </form>
    ) : null;
  return {
    controls,
    overlay,
    labelBoxes,
    inlineEditor,
    selectEntity,
    selectedEntityId,
    selectedId,
    clearSelection: () => {
      setSelectedId("");
      setRef1("");
      setRef2("");
      setEditorOpen(false);
      setError(undefined);
    },
    closeInlineEditor: () => setEditorOpen(false),
  };
}
