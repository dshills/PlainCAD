import { useRef, useState } from "react";
import { DOCK_LIMITS, useWorkbenchState } from "../../state/useWorkbenchState";

/** Pointer and keyboard resizing; persist only the completed gesture. */
export function DockResize({ dock }: { dock: "left" | "right" | "bottom" }) {
  const key =
    dock === "left"
      ? "leftWidth"
      : dock === "right"
        ? "rightWidth"
        : "bottomHeight";
  const value = useWorkbenchState((state) => state[key]);
  const drag = useRef<{ id: number; start: number; value: number }>(undefined);
  const [active, setActive] = useState(false);
  const finish = (cancel: boolean) => {
    const prior = drag.current;
    if (!prior) return;
    drag.current = undefined;
    const next = cancel ? prior.value : useWorkbenchState.getState()[key];
    useWorkbenchState.getState().configure({ [key]: next });
    setActive(false);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${dock} dock`}
      aria-orientation={dock === "bottom" ? "horizontal" : "vertical"}
      aria-valuemin={DOCK_LIMITS[key].min}
      aria-valuemax={DOCK_LIMITS[key].max}
      aria-valuenow={value}
      className={`dock-resize dock-resize-${dock}${active ? " dragging" : ""}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          start: dock === "bottom" ? event.clientY : event.clientX,
          value,
        };
        setActive(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const delta =
          (dock === "bottom" ? event.clientY : event.clientX) - start.start;
        const { min, max } = DOCK_LIMITS[key];
        useWorkbenchState.setState({
          [key]: Math.min(
            max,
            Math.max(min, start.value + delta * (dock === "left" ? 1 : -1)),
          ),
        });
      }}
      onPointerUp={() => finish(false)}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
          return;
        }
        const keys =
          dock === "bottom"
            ? ["ArrowDown", "ArrowUp"]
            : ["ArrowLeft", "ArrowRight"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const sign = event.key === keys[1] ? 1 : -1;
        useWorkbenchState
          .getState()
          .configure({
            [key]:
              value +
              sign * (dock === "right" ? -1 : 1) * (event.shiftKey ? 32 : 8),
          });
      }}
    />
  );
}
