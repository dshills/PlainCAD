import {
  canvasDeformationPlan,
  deformedCanvasSketch,
} from "../../cad/sketch/canvasDeformation";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { canvasPointMoveReason } from "../../cad/sketch/canvasPointMove";
import {
  canvasTranslationGroup,
  type CanvasTranslationGroup,
} from "../../cad/sketch/canvasTranslation";
import type { CanvasPoint } from "../../cad/sketch/canvasGeometry";
import {
  canvasContext,
  commitCanvasPointMove,
  commitCanvasDeformation,
  commitCanvasTranslation,
  type CanvasSession,
} from "../commands/sketchCanvasCommand";

type Context = ReturnType<typeof canvasContext>;
// Preserve unexpected stack traces for debugging without breaking the canvas UI.
function prepareDeformation(
  context: Context,
  pointId: string,
): ReturnType<typeof canvasDeformationPlan> {
  try {
    return canvasDeformationPlan(context.sketch, context.solved, pointId);
  } catch (error) {
    console.error("Unable to prepare sketch deformation", error);
    return {
      xIds: [],
      yIds: [],
      pointIds: [],
      reason:
        "Deformation could not be prepared. Reopen the canvas or repair sketch diagnostics.",
    };
  }
}
export function useCanvasPointDrag(
  active: CanvasSession,
  context: Context | undefined,
  span: number,
  showCoordinates: (point: CanvasPoint) => void,
  mode: "move" | "translate" | "deform" = "move",
) {
  const translate = mode === "translate",
    deform = mode === "deform";
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
        translate: boolean;
        deform: boolean;
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
    const reason = deform
      ? prepareDeformation(context, point.pointId).reason
      : translate
        ? canvasTranslationGroup(context.sketch, context.solved, point.pointId)
            .reason
        : canvasPointMoveReason(context.sketch, point.pointId);
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
      translate,
      deform,
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
      (captured.deform
        ? commitCanvasDeformation
        : captured.translate
          ? commitCanvasTranslation
          : commitCanvasPointMove)(
        active,
        captured.document,
        captured.pointId,
        point,
      );
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
      (deform
        ? commitCanvasDeformation
        : translate
          ? commitCanvasTranslation
          : commitCanvasPointMove)(active, context.document, pointId, point);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const group = useMemo<CanvasTranslationGroup>(
    () =>
      translate && context && pointId
        ? canvasTranslationGroup(context.sketch, context.solved, pointId)
        : { pointIds: [pointId] },
    [translate, context?.sketch, context?.solved, pointId],
  );
  const deformationPlan = useMemo(
    () =>
      deform && context && pointId
        ? prepareDeformation(context, pointId)
        : undefined,
    [deform, context?.sketch, context?.solved, pointId],
  );
  const sketch = context?.sketch,
    solved = context?.solved;
  const deformationPreview = useMemo(() => {
    if (!deform || !sketch || !solved || !target || !pointId) return undefined;
    try {
      return {
        result: deformedCanvasSketch(
          sketch,
          solved,
          pointId,
          target,
          deformationPlan,
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [deform, sketch, solved, target, pointId, deformationPlan]);
  const movingPointIds = useMemo(
    () => new Set(deform ? (deformationPlan?.pointIds ?? []) : group.pointIds),
    [deform, deformationPlan, group],
  );
  const reason =
    context && pointId
      ? deform
        ? deformationPlan?.reason
        : translate
          ? group.reason
          : canvasPointMoveReason(context.sketch, pointId)
      : undefined;
  const controls = (
    <>
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
      {deform && pointId && !reason ? (
        <span>
          Orthogonal deformation preserves constraints and dimensions.
          Fixed/parameter-bound axes may block a requested coordinate.
        </span>
      ) : null}
      {translate && pointId && !reason ? (
        <span>
          Connected group: {group.pointIds.length} points. Dimensions and
          constraints stay intact; the whole group translates.
        </span>
      ) : null}
    </>
  );
  const shifted = (p: CanvasPoint & { id: string }) => {
    const anchor = context?.solved.points[pointId];
    if (!target || !anchor || !movingPointIds.has(p.id)) return p;
    if (deform) return deformationPreview?.result?.targets.get(p.id) ?? p;
    return translate
      ? { x: p.x + target.x - anchor.x, y: p.y + target.y - anchor.y }
      : target;
  };
  const preview =
    target && context ? (
      <g
        className="canvas-preview"
        aria-label={
          deform
            ? "Orthogonal deformation preview"
            : translate
              ? "Group translation preview"
              : "Point move preview"
        }
      >
        {!deform || deformationPreview?.result
          ? context.solved.lines
              .filter(
                (l) =>
                  movingPointIds.has(l.start.id) ||
                  movingPointIds.has(l.end.id),
              )
              .map((l) => {
                const a = shifted(l.start),
                  b = shifted(l.end);
                return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
              })
          : null}
        {context.solved.circles
          .filter((c) => movingPointIds.has(c.center.id))
          .map((c) => {
            const p = shifted(c.center);
            return <circle key={c.id} cx={p.x} cy={p.y} r={c.radius} />;
          })}
        {translate
          ? context.solved.arcs
              .filter((a) => movingPointIds.has(a.center.id))
              .map((a) => {
                const start = shifted(a.start),
                  end = shifted(a.end);
                return (
                  <path
                    key={a.id}
                    d={`M ${start.x} ${start.y} A ${a.radius} ${a.radius} 0 ${Math.abs(a.sweep) > Math.PI ? 1 : 0} ${a.sweep < 0 ? 0 : 1} ${end.x} ${end.y}`}
                  />
                );
              })
          : null}
        {[...movingPointIds]
          .map((id) => context.solved.points[id])
          .filter(Boolean)
          .map((p) => {
            const point = shifted(p);
            return (
              <circle key={p.id} cx={point.x} cy={point.y} r={span / 150} />
            );
          })}
      </g>
    ) : null;
  return {
    controls,
    preview,
    pointId,
    movingPointIds,
    reason,
    error: error ?? deformationPreview?.error,
    inProgress: !!target,
    begin,
    move,
    finish,
    keyboardMove,
    lostCapture,
    cancel,
  };
}
