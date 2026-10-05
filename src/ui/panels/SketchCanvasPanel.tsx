import { useWorkspaceState } from "../../state/useWorkspaceState";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import {
  sizedCanvasPoints,
  type CanvasSizeInput,
} from "../../cad/sketch/sizedCanvasGeometry";
import { activeComponentId } from "../commands/projectWorkflowCommand";
import { sketchComponentId } from "../../cad/document/components";
import {
  runCommand,
  selectCommandEnablement,
} from "../commands/commandRegistry";
import {
  canvasBoxEntityIds,
  type CanvasSelectionBox,
} from "../../cad/sketch/canvasSelection";
import { planSketchEntitiesDeletion } from "../../cad/sketch/entityDeletion";
import { canvasEntitySize } from "../../cad/sketch/canvasDimensions";
import { useCanvasPointDrag } from "./useCanvasPointDrag";
import { useCanvasDimensions } from "./useCanvasDimensions";
import { useCanvasConstraints } from "./useCanvasConstraints";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useCadStore } from "../../state/useCadStore";
import {
  canvasContext,
  commitCanvasGeometry,
  selectCanvasEntity,
  selectCanvasEntities,
  useSketchCanvas,
  type CanvasSession,
} from "../commands/sketchCanvasCommand";
import {
  arcEndpoint,
  CANVAS_POINT_COUNT,
  distance2d,
  snapCanvasPoint,
  type CanvasPoint,
  type CanvasTool,
} from "../../cad/sketch/canvasGeometry";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import { sketchPlaneLabel } from "../../cad/sketch/planes";

