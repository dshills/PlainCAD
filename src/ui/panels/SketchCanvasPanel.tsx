import { useCanvasPointDrag } from "./useCanvasPointDrag";
import { useCanvasDimensions } from "./useCanvasDimensions";
import { useCanvasConstraints } from "./useCanvasConstraints";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import {
  canvasContext,
  commitCanvasGeometry,
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
type CanvasMode = CanvasTool | "move" | "translate";
const instructions: Record<CanvasMode, string> = {
  translate:
    "Drag a point to translate its connected group. Dimensions and constraints stay intact. Fixed or parameter-bound coordinates block translation. Escape cancels.",
  move: "Drag a free numeric point; release to save one edit. Escape cancels. Parameter-bound, constrained and arc points use geometry/dimension controls.",
  point: "Click to place a point.",
  line: "Click endpoints. Lines continue from the last point; snap to the first point to close a loop.",
  rectangle: "Click two opposite corners.",
  circle: "Click the center, then a radius point.",
  arc: "Click center, start, then end. A free endpoint is projected onto the radius.",
};
export function SketchCanvasPanel() {
  const active = useSketchCanvas((s) => s.active);
  const session = useCadStore((s) => s.documentSession),
    document = useCadStore((s) => s.history.present);
  const current =
    active &&
    active.session === session &&
    active.documentId === document.id &&
    !!document.sketches[active.sketchId];
  useEffect(() => {
    if (active && !current) useSketchCanvas.setState({ active: undefined });
  }, [active, current]);
  return current ? (
    <SketchCanvas
      key={`${active.session}:${active.sketchId}`}
      active={active}
    />
  ) : null;
}
function SketchCanvas({ active }: { active: CanvasSession }) {
  const document = useCadStore((s) => s.history.present),
    fileBusy = useCadStore((s) => s.fileBusy);
  const history = useCadStore((s) => s.history);
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
  const [tool, setTool] = useState<CanvasMode>("line"),
    [draft, setDraft] = useState<CanvasPoint[]>([]),
    [cursor, setCursor] = useState<CanvasPoint>();
  const draftDocument = useRef(document);
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
  const drag = useCanvasPointDrag(
    active,
    context,
    view.width,
    (p) => {
      setKeyboardX(String(p.x));
      setKeyboardY(String(p.y));
    },
    tool === "translate",
  );
  useEffect(() => {
    if (draftDocument.current !== document) {
      setDraft([]);
      setCursor(undefined);
      drag.cancel();
      draftDocument.current = document;
    }
  }, [document, drag.cancel]);
  const close = () => useSketchCanvas.setState({ active: undefined });
  const cancel = () => {
    setDraft([]);
    setCursor(undefined);
    setError(undefined);
    drag.cancel();
  };
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
      (tool === "move" || tool === "translate") && drag.inProgress
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
  const draw = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = pointAt(event);
    if (tool === "move" || tool === "translate") {
      if (!disabled) drag.begin(event, point);
      return;
    }
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus();
    place(point);
  };
  const place = (point: CanvasPoint) => {
    if (disabled) return;
    if (tool === "move" || tool === "translate") {
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
      );
      draftDocument.current = useCadStore.getState().history.present;
      setDraft(tool === "line" && result.endpoint ? [result.endpoint] : []);
      setCursor(undefined);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const zoom = (factor: number) => {
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
  const preview = draft.length && cursor ? [...draft, cursor] : draft;
  const radius = view.width * 0.005;
  const dimensions = useCanvasDimensions(active, context, view.width, cancel);
  const constraints = useCanvasConstraints(active, context, view.width, cancel);
  if (!sketch) return null;
  return (
    <ModalDialog
      label="Sketch canvas"
      className="file-dialog sketch-canvas-dialog"
      onDismiss={() => (draft.length || drag.inProgress ? cancel() : close())}
    >
      <h2>
        {sketch.name} — {sketchPlaneLabel(sketch.plane)} canvas
      </h2>
      <p>
        Local X points right; local Y points up. Coordinates and snapping are in
        millimeters.
      </p>
      <div className="canvas-toolbar">
        <label>
          Canvas tool{" "}
          <select
            aria-label="Canvas tool"
            value={tool}
            onChange={(e) => {
              cancel();
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
            drag.cancel();
            setCursor(undefined);
            if (context) setView(fitSketch(context.solved));
          }}
        >
          Fit sketch
        </button>
        <button aria-label="Pan canvas left" onClick={() => pan(-0.25, 0)}>
          ←
        </button>
        <button aria-label="Pan canvas right" onClick={() => pan(0.25, 0)}>
          →
        </button>
        <button aria-label="Pan canvas up" onClick={() => pan(0, 0.25)}>
          ↑
        </button>
        <button aria-label="Pan canvas down" onClick={() => pan(0, -0.25)}>
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
        <button disabled={!draft.length && !drag.inProgress} onClick={cancel}>
          Cancel drawing
        </button>
      </div>
      <div className="canvas-toolbar">
        {tool === "move" || tool === "translate" ? drag.controls : null}
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
            ((tool === "move" || tool === "translate") &&
              (!drag.pointId || !!drag.reason)) ||
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
            : tool === "move"
              ? "Move point to coordinate"
              : "Place coordinate"}
        </button>
      </div>
      {dimensions.controls}
      {constraints.controls}
      <p id="canvas-instructions">
        {instructions[tool]} Existing points snap within 8 screen pixels.
        Keyboard users can place exact coordinates using the fields above.
        Escape cancels a draft, then closes.
      </p>
      {analysis.error ||
      error ||
      ((tool === "move" || tool === "translate") &&
        (drag.error || drag.reason)) ||
      (snap && !validGrid) ? (
        <p role="alert">
          {analysis.error ??
            error ??
            (tool === "move" || tool === "translate"
              ? (drag.error ?? drag.reason)
              : undefined) ??
            "Grid step must be between 0.000001 and 1,000,000 mm."}
        </p>
      ) : null}
      <svg
        className="sketch-canvas"
        aria-label="Sketch drawing canvas"
        aria-describedby="canvas-instructions"
        aria-disabled={disabled}
        tabIndex={0}
        role="group"
        viewBox={`${view.x} ${-view.y - view.height} ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        onPointerDown={draw}
        onPointerMove={(event) => {
          const point = pointAt(event);
          setCursor(point);
          if (tool === "move" || tool === "translate") drag.move(event, point);
        }}
        onPointerUp={(event) => {
          if (tool === "move" || tool === "translate")
            drag.finish(event, pointAt(event));
        }}
        onPointerCancel={() => drag.cancel()}
        onLostPointerCapture={drag.lostCapture}
        onPointerLeave={() => setCursor(undefined)}
      >
        <g transform="scale(1,-1)" fill="none" strokeWidth={view.width / 700}>
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
              className={
                l.construction ? "canvas-construction" : "canvas-geometry"
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
              className={
                c.construction ? "canvas-construction" : "canvas-geometry"
              }
              cx={c.center.x}
              cy={c.center.y}
              r={c.radius}
            />
          ))}
          {context?.solved.arcs.map((a) => (
            <path
              key={a.id}
              className={
                a.construction ? "canvas-construction" : "canvas-geometry"
              }
              d={arcPath(a.center, a.start, a.end, a.sweep < 0)}
            />
          ))}
          {Object.values(context?.solved.points ?? {}).map((p) => (
            <circle
              key={p.id}
              data-point-id={p.id}
              className="canvas-point"
              cx={p.x}
              cy={p.y}
              r={radius}
            />
          ))}
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
          ? `${tool === "translate" ? "Group translation" : "Point move"} preview; release to save, Escape to cancel. `
          : ""}
        {draft.length
          ? `${draft.length} draft point${draft.length === 1 ? "" : "s"}; nothing incomplete is saved.`
          : "Ready to draw."}
      </p>
      <p>
        Use Sketch tools for exact coordinate expressions and driving
        dimensions. The 3D viewer uses this sketch’s resolved plane.
      </p>
      <button onClick={close}>Done editing sketch</button>
    </ModalDialog>
  );
}
