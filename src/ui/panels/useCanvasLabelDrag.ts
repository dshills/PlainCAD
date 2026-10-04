import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { CadDocument } from "../../cad/document/schema";
import type { CanvasPoint } from "../../cad/sketch/canvasGeometry";
import type { CanvasLabelView } from "../../cad/sketch/canvasLabelLayout";

/** View-only annotation placement. Never writes document history or schedules a rebuild. */
export function useCanvasLabelDrag(
  document: CadDocument | undefined,
  view: CanvasLabelView,
  ids: string[],
) {
  const [positions, setPositions] = useState<Record<string, CanvasPoint>>({});
  const [preview, setPreview] = useState<{
    id: string;
    position: CanvasPoint;
    document: CadDocument;
    viewKey: string;
  }>();
  const gesture = useRef<
    | {
        id: string;
        pointerId: number;
        element: SVGGElement;
        document: CadDocument;
        viewKey: string;
        start: CanvasPoint;
        pointer: CanvasPoint;
        clientX: number;
        clientY: number;
      }
    | undefined
  >(undefined);
  const viewKey = JSON.stringify(view),
    idsKey = JSON.stringify(ids);
  const cancel = useCallback(() => {
    const captured = gesture.current;
    gesture.current = undefined;
    setPreview(undefined);
    if (captured?.element.hasPointerCapture(captured.pointerId))
      captured.element.releasePointerCapture(captured.pointerId);
  }, []);
  useEffect(() => {
    cancel();
  }, [document, viewKey, idsKey, cancel]);
  useEffect(() => {
    const current = new Set(ids);
    setPositions((previous) =>
      Object.keys(previous).every((id) => current.has(id))
        ? previous
        : Object.fromEntries(
            Object.entries(previous).filter(([id]) => current.has(id)),
          ),
    );
  }, [idsKey]);
  useEffect(
    () => () => {
      const captured = gesture.current;
      gesture.current = undefined;
      if (captured?.element.hasPointerCapture(captured.pointerId))
        captured.element.releasePointerCapture(captured.pointerId);
    },
    [],
  );
  const localPoint = (
    event: PointerEvent<SVGGElement>,
  ): CanvasPoint | undefined => {
    const svg = event.currentTarget.ownerSVGElement,
      matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y].every(Number.isFinite)
      ? { x: local.x, y: -local.y }
      : undefined;
  };
  const target = (event: PointerEvent<SVGGElement>) => {
    const captured = gesture.current,
      pointer = localPoint(event);
    if (
      !captured ||
      captured.pointerId !== event.pointerId ||
      captured.document !== document ||
      captured.viewKey !== viewKey ||
      !pointer
    )
      return;
    if (
      Math.hypot(
        event.clientX - captured.clientX,
        event.clientY - captured.clientY,
      ) < 3
    )
      return;
    return {
      id: captured.id,
      document: captured.document,
      viewKey: captured.viewKey,
      position: {
        x: captured.start.x + pointer.x - captured.pointer.x,
        y: captured.start.y + pointer.y - captured.pointer.y,
      },
    };
  };
  const handlers = (id: string, position: CanvasPoint, select: () => void) => ({
    onPointerDown: (event: PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      event.preventDefault();
      if (event.button !== 0 || !document) return;
      cancel();
      select();
      event.currentTarget.focus();
      const pointer = localPoint(event);
      if (!pointer) return;
      gesture.current = {
        id,
        pointerId: event.pointerId,
        element: event.currentTarget,
        document,
        viewKey,
        start: position,
        pointer,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      if (gesture.current?.pointerId === event.pointerId)
        setPreview(target(event));
    },
    onPointerUp: (event: PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      if (gesture.current?.pointerId !== event.pointerId) return;
      const next = target(event);
      cancel();
      if (next)
        setPositions((previous) => ({ ...previous, [next.id]: next.position }));
    },
    onPointerCancel: (event: PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      if (gesture.current?.pointerId === event.pointerId) cancel();
    },
    onLostPointerCapture: (event: PointerEvent<SVGGElement>) => {
      if (gesture.current?.pointerId === event.pointerId) cancel();
    },
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (!document) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const steps: Record<string, CanvasPoint> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
      };
      const step = steps[event.key];
      if (!step && event.key !== "Home") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
      setPositions((previous) => {
        const next = { ...previous };
        if (event.key === "Home") delete next[id];
        else {
          const distance = (view.width / 100) * (event.shiftKey ? 10 : 1);
          next[id] = {
            x: position.x + step.x * distance,
            y: position.y + step.y * distance,
          };
        }
        return next;
      });
    },
  });
  return {
    positions:
      preview && preview.document === document && preview.viewKey === viewKey
        ? { ...positions, [preview.id]: preview.position }
        : positions,
    handlers,
    cancel,
    reset: () => {
      cancel();
      setPositions({});
    },
  };
}
