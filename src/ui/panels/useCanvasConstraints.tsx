import { useCanvasLabelDrag } from "./useCanvasLabelDrag";
import {
  layoutCanvasLabels,
  MAX_CANVAS_LABELS,
  type CanvasLabelView,
  type CanvasLabelBox,
} from "../../cad/sketch/canvasLabelLayout";
import { useEffect, useMemo, useState } from "react";
import {
  canvasConstraintAnnotations,
  CONSTRAINT_REFERENCE_HINTS,
  MAX_CANVAS_CONSTRAINT_REFERENCES,
} from "../../cad/sketch/canvasConstraints";
import {
  canvasContext,
  commitCanvasConstraintReferences,
  type CanvasSession,
} from "../commands/sketchCanvasCommand";

const PAGE_SIZE = 20;
const MARKER_LIMIT = MAX_CANVAS_LABELS;
export function useCanvasConstraints(
  active: CanvasSession,
  context: ReturnType<typeof canvasContext> | undefined,
  span: number,
  cancelDrawing: () => void,
  view: CanvasLabelView,
  reserved: CanvasLabelBox[],
  focused = false,
  selectedEntityId?: string,
) {
  const [show, setShow] = useState(true),
    [selectedId, setSelectedId] = useState(""),
    [entityIds, setEntityIds] = useState<string[]>([]),
    [pointIds, setPointIds] = useState<string[]>([]),
    [page, setPage] = useState(0),
    [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(!focused);
  useEffect(() => setDetailsOpen(!focused), [focused]);
  const sketch = context?.sketch,
    selected = sketch?.constraints.find((c) => c.id === selectedId);
  const storedReferences = selected
    ? JSON.stringify([selected.entityIds, selected.pointIds ?? []])
    : "";
  useEffect(() => {
    if (!sketch) return;
    if (selectedId && !selected) {
      setSelectedId("");
      setError("Constraint was removed. Select a current constraint.");
    }
    setEntityIds(selected?.entityIds ?? []);
    setPointIds(selected?.pointIds ?? []);
  }, [selectedId, storedReferences, !!selected]);
  const annotations = useMemo(
      () =>
        context
          ? canvasConstraintAnnotations(
              context.sketch,
              context.solved,
              span,
              context.pending,
            )
          : [],
      [context, span],
    ),
    annotation = annotations.find((a) => a.id === selectedId);
  const relevant = useMemo(() => {
    const constraints = new Map(
      context?.sketch.constraints.map((c) => [c.id, c]),
    );
    return annotations.filter(
      (a) =>
        !focused ||
        showAll ||
        a.state !== "satisfied" ||
        a.id === selectedId ||
        constraints.get(a.id)?.entityIds.includes(selectedEntityId ?? ""),
    );
  }, [
    annotations,
    focused,
    showAll,
    selectedId,
    selectedEntityId,
    context?.sketch.constraints,
  ]);
  const anchored = relevant.filter((a) => a.position);
  // Keep stored placements when density filtering hides markers. Only rendered
  // markers receive handlers; the document's import limits bound this ID set.
  const labelDrag = useCanvasLabelDrag(
    context?.document,
    view,
    annotations.filter((a) => a.position).map((a) => a.id),
  );
  const placements = useMemo(
    () =>
      layoutCanvasLabels(
        show
          ? relevant
              .filter((a) => a.position)
              .slice(0, MARKER_LIMIT)
              .map((a) => ({
                id: a.id,
                label: a.label,
                position: a.position!,
                align: "start" as const,
                manualPosition: labelDrag.positions[a.id],
              }))
          : [],
        span / 48,
        view,
        reserved,
        Object.values(context?.solved.points ?? {}),
      ),
    [
      relevant,
      show,
      span,
      view,
      reserved,
      context?.solved,
      labelDrag.positions,
    ],
  );
  const crowded = [...placements.values()].filter((p) => p.crowded).length;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(annotations.length / PAGE_SIZE) - 1),
  );
  const select = (id: string) => {
    cancelDrawing();
    setError(undefined);
    setSelectedId(id);
    setDetailsOpen(true);
  };
  const apply = (remove = false) => {
    if (!context || !selected) return;
    cancelDrawing();
    try {
      commitCanvasConstraintReferences(
        active,
        context.document,
        selected.id,
        remove ? undefined : { entityIds, pointIds },
      );
      if (remove) setSelectedId("");
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const references = (points: boolean) => {
    const ids = points ? pointIds : entityIds,
      set = points ? setPointIds : setEntityIds,
      choices = Object.values(sketch?.entities ?? {}).filter(
        (e) => !points || e.type === "point",
      ),
      label = points ? "point" : "entity";
    return (
      <fieldset>
        <legend>
          {points ? "Ordered point references" : "Ordered entity references"}
        </legend>
        {ids.map((id, i) => (
          <div className="canvas-toolbar" key={i}>
            <label>
              Reference {i + 1}
              <select
                aria-label={`Canvas constraint ${label} ${i + 1}`}
                value={id}
                onChange={(e) =>
                  set(ids.map((ref, j) => (j === i ? e.target.value : ref)))
                }
              >
                <option value="">Select geometry</option>
                {id && !choices.some((e) => e.id === id) ? (
                  <option value={id}>Lost reference — reselect</option>
                ) : null}
                {choices.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.type} ({e.id})
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label={`Remove canvas constraint ${label} reference ${i + 1}`}
              onClick={() => set(ids.filter((_, j) => i !== j))}
            >
              Remove reference
            </button>
          </div>
        ))}
        <button
          onClick={() => set([...ids, ""])}
          disabled={
            entityIds.length + pointIds.length >=
            MAX_CANVAS_CONSTRAINT_REFERENCES
          }
        >
          Add {label} reference
        </button>
      </fieldset>
    );
  };
  const controls = (
    <section
      aria-label="Canvas constraints"
      className="canvas-constraint-controls"
    >
      <h3>Drawing constraints</h3>
      {focused ? (
        <label>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show all constraints
        </label>
      ) : null}
      <details
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
      >
        <summary>Inspect and repair constraints ({annotations.length})</summary>
        <label>
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => {
              labelDrag.cancel();
              setShow(e.target.checked);
            }}
          />{" "}
          Show constraint markers
        </label>
        <p>
          C labels locate referenced geometry, rather than tangency contact
          points. Select a marker or list entry to inspect and repair its
          ordered references. Drag a marker to position its label, or focus it
          and use arrow keys (Shift for larger steps). Home restores automatic
          placement; Escape cancels a drag. Positions last only in this open
          canvas, including while markers are hidden, and never change geometry
          or saved intent. Create constraints in Sketch tools.
        </p>
        <button
          type="button"
          disabled={!Object.keys(labelDrag.positions).length}
          onClick={labelDrag.reset}
        >
          Reset constraint label placement
        </button>
        <ul className="canvas-constraint-list">
          {annotations
            .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
            .map((a) => (
              <li key={a.id}>
                <button
                  aria-label={`Inspect canvas constraint ${a.label}`}
                  onClick={() => select(a.id)}
                >
                  {a.label}
                </button>
              </li>
            ))}
        </ul>
        {annotations.length > PAGE_SIZE ? (
          <div className="canvas-toolbar">
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous constraints
            </button>
            <span>
              Constraints {currentPage * PAGE_SIZE + 1}–
              {Math.min(annotations.length, (currentPage + 1) * PAGE_SIZE)} of{" "}
              {annotations.length}
            </span>
            <button
              disabled={(currentPage + 1) * PAGE_SIZE >= annotations.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next constraints
            </button>
          </div>
        ) : null}
        {anchored.length > MARKER_LIMIT ? (
          <p>
            Canvas shows the first {MARKER_LIMIT} anchored markers. All
            constraints remain available in the list.
          </p>
        ) : null}
        {show && crowded ? (
          <p role="status">
            {crowded} constraint labels remain crowded in this view. Zoom in or
            hide drawing dimensions.
          </p>
        ) : null}
        {selected ? (
          <div aria-label="Selected canvas constraint">
            <p role="status">
              {annotation?.label}: {annotation?.title}
            </p>
            <p>
              Constraint ID: {selected.id}. Type: {selected.type}. Reference
              order matters for symmetry: reflected point, matching point, axis
              start, axis end.
            </p>
            <p>{CONSTRAINT_REFERENCE_HINTS[selected.type]}</p>
            {references(false)}
            {references(true)}
            <button disabled={!context} onClick={() => apply()}>
              Apply constraint references
            </button>
            <button disabled={!context} onClick={() => apply(true)}>
              Delete canvas constraint
            </button>
            <p>
              Applying references preserves the constraint ID and type. Invalid
              or conflicting intent remains repairable with solver diagnostics.
            </p>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </details>
    </section>
  );
  const overlay = show ? (
    <g
      className="canvas-constraints"
      fontSize={span / 48}
      strokeWidth={span / 1100}
    >
      {anchored.slice(0, MARKER_LIMIT).map((a) => {
        const placed = placements.get(a.id);
        if (!placed) return null;
        return (
          <g
            key={a.id}
            data-constraint-id={a.id}
            data-constraint-state={a.state}
            data-layout-crowded={placed.crowded}
            className={`canvas-constraint-marker${selectedId === a.id ? " canvas-constraint-selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Inspect drawing constraint ${a.label}`}
            {...labelDrag.handlers(a.id, placed.position, () => select(a.id))}
          >
            <title>
              {a.title}
              {placed.crowded ? " — label layout remains crowded" : ""}
            </title>
            {a.anchors
              .filter((p) => [p.x, p.y].every(Number.isFinite))
              .map((p, i) => (
                <line
                  key={i}
                  x1={p.x}
                  y1={-p.y}
                  x2={placed.position.x}
                  y2={-placed.position.y}
                />
              ))}
            <rect
              className="canvas-label-focus"
              aria-hidden="true"
              x={placed.box.minX}
              y={-placed.box.maxY}
              width={placed.box.maxX - placed.box.minX}
              height={placed.box.maxY - placed.box.minY}
            />
            <text x={placed.position.x} y={-placed.position.y}>
              {a.label}
            </text>
          </g>
        );
      })}
    </g>
  ) : null;
  return { controls, overlay };
}