interface CanvasView {
  x: number;
  y: number;
  width: number;
  height: number;
}
const INITIAL_VIEW: CanvasView = { x: -100, y: -75, width: 200, height: 150 };
function fitSketch(solved: ResolvedSketch): CanvasView {
  const points = [
    ...Object.values(solved.points),
    ...[...solved.circles, ...solved.arcs].flatMap((c) => [
      { x: c.center.x - c.radius, y: c.center.y - c.radius },
      { x: c.center.x + c.radius, y: c.center.y + c.radius },
    ]),
  ].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return INITIAL_VIEW;
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  const width = Math.min(
    1e8,
    Math.max(10, (maxX - minX) * 1.3, ((maxY - minY) * 1.3 * 4) / 3),
  );
  return {
    x: (minX + maxX - width) / 2,
    y: (minY + maxY - (width * 3) / 4) / 2,
    width,
    height: (width * 3) / 4,
  };
}
function arcPath(
  center: CanvasPoint,
  start: CanvasPoint,
  end: CanvasPoint,
  clockwise: boolean,
) {
  const radius = distance2d(center, start),
    a = Math.atan2(start.y - center.y, start.x - center.x),
    b = Math.atan2(end.y - center.y, end.x - center.x);
  const sweep = clockwise
    ? (a - b + Math.PI * 2) % (Math.PI * 2)
    : (b - a + Math.PI * 2) % (Math.PI * 2);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} ${clockwise ? 0 : 1} ${end.x} ${end.y}`;
}
type CanvasMode = CanvasTool | "select" | "move" | "translate" | "deform";
const instructions: Record<CanvasMode, string> = {
  select:
    "Click geometry to select it; Shift-click toggles items. Drag left to right to enclose geometry, or right to left to cross it. Shift-drag toggles the box results. Select All or Cmd/Ctrl+A selects the sketch. Delete/Backspace removes the selection in one undo edit. Click a dimension to edit its size.",
  deform:
    "Drag a point to deform a point-and-line sketch through horizontal, vertical and coincident constraints. Fixed/parameter coordinates and supported orthogonal dimensions stay intact. Release validates the solve and profile topology; Escape cancels.",
  translate:
    "Drag a point to translate its connected group. Dimensions and constraints stay intact. Fixed or parameter-bound coordinates block translation. Escape cancels.",
  move: "Drag a free numeric point; release to save one edit. Escape cancels. Parameter-bound, constrained and arc points use geometry/dimension controls.",
  point: "Click to place a point.",
  line: "Click endpoints. Lines continue from the last point; snap to the first point to close a loop.",
  rectangle:
    "Click opposite corners or drag corner to corner. Type width/height to make the draft exact; Tab moves between sizes and Enter accepts.",
  circle:
    "Click the center and radius point, or drag from the center. Type a diameter to make the draft exact.",
  arc: "Click center, start, then end. A free endpoint is projected onto the radius.",
};
export function SketchCanvasPanel() {
  const active = useSketchCanvas((s) => s.active);
  const session = useCadStore((s) => s.documentSession),
    document = useCadStore((s) => s.history.present);
  const component = useCadStore(activeComponentId);
  const current =
    active &&
    active.session === session &&
    active.documentId === document.id &&
    !!document.sketches[active.sketchId] &&
    sketchComponentId(document, active.sketchId) === component;
  useEffect(() => {
    if (active && !current)
      useSketchCanvas.setState({ active: undefined, selection: undefined });
  }, [active, current]);
  return current ? (
    <SketchCanvas
      key={`${active.session}:${active.sketchId}`}
      active={active}
    />
  ) : null;
}
function SketchCanvas({ active }: { active: CanvasSession }) {
  const focused = useWorkspaceState((s) => s.layout === "focused");
  const [sizes, setSizes] = useState<CanvasSizeInput>({});
  const [precisionOpen, setPrecisionOpen] = useState(!focused);
  useEffect(() => setPrecisionOpen(!focused), [focused]);
  const primitiveGesture = useRef<
    | { pointerId: number; x: number; y: number; element: SVGSVGElement }
    | undefined
  >(undefined);
  const releasePrimitiveGesture = useCallback(() => {
    const gesture = primitiveGesture.current;
    primitiveGesture.current = undefined;
    if (gesture?.element.hasPointerCapture(gesture.pointerId))
      gesture.element.releasePointerCapture(gesture.pointerId);
  }, []);
  useEffect(() => releasePrimitiveGesture, [releasePrimitiveGesture]);
  const document = useCadStore((s) => s.history.present),
    fileBusy = useCadStore((s) => s.fileBusy);
  const history = useCadStore((s) => s.history);
  const selection = useSketchCanvas((s) => s.selection);
  const selectedIds = useMemo(
    () => (selection?.document === document ? selection.entityIds : []),
    [selection, document],
  );
  const selectedItemId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const [selectionBox, setSelectionBox] = useState<CanvasSelectionBox>();
  const boxGesture = useRef<
    | {
        pointerId: number;
        start: CanvasPoint;
        clientX: number;
        clientY: number;
        element: SVGSVGElement;
        expected: typeof document;
        toggle: boolean;
      }
    | undefined
  >(undefined);
  const cancelBox = useCallback(() => {
    const gesture = boxGesture.current;
    boxGesture.current = undefined;
    setSelectionBox(undefined);
    if (gesture?.element.hasPointerCapture(gesture.pointerId))
      gesture.element.releasePointerCapture(gesture.pointerId);
  }, []);
  useEffect(() => {
    cancelBox();
  }, [document, fileBusy, cancelBox]);
  useEffect(() => {
    window.addEventListener("blur", cancelBox);
    return () => {
      window.removeEventListener("blur", cancelBox);
      cancelBox();
    };
  }, [cancelBox]);
  const subscribedCanDelete = useCadStore(
    (s) => selectCommandEnablement(s).deleteSketchEntity,
  );
  const canDelete = selectedIds.length > 0 && subscribedCanDelete;
  const canSelectAll = useCadStore(
    (s) => selectCommandEnablement(s).selectAllSketchEntities,
  );
  const rebuild = useCadStore((s) => s.rebuild);
  const analysis = useMemo(() => {
    try {
      return {
        context: canvasContext(active, useCadStore.getState(), true),
        error: undefined,
      };
    } catch (error) {
      return {
        context: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [document, fileBusy, active, rebuild]);
  const context = analysis.context,
    sketch = document.sketches[active.sketchId];
  const deletionPlan = useMemo(
    () =>
      selectedIds.length && selectedIds.every((id) => sketch?.entities[id])
        ? planSketchEntitiesDeletion(sketch, selectedIds, document)
        : undefined,
    [sketch, selectedIds, document],
  );
  useEffect(() => {
    if (selection && selection.document !== document)
      useSketchCanvas.setState({ selection: undefined });
  }, [document, selection]);
  const [tool, setTool] = useState<CanvasMode>("line"),
    [draft, setDraft] = useState<CanvasPoint[]>([]),
    [cursor, setCursor] = useState<CanvasPoint>();
  const draftDocument = useRef(document);
  const svgRef = useRef<SVGSVGElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    const workspace = workspaceRef.current;
    svgRef.current?.focus({ preventScroll: true });
    return () => {
      const activeNow = window.document.activeElement;
      if (
        previous?.isConnected &&
        (activeNow === window.document.body ||
          workspace?.contains(activeNow)) &&
        !window.document.querySelector("dialog[open]")
      )
        previous.focus();
    };
  }, []);
  const [view, setView] = useState(() =>
    context ? fitSketch(context.solved) : INITIAL_VIEW,
  );
  const [snap, setSnap] = useState(true),
    [grid, setGrid] = useState("1"),
    [construction, setConstruction] = useState(false),
    [clockwise, setClockwise] = useState(false),
    [error, setError] = useState<string>();
  const [keyboardX, setKeyboardX] = useState("0"),
    [keyboardY, setKeyboardY] = useState("0");
  const isDragTool =
    tool === "move" || tool === "translate" || tool === "deform";
  const drag = useCanvasPointDrag(
    active,
    context,
    view.width,
    (p) => {
      setKeyboardX(String(p.x));
      setKeyboardY(String(p.y));
    },
    tool === "translate" ? "translate" : tool === "deform" ? "deform" : "move",
  );
  useEffect(() => {
    const fit = () => {
      if (context) {
        cancelBox();
        if (primitiveGesture.current) {
          releasePrimitiveGesture();
          setDraft([]);
          setSizes({});
        }
        drag.cancel();
        setCursor(undefined);
        setView(fitSketch(context.solved));
      }
    };
    window.addEventListener("plaincad:fit-sketch", fit);
    return () => window.removeEventListener("plaincad:fit-sketch", fit);
  }, [context, drag.cancel, releasePrimitiveGesture, cancelBox]);
  useEffect(() => {
    if (draftDocument.current !== document) {
      setDraft([]);
      setSizes({});
      releasePrimitiveGesture();
      setCursor(undefined);
      drag.cancel();
      draftDocument.current = document;
    }
  }, [document, drag.cancel, releasePrimitiveGesture]);
  const close = async () => {
    try {
      await runCommand("sketch.finish");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const cancel = () => {
    cancelBox();
    setDraft([]);
    setCursor(undefined);
    setError(undefined);
    setSizes({});
    releasePrimitiveGesture();
    drag.cancel();
  };
  useEffect(() => {
    const interrupt = () => {
      if (primitiveGesture.current) {
        releasePrimitiveGesture();
        setDraft([]);
        setSizes({});
        setCursor(undefined);
      }
    };
    window.addEventListener("blur", interrupt);
    return () => window.removeEventListener("blur", interrupt);
  }, [releasePrimitiveGesture]);
  const gridStep = Number(grid),
    validGrid =
      Number.isFinite(gridStep) && gridStep >= 0.000001 && gridStep <= 1e6;
  const disabled =
    !context ||
    fileBusy ||
    (snap && !validGrid) ||
    context.solved.errors.some((e) => e.severity === "error");
  const pointAt = (
    event: PointerEvent<SVGSVGElement>,
  ): CanvasPoint | undefined => {
    if (disabled || !context) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = {
      x: view.x + ((event.clientX - rect.left) / rect.width) * view.width,
      y: view.y + (1 - (event.clientY - rect.top) / rect.height) * view.height,
    };
    let result = snapCanvasPoint(
      point,
      isDragTool && drag.inProgress
        ? {
            ...context.solved,
            points: Object.fromEntries(
              Object.entries(context.solved.points).filter(
                ([id]) => !drag.movingPointIds.has(id),
              ),
            ),
          }
        : context.solved,
      (view.width / rect.width) * 8,
      snap ? gridStep : 0,
    );
    if (tool === "arc" && draft.length === 2)
      result = arcEndpoint(draft[0], draft[1], result);
    return result;
  };
  const selectionPointAt = (
    event: PointerEvent<SVGSVGElement>,
  ): CanvasPoint | undefined => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    return {
      x: view.x + ((event.clientX - rect.left) / rect.width) * view.width,
      y: view.y + (1 - (event.clientY - rect.top) / rect.height) * view.height,
    };
  };
  const draw = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || primitiveGesture.current || boxGesture.current)
      return;
    if (tool === "select") {
      if (fileBusy) return;
      if (
        (event.target as Element).closest(
          ".canvas-dimensions, .canvas-constraints, .canvas-inline-dimension",
        )
      )
        return;
      event.preventDefault();
      const id = (event.target as Element).closest(
        "[data-entity-id], [data-point-id], [data-hit-entity-id]",
      );
      const entityId =
        id?.getAttribute("data-entity-id") ??
        id?.getAttribute("data-point-id") ??
        id?.getAttribute("data-hit-entity-id") ??
        undefined;
      if (entityId) chooseItem(entityId, event.shiftKey);
      else {
        const point = selectionPointAt(event);
        if (!point) return;
        cancel();
        dimensions.clearSelection();
        if (!event.shiftKey) chooseItem();
        boxGesture.current = {
          pointerId: event.pointerId,
          start: point,
          clientX: event.clientX,
          clientY: event.clientY,
          element: event.currentTarget,
          expected: document,
          toggle: event.shiftKey,
        };
        setSelectionBox({ start: point, end: point });
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    const point = pointAt(event);
    if (isDragTool) {
      if (!disabled) drag.begin(event, point);
      return;
    }
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    if ((tool === "rectangle" || tool === "circle") && !draft.length) {
      primitiveGesture.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element: event.currentTarget,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    place(point);
  };
  const place = (point: CanvasPoint) => {
    if (disabled || tool === "select") return;
    if (isDragTool) {
      drag.keyboardMove(point);
      return;
    }
    const points = [...draft, point];
    if (points.length < CANVAS_POINT_COUNT[tool]) {
      draftDocument.current = document;
      setDraft(points);
      setError(undefined);
      return;
    }
    try {
      const result = commitCanvasGeometry(
        active,
        draftDocument.current,
        tool,
        points,
        construction,
        clockwise,
        sizes,
      );
      draftDocument.current = useCadStore.getState().history.present;
      setDraft(tool === "line" && result.endpoint ? [result.endpoint] : []);
      setSizes({});
      setCursor(undefined);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const zoom = (factor: number) => {
    cancelBox();
    if (primitiveGesture.current) cancel();
    drag.cancel();
    setCursor(undefined);
    setError(undefined);
    const width = Math.min(1e8, Math.max(0.002, view.width * factor));
    setView({
      x: view.x + (view.width - width) / 2,
      y: view.y + (view.height - (width * 3) / 4) / 2,
      width,
      height: (width * 3) / 4,
    });
  };
  const pan = (x: number, y: number) => {
    cancelBox();
    if (primitiveGesture.current) cancel();
    drag.cancel();
    setCursor(undefined);
    setError(undefined);
    setView({
      ...view,
      x: Math.max(-1e8, Math.min(1e8, view.x + x * view.width)),
      y: Math.max(-1e8, Math.min(1e8, view.y + y * view.height)),
    });
  };
  const displayGrid = Math.max(
    validGrid ? gridStep : 1,
    10 ** Math.ceil(Math.log10(view.width / 60)),
  );
  const gridLines = (axis: "x" | "y") => {
    const start = view[axis],
      length = axis === "x" ? view.width : view.height;
    return Array.from(
      { length: Math.min(64, Math.ceil(length / displayGrid) + 1) },
      (_, i) => Math.ceil(start / displayGrid) * displayGrid + i * displayGrid,
    );
  };
  const parameters = useMemo(
    () => evaluateParameters(document.parameters).values,
    [document.parameters],
  );
  const previewAnalysis = useMemo(() => {
    const rawPreview = draft.length && cursor ? [...draft, cursor] : draft;
    if (!context || tool === "select" || isDragTool)
      return { points: rawPreview };
    try {
      return {
        points: sizedCanvasPoints(
          tool,
          rawPreview,
          sizes,
          parameters,
          document.unitSettings.length,
        ),
      };
    } catch (e) {
      return {
        points: rawPreview,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [
    context,
    tool,
    draft,
    cursor,
    sizes,
    parameters,
    document.unitSettings.length,
    isDragTool,
  ]);
  const preview = previewAnalysis.points;
  const radius = view.width * 0.005;
  const dimensions = useCanvasDimensions(
    active,
    context,
    view.width,
    cancel,
    view,
    focused,
    tool === "select",
    () => useSketchCanvas.setState({ selection: undefined }),
  );
  const chooseItem = (id?: string, toggle = false) => {
    cancel();
    if (id && !toggle) dimensions.selectEntity(id);
    else dimensions.clearSelection();
    dimensions.closeInlineEditor();
    try {
      selectCanvasEntities(active, document, id ? [id] : [], toggle);
      svgRef.current?.focus({ preventScroll: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const deleteItem = async () => {
    cancel();
    dimensions.clearSelection();
    try {
      await runCommand("sketch.entity.delete");
      svgRef.current?.focus({ preventScroll: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const selectAll = async () => {
    cancelBox();
    cancel();
    dimensions.clearSelection();
    try {
      await runCommand("sketch.entity.selectAll");
      svgRef.current?.focus({ preventScroll: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const highlightedEntityId = selectedItemId ?? dimensions.selectedEntityId;
  const highlightedIds = useMemo(
    () =>
      new Set(
        selectedIds.length
          ? selectedIds
          : highlightedEntityId
            ? [highlightedEntityId]
            : [],
      ),
    [selectedIds, highlightedEntityId],
  );
  const constraints = useCanvasConstraints(
    active,
    context,
    view.width,
    cancel,
    view,
    dimensions.labelBoxes,
    focused,
    highlightedEntityId,
  );
  if (!sketch) return null;
  return (
    <section
      ref={workspaceRef}
      aria-label="Sketch canvas"
      className="sketch-workspace"
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        const target = event.target as HTMLElement;
        if (
          tool === "select" &&
          event.key.toLowerCase() === "a" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          !event.repeat &&
          event.target === svgRef.current &&
          !fileBusy &&
          canSelectAll
        ) {
          event.preventDefault();
          event.stopPropagation();
          void selectAll();
          return;
        }
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          !event.repeat &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          !["SELECT", "INPUT", "TEXTAREA"].includes(target.tagName) &&
          !target.isContentEditable &&
          canDelete
        ) {
          event.preventDefault();
          event.stopPropagation();
          void deleteItem();
        }
        if (
          event.key === "Escape" &&
          !["SELECT", "INPUT", "TEXTAREA"].includes(target.tagName) &&
          !target.isContentEditable
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (boxGesture.current) cancelBox();
          else if (draft.length || drag.inProgress) cancel();
          else void close();
        }
        if (
          !event.repeat &&
          event.key.toLowerCase() === "f" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
          !target.isContentEditable &&
          context
        ) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new Event("plaincad:fit-sketch"));
        }
      }}
    >
      <header className="sketch-workspace-header">
        <div>
          <strong>Sketch mode</strong>
          <h2>
            {sketch.name} — {sketchPlaneLabel(sketch.plane)}
          </h2>
        </div>
        <button className="finish-sketch" onClick={close}>
          Finish Sketch
        </button>
      </header>
      <div
        className="sketch-direct-tools"
        role="toolbar"
        aria-label="Drawing tools"
      >
        {(["select", "line", "rectangle", "circle", "arc"] as const).map(
          (kind) => (
            <button
              key={kind}
              type="button"
              aria-label={`Draw tool: ${kind}`}
              aria-pressed={tool === kind}
              onClick={() => {
                cancel();
                dimensions.closeInlineEditor();
                cancelBox();
                useSketchCanvas.setState({ selection: undefined });
                setTool(kind);
              }}
            >
              {kind[0].toUpperCase() + kind.slice(1)}
            </button>
          ),
        )}
        <label>
          <input
            type="checkbox"
            checked={construction}
            onChange={(e) => {
              cancel();
              setConstruction(e.target.checked);
            }}
          />
          Construction
        </label>
        <label>
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => {
              cancel();
              setSnap(e.target.checked);
            }}
          />
          Snap
        </label>
      </div>
      {tool === "select" ? (
        <div
          className="canvas-toolbar sketch-item-tools"
          aria-label="Sketch item selection"
        >
          <label>
            Sketch item
            <select
              aria-label="Selected sketch item"
              value={selectedItemId ?? ""}
              disabled={fileBusy}
              onChange={(event) => {
                setTool("select");
                chooseItem(event.target.value || undefined);
              }}
            >
              <option value="">Select geometry to delete</option>
              {Object.values(sketch.entities).map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.construction ? "Construction " : ""}
                  {entity.type} · {entity.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!canSelectAll}
            onClick={() => void selectAll()}
          >
            Select all sketch geometry
          </button>
          <span role="status" aria-label="Sketch selection count">
            {selectedIds.length} selected
          </span>
          <button
            type="button"
            disabled={!canDelete}
            onClick={() => void deleteItem()}
          >
            Delete selected sketch item
          </button>
          <button
            type="button"
            disabled={
              !selectedItemId ||
              !context ||
              !canvasEntitySize(context.solved, selectedItemId)
            }
            onClick={() => {
              try {
                if (selectedItemId) {
                  dimensions.selectEntity(selectedItemId);
                  selectCanvasEntity(active, document, selectedItemId);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Edit selected size
          </button>
          <span role="status" style={{ flexBasis: "100%", minHeight: "1.5em" }}>
            {deletionPlan ? (
              <>
                Removes {deletionPlan.entityIds.size} geometry item(s),{" "}
                {deletionPlan.dimensionIds.size} dimension(s),{" "}
                {deletionPlan.constraintIds.size} constraint(s). Undo restores
                them.
              </>
            ) : (
              "Select geometry to see what deletion will remove."
            )}
          </span>
        </div>
      ) : null}
      <div className="sketch-workspace-layout">
        <div
          className="sketch-workspace-controls"
          role="toolbar"
          aria-label="Sketch drawing controls"
        >
          <h3>Sketch details</h3>
          <p role="status">
            {context?.solved.status ?? "unavailable"} ·{" "}
            {context?.solved.degreesOfFreedom ?? "—"} degrees of freedom
          </p>
          <p id="canvas-instructions">{instructions[tool]}</p>
          <details
            open={precisionOpen}
            onToggle={(e) => setPrecisionOpen(e.currentTarget.open)}
          >
            <summary>Precision and advanced tools</summary>
            <p>
              Local X points right; local Y points up. Coordinates and snapping
              are in millimeters.
            </p>
            <div className="canvas-toolbar">
              <label>
                Canvas tool{" "}
                <select
                  aria-label="Canvas tool"
                  value={tool}
                  onChange={(e) => {
                    cancel();
                    dimensions.closeInlineEditor();
                    useSketchCanvas.setState({ selection: undefined });
                    setTool(e.target.value as CanvasMode);
                  }}
                >
                  {Object.keys(instructions).map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={construction}
                  onChange={(e) => {
                    cancel();
                    setConstruction(e.target.checked);
                  }}
                />
                Canvas construction geometry
              </label>
              {tool === "arc" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={clockwise}
                    onChange={(e) => {
                      cancel();
                      setClockwise(e.target.checked);
                    }}
                  />
                  Canvas clockwise arc
                </label>
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(e) => {
                    cancel();
                    setSnap(e.target.checked);
                  }}
                />
                Snap to grid
              </label>
              <label>
                Grid step (mm)
                <input
                  aria-label="Canvas grid step"
                  type="number"
                  min="0.000001"
                  max="1000000"
                  value={grid}
                  onChange={(e) => {
                    cancel();
                    setGrid(e.target.value);
                  }}
                />
              </label>
            </div>
            <div className="canvas-toolbar">
              <button onClick={() => zoom(0.5)}>Zoom in</button>
              <button onClick={() => zoom(2)}>Zoom out</button>
              <button
                disabled={!context}
                onClick={() => {
                  cancelBox();
                  if (primitiveGesture.current) cancel();
                  drag.cancel();
                  setCursor(undefined);
                  if (context) setView(fitSketch(context.solved));
                }}
              >
                Fit sketch
              </button>
              <button
                aria-label="Pan canvas left"
                onClick={() => pan(-0.25, 0)}
              >
                ←
              </button>
              <button
                aria-label="Pan canvas right"
                onClick={() => pan(0.25, 0)}
              >
                →
              </button>
              <button aria-label="Pan canvas up" onClick={() => pan(0, 0.25)}>
                ↑
              </button>
              <button
                aria-label="Pan canvas down"
                onClick={() => pan(0, -0.25)}
              >
                ↓
              </button>
              <button
                disabled={!history.past.length || fileBusy}
                onClick={() => {
                  cancel();
                  useCadStore.getState().undo();
                }}
              >
                Undo canvas edit
              </button>
              <button
                disabled={!history.future.length || fileBusy}
                onClick={() => {
                  cancel();
                  useCadStore.getState().redo();
                }}
              >
                Redo canvas edit
              </button>
              <button
                disabled={!draft.length && !drag.inProgress}
                onClick={cancel}
              >
                Cancel drawing
              </button>
            </div>
            <div className="canvas-toolbar">
              {isDragTool ? drag.controls : null}
              <label>
                Local X (mm)
                <input
                  aria-label="Canvas coordinate X"
                  type="number"
                  value={keyboardX}
                  onChange={(e) => setKeyboardX(e.target.value)}
                />
              </label>
              <label>
                Local Y (mm)
                <input
                  aria-label="Canvas coordinate Y"
                  type="number"
                  value={keyboardY}
                  onChange={(e) => setKeyboardY(e.target.value)}
                />
              </label>
              <button
                disabled={
                  disabled ||
                  tool === "select" ||
                  (isDragTool && (!drag.pointId || !!drag.reason)) ||
                  keyboardX.trim() === "" ||
                  keyboardY.trim() === "" ||
                  !Number.isFinite(Number(keyboardX)) ||
                  !Number.isFinite(Number(keyboardY))
                }
                onClick={() => {
                  if (!context) return;
                  let point = snapCanvasPoint(
                    { x: Number(keyboardX), y: Number(keyboardY) },
                    context.solved,
                    1e-8,
                    0,
                  );
                  if (tool === "arc" && draft.length === 2)
                    point = arcEndpoint(draft[0], draft[1], point);
                  place(point);
                }}
              >
                {tool === "translate"
                  ? "Translate group to coordinate"
                  : tool === "deform"
                    ? "Deform sketch to coordinate"
                    : tool === "move"
                      ? "Move point to coordinate"
                      : "Place coordinate"}
              </button>
            </div>
          </details>
          {dimensions.controls}
          {constraints.controls}
          <details open={!focused}>
            <summary>Drawing help</summary>
            <p>
              Existing points snap within 8 screen pixels. Keyboard users can
              place exact coordinates using the fields above. Escape cancels a
              draft, then closes.
            </p>
          </details>
          {analysis.error ||
          error ||
          (isDragTool && (drag.error || drag.reason)) ||
          (snap && !validGrid) ? (
            <p role="alert">
              {analysis.error ??
                error ??
                (tool === "move" || tool === "translate" || tool === "deform"
                  ? (drag.error ?? drag.reason)
                  : undefined) ??
                "Grid step must be between 0.000001 and 1,000,000 mm."}
            </p>
          ) : null}
        </div>
        <div className="sketch-workspace-drawing">
          {draft.length === 1 && (tool === "rectangle" || tool === "circle") ? (
            <form
              className="canvas-draft-size"
              aria-label="Draft shape size"
              style={{
                left: `min(${Math.max(2, Math.min(45, ((draft[0].x - view.x) / view.width) * 100 + 4))}%, max(2%, calc(100% - 370px)))`,
                top: `min(${Math.max(2, Math.min(65, ((view.y + view.height - draft[0].y) / view.height) * 100 + 4))}%, max(2%, calc(100% - 220px)))`,
              }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!previewAnalysis.error)
                  place(cursor ?? { x: draft[0].x + 1, y: draft[0].y + 1 });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                  svgRef.current?.focus({ preventScroll: true });
                }
              }}
            >
              <strong>
                {tool === "rectangle" ? "Rectangle size" : "Circle diameter"}
              </strong>
              {(tool === "rectangle"
                ? (["width", "height"] as const)
                : (["diameter"] as const)
              ).map((name) => (
                <label key={name}>
                  {name} ({document.unitSettings.length})
                  <input
                    aria-label={`Draft ${name}`}
                    value={sizes[name] ?? ""}
                    placeholder="Pointer size"
                    maxLength={2000}
                    onChange={(e) =>
                      setSizes((s) => ({ ...s, [name]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <span>
                {preview.length === 2
                  ? tool === "rectangle"
                    ? `${Math.abs(preview[1].x - preview[0].x).toFixed(3)} × ${Math.abs(preview[1].y - preview[0].y).toFixed(3)} mm`
                    : `Ø ${(distance2d(preview[0], preview[1]) * 2).toFixed(3)} mm`
                  : "Move the pointer or enter sizes."}
              </span>
              <button
                type="submit"
                disabled={
                  disabled ||
                  Boolean(previewAnalysis.error) ||
                  (!cursor &&
                    (tool === "rectangle"
                      ? !sizes.width?.trim() || !sizes.height?.trim()
                      : !sizes.diameter?.trim()))
                }
              >
                Accept shape
              </button>
              <button type="button" onClick={cancel}>
                Cancel shape
              </button>
              {previewAnalysis.error ? (
                <p role="alert">{previewAnalysis.error}</p>
              ) : null}
            </form>
          ) : null}
          {dimensions.inlineEditor}
          <svg
            ref={svgRef}
            className="sketch-canvas"
            aria-label="Sketch drawing canvas"
            aria-describedby="canvas-instructions"
            aria-disabled={tool === "select" ? fileBusy : disabled}
            tabIndex={0}
            role="group"
            viewBox={`${view.x} ${-view.y - view.height} ${view.width} ${view.height}`}
            preserveAspectRatio="none"
            onPointerDown={draw}
            onPointerMove={(event) => {
              if (boxGesture.current) {
                if (boxGesture.current.pointerId === event.pointerId) {
                  const point = selectionPointAt(event);
                  if (point)
                    setSelectionBox({
                      start: boxGesture.current.start,
                      end: point,
                    });
                }
                return;
              }
              if (
                primitiveGesture.current &&
                primitiveGesture.current.pointerId !== event.pointerId
              )
                return;
              const point = pointAt(event);
              setCursor(point);
              if (isDragTool) drag.move(event, point);
            }}
            onPointerUp={(event) => {
              const box = boxGesture.current;
              if (box?.pointerId === event.pointerId) {
                const end = selectionPointAt(event);
                cancelBox();
                if (
                  end &&
                  context &&
                  Math.hypot(
                    event.clientX - box.clientX,
                    event.clientY - box.clientY,
                  ) >= 6
                ) {
                  try {
                    selectCanvasEntities(
                      active,
                      box.expected,
                      canvasBoxEntityIds(context.solved, {
                        start: box.start,
                        end,
                      }),
                      box.toggle,
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }
                return;
              }
              if (isDragTool) drag.finish(event, pointAt(event));
              const gesture = primitiveGesture.current;
              if (gesture?.pointerId === event.pointerId) {
                primitiveGesture.current = undefined;
                if (
                  Math.hypot(
                    event.clientX - gesture.x,
                    event.clientY - gesture.y,
                  ) >= 6
                ) {
                  const point = pointAt(event);
                  if (point) place(point);
                }
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (boxGesture.current?.pointerId === event.pointerId)
                cancelBox();
              if (primitiveGesture.current?.pointerId === event.pointerId)
                cancel();
              else if (!primitiveGesture.current) drag.cancel();
            }}
            onLostPointerCapture={(event) => {
              if (boxGesture.current?.pointerId === event.pointerId)
                cancelBox();
              if (primitiveGesture.current?.pointerId === event.pointerId)
                cancel();
              drag.lostCapture(event);
            }}
            onPointerLeave={() => {
              if (!draft.length) setCursor(undefined);
            }}
          >
            <g
              transform="scale(1,-1)"
              fill="none"
              strokeWidth={view.width / 700}
            >
              <g className="canvas-grid">
                {gridLines("x").map((x) => (
                  <line
                    key={`x${x}`}
                    x1={x}
                    x2={x}
                    y1={view.y}
                    y2={view.y + view.height}
                  />
                ))}
                {gridLines("y").map((y) => (
                  <line
                    key={`y${y}`}
                    y1={y}
                    y2={y}
                    x1={view.x}
                    x2={view.x + view.width}
                  />
                ))}
              </g>
              <g className="canvas-axes">
                <line x1={view.x} x2={view.x + view.width} y1={0} y2={0} />
                <line x1={0} x2={0} y1={view.y} y2={view.y + view.height} />
              </g>
              {context?.solved.lines.map((l) => (
                <line
                  key={l.id}
                  data-entity-id={l.id}
                  className={
                    (l.construction
                      ? "canvas-construction"
                      : "canvas-geometry") +
                    (highlightedIds.has(l.id) ? " canvas-entity-selected" : "")
                  }
                  x1={l.start.x}
                  y1={l.start.y}
                  x2={l.end.x}
                  y2={l.end.y}
                />
              ))}
              {context?.solved.circles.map((c) => (
                <circle
                  key={c.id}
                  data-entity-id={c.id}
                  className={
                    (c.construction
                      ? "canvas-construction"
                      : "canvas-geometry") +
                    (highlightedIds.has(c.id) ? " canvas-entity-selected" : "")
                  }
                  cx={c.center.x}
                  cy={c.center.y}
                  r={c.radius}
                />
              ))}
              {context?.solved.arcs.map((a) => (
                <path
                  key={a.id}
                  data-entity-id={a.id}
                  className={
                    (a.construction
                      ? "canvas-construction"
                      : "canvas-geometry") +
                    (highlightedIds.has(a.id) ? " canvas-entity-selected" : "")
                  }
                  d={arcPath(a.center, a.start, a.end, a.sweep < 0)}
                />
              ))}
              {tool === "select" ? (
                <g
                  fill="none"
                  stroke="transparent"
                  strokeWidth={view.width / 60}
                >
                  {context?.solved.lines.map((l) => (
                    <line
                      key={l.id}
                      data-hit-entity-id={l.id}
                      x1={l.start.x}
                      y1={l.start.y}
                      x2={l.end.x}
                      y2={l.end.y}
                    />
                  ))}
                  {context?.solved.circles.map((c) => (
                    <circle
                      key={c.id}
                      data-hit-entity-id={c.id}
                      cx={c.center.x}
                      cy={c.center.y}
                      r={c.radius}
                    />
                  ))}
                  {context?.solved.arcs.map((a) => (
                    <path
                      key={a.id}
                      data-hit-entity-id={a.id}
                      d={arcPath(a.center, a.start, a.end, a.sweep < 0)}
                    />
                  ))}
                </g>
              ) : null}
              {tool === "select"
                ? Object.values(context?.solved.points ?? {}).map((p) => (
                    <circle
                      key={`hit:${p.id}`}
                      data-hit-entity-id={p.id}
                      fill="transparent"
                      stroke="none"
                      cx={p.x}
                      cy={p.y}
                      r={view.width / 80}
                    />
                  ))
                : null}
              {Object.values(context?.solved.points ?? {}).map((p) => (
                <circle
                  key={p.id}
                  data-point-id={p.id}
                  className={`canvas-point${highlightedIds.has(p.id) ? " canvas-entity-selected" : ""}`}
                  cx={p.x}
                  cy={p.y}
                  r={radius}
                />
              ))}
              {selectionBox ? (
                <rect
                  data-selection-box={
                    selectionBox.end.x < selectionBox.start.x
                      ? "crossing"
                      : "window"
                  }
                  pointerEvents="none"
                  x={Math.min(selectionBox.start.x, selectionBox.end.x)}
                  y={Math.min(selectionBox.start.y, selectionBox.end.y)}
                  width={Math.abs(selectionBox.end.x - selectionBox.start.x)}
                  height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
                  fill="var(--accent, #39bde7)"
                  fillOpacity={0.12}
                  stroke="var(--accent, #39bde7)"
                  strokeDasharray={
                    selectionBox.end.x < selectionBox.start.x
                      ? `${view.width / 100} ${view.width / 200}`
                      : undefined
                  }
                />
              ) : null}
              {drag.preview}
              <g className="canvas-preview">
                {preview.length > 1 && tool === "line" ? (
                  <line
                    x1={preview[0].x}
                    y1={preview[0].y}
                    x2={preview[1].x}
                    y2={preview[1].y}
                  />
                ) : null}
                {preview.length > 1 && tool === "rectangle" ? (
                  <rect
                    x={Math.min(preview[0].x, preview[1].x)}
                    y={Math.min(preview[0].y, preview[1].y)}
                    width={Math.abs(preview[1].x - preview[0].x)}
                    height={Math.abs(preview[1].y - preview[0].y)}
                  />
                ) : null}
                {preview.length > 1 && (tool === "circle" || tool === "arc") ? (
                  <circle
                    cx={preview[0].x}
                    cy={preview[0].y}
                    r={distance2d(preview[0], preview[1])}
                  />
                ) : null}
                {preview.length === 3 && tool === "arc" ? (
                  <path
                    d={arcPath(preview[0], preview[1], preview[2], clockwise)}
                  />
                ) : null}
                {preview.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={radius} />
                ))}
                {cursor ? (
                  <circle cx={cursor.x} cy={cursor.y} r={radius * 1.5} />
                ) : null}
              </g>
            </g>
            {dimensions.overlay}
            {constraints.overlay}
          </svg>
          <p role="status">
            {cursor
              ? `X ${cursor.x.toFixed(3)} mm, Y ${cursor.y.toFixed(3)} mm${cursor.pointId ? " — existing point" : ""}. `
              : ""}
            {drag.inProgress
              ? `${tool === "translate" ? "Group translation" : tool === "deform" ? "Sketch deformation" : "Point move"} preview; release to save, Escape to cancel. `
              : ""}
            {draft.length
              ? `${draft.length} draft point${draft.length === 1 ? "" : "s"}; nothing incomplete is saved.`
              : "Ready to draw."}
          </p>
          <p>
            Use Precision for coordinates and Dimension tools for expressions.
            The 3D viewer uses this sketch’s resolved plane.
          </p>
        </div>
      </div>
    </section>
  );
}
