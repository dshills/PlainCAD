import { useCallback, useRef, useState, type PointerEvent } from "react";
import { canvasPointMoveReason } from "../../cad/sketch/canvasPointMove";
import type { CanvasPoint } from "../../cad/sketch/canvasGeometry";
import {
  canvasContext,
  commitCanvasPointMove,
  type CanvasSession,
} from "../commands/sketchCanvasCommand";

type Context = ReturnType<typeof canvasContext>;
export function useCanvasPointDrag(
  active: CanvasSession,
  context: Context | undefined,
  span: number,
  showCoordinates: (point: CanvasPoint) => void,
) {
  const [pointId, setPointId] = useState(""),
    [target, setTarget] = useState<CanvasPoint>(),
    [error, setError] = useState<string>();
  const gesture = useRef<
    | {
        pointerId: number;
        pointId: string;
        document: Context["document"];
        startX: number;
        startY: number;
        element: SVGSVGElement;
      }
    | undefined
  >(undefined);
  const cancel = useCallback(() => {
    const captured = gesture.current;
    gesture.current = undefined;
    if (captured?.element.hasPointerCapture(captured.pointerId))
      captured.element.releasePointerCapture(captured.pointerId);
    setTarget(undefined);
    setError(undefined);
  }, []);
  const select = (id: string) => {
    cancel();
    setPointId(id);
    const point = context?.solved.points[id];
    if (point) showCoordinates(point);
  };
  const begin = (
    event: PointerEvent<SVGSVGElement>,
    point: CanvasPoint | undefined,
  ) => {
    if (event.button !== 0 || !context) return;
    if (!point?.pointId) {
      setError("Click an existing point to move it.");
      return;
    }
    select(point.pointId);
    const reason = canvasPointMoveReason(context.sketch, point.pointId);
    if (reason) {
      setError(reason);
      return;
    }
    event.preventDefault();
    event.currentTarget.focus();
    gesture.current = {
      pointerId: event.pointerId,
      pointId: point.pointId,
      document: context.document,
      startX: event.clientX,
      startY: event.clientY,
      element: event.currentTarget,
    };
    setTarget(point);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (
    event: PointerEvent<SVGSVGElement>,
    point: CanvasPoint | undefined,
  ) => {
    if (gesture.current?.pointerId === event.pointerId && point)
      setTarget(point);
  };
  const finish = (
    event: PointerEvent<SVGSVGElement>,
    point: CanvasPoint | undefined,
  ) => {
    const captured = gesture.current;
    if (!captured || captured.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setTarget(undefined);
    try {
      if (
        Math.hypot(
          event.clientX - captured.startX,
          event.clientY - captured.startY,
        ) < 3
      )
        return;
      if (!point)
        throw new Error(
          "Point move was cancelled because the sketch is unavailable.",
        );
      commitCanvasPointMove(active, captured.document, captured.pointId, point);
      setError(undefined);
      showCoordinates(point);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (captured.element.hasPointerCapture(captured.pointerId))
        captured.element.releasePointerCapture(captured.pointerId);
    }
  };
  const lostCapture = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointerId === event.pointerId) cancel();
  };
  const keyboardMove = (point: CanvasPoint) => {
    if (!context) return;
    try {
      commitCanvasPointMove(active, context.document, pointId, point);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const reason =
    context && pointId
      ? canvasPointMoveReason(context.sketch, pointId)
      : undefined;
  const controls = (
    <label>
      Point to move
      <select
        aria-label="Canvas point to move"
        value={pointId}
        onChange={(e) => select(e.target.value)}
      >
        <option value="">Select point</option>
        {pointId && !context?.solved.points[pointId] ? (
          <option value={pointId}>Lost point — reselect</option>
        ) : null}
        {Object.values(context?.solved.points ?? {}).map((p, i) => (
          <option value={p.id} key={p.id}>
            point {i + 1} ({p.id})
          </option>
        ))}
      </select>
    </label>
  );
  const preview =
    target && context ? (
      <g className="canvas-preview" aria-label="Point move preview">
        {context.solved.lines
          .filter((l) => l.start.id === pointId || l.end.id === pointId)
          .map((l) => {
            const a = l.start.id === pointId ? target : l.start,
              b = l.end.id === pointId ? target : l.end;
            return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        {context.solved.circles
          .filter((c) => c.center.id === pointId)
          .map((c) => (
            <circle key={c.id} cx={target.x} cy={target.y} r={c.radius} />
          ))}
        <circle cx={target.x} cy={target.y} r={span / 150} />
      </g>
    ) : null;
  return {
    controls,
    preview,
    pointId,
    reason,
    error,
    inProgress: !!target,
    begin,
    move,
    finish,
    keyboardMove,
    lostCapture,
    cancel,
  };
}
