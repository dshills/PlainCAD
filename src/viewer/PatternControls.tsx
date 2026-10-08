import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { draggedPatternLiteral, draggedPatternSweep, patternFieldIsLiteral, type PatternControlInput, type PatternControlModel, type PatternPoint } from "../cad/features/patternManipulation";
import "./patternControls.css";

type Handle = "spacing" | "center" | "sweep";
interface Bounds { x: number; y: number; width: number; height: number }
interface Drag {
  pointerId: number; handle: Handle; input: PatternControlInput; view: Bounds;
  rect: DOMRect; screenToLocal?: DOMMatrix; model: PatternControlModel; angle: number; sweep: number; grabOffset: PatternPoint;
}
export function PatternControls({ model, input, disabled, onChange, onDragging }: {
  model: PatternControlModel; input: PatternControlInput; disabled?: boolean;
  onChange: (change: Partial<PatternControlInput>) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<Drag>(undefined);
  const callbacks = useRef({ onChange, onDragging });
  useLayoutEffect(() => { callbacks.current = { onChange, onDragging }; }, [onChange, onDragging]);
  const [active, setActive] = useState<Drag>();
  const [replaceExpressions, setReplaceExpressions] = useState(false);
  const span = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxY - model.bounds.minY, 10), pad = span * .2;
  const computed: Bounds = { x: model.bounds.minX - pad, y: -model.bounds.maxY - pad, width: model.bounds.maxX - model.bounds.minX + pad * 2, height: model.bounds.maxY - model.bounds.minY + pad * 2 };
  // Square viewport with a frozen viewBox prevents fit feedback while dragging.
  const size = Math.max(computed.width, computed.height);
  const view = active?.view ?? { x: computed.x - (size - computed.width) / 2, y: computed.y - (size - computed.height) / 2, width: size, height: size };
  const expressionLocked = (handle: Handle) => !replaceExpressions && (handle === "spacing" ? !patternFieldIsLiteral(input.spacing) : handle === "sweep" ? !patternFieldIsLiteral(input.angle) : !patternFieldIsLiteral(input.centerX) || !patternFieldIsLiteral(input.centerY));
  const end = useCallback((cancel: boolean) => {
    const value = drag.current;
    if (!value) return;
    drag.current = undefined; setActive(undefined); callbacks.current.onDragging(false);
    if (svg.current?.hasPointerCapture?.(value.pointerId)) svg.current.releasePointerCapture(value.pointerId);
    // Restore only gesture-owned fields, preserving another control's edits.
    if (cancel) callbacks.current.onChange(value.handle === "spacing" ? { spacing: value.input.spacing } : value.handle === "sweep" ? { angle: value.input.angle } : { centerX: value.input.centerX, centerY: value.input.centerY });
  }, []);
  useEffect(() => { if (disabled) end(true); }, [disabled, end]);
  useEffect(() => () => end(true), [end]);
  const local = (clientX: number, clientY: number, value: Drag): PatternPoint => {
    const matrix = value.screenToLocal;
    if (matrix) return { x: matrix.a * clientX + matrix.c * clientY + matrix.e, y: -(matrix.b * clientX + matrix.d * clientY + matrix.f) };
    // Default xMidYMid meet mapping also supports DOMs without SVG matrices.
    const scale = Math.min(value.rect.width / value.view.width, value.rect.height / value.view.height);
    const left = value.rect.left + (value.rect.width - value.view.width * scale) / 2, top = value.rect.top + (value.rect.height - value.view.height * scale) / 2;
    return { x: value.view.x + (clientX - left) / scale, y: -(value.view.y + (clientY - top) / scale) };
  };
  const source = model.centers[0];
  // A full circle still has a distinct sweep handle beyond the original copy.
  const radius = Math.max(Math.hypot(source.x - model.center.x, source.y - model.center.y), span * .18);
  const baseAngle = Math.atan2(source.y - model.center.y, source.x - model.center.x);
  const sweepPoint = { x: model.center.x + radius * Math.cos(baseAngle + model.sweep), y: model.center.y + radius * Math.sin(baseAngle + model.sweep) };
  const begin = (event: React.PointerEvent, handle: Handle) => {
    if (drag.current || disabled || expressionLocked(handle) || event.button !== 0 || !svg.current) return;
    event.preventDefault();
    svg.current.focus();
    const value: Drag = { pointerId: event.pointerId, handle, input: { ...input }, view, rect: svg.current.getBoundingClientRect(), screenToLocal: svg.current.getScreenCTM?.()?.inverse(), model, angle: baseAngle + model.sweep, sweep: model.sweep, grabOffset: { x: 0, y: 0 } };
    if (!value.rect.width || !value.rect.height) return;
    const point = local(event.clientX, event.clientY, value);
    const origin = handle === "spacing" ? model.centers[1] : handle === "center" ? model.center : sweepPoint;
    value.grabOffset = { x: point.x - origin.x, y: point.y - origin.y };
    value.angle = Math.atan2(point.y - model.center.y, point.x - model.center.x);
    drag.current = value; setActive(value); onDragging(true); svg.current.setPointerCapture?.(event.pointerId);
  };
  const handle = (name: Handle, point: PatternPoint, label: string) => <g role="img" aria-label={label} data-pattern-handle={name} className={disabled || expressionLocked(name) ? "pattern-control-handle locked" : "pattern-control-handle"} onPointerDown={event => begin(event, name)}>
    <circle cx={point.x} cy={-point.y} r={view.width * .026} />
    <title>{disabled ? "Wait for current geometry" : expressionLocked(name) ? "Formula protected. Allow formula replacement to drag." : `${label}. Numeric fields provide keyboard editing.`}</title>
  </g>;
  return <section className="pattern-controls" aria-label="Pattern arrangement controls" onKeyDownCapture={event => {
    if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); end(true); }
  }}>
    <p>Drag {input.type === "linear" ? "the spacing handle" : "the center or sweep handle"}. The plan uses the source sketch’s X/Y axes.</p>
    <svg ref={svg} tabIndex={0} aria-label="Pattern arrangement plan" role="img" preserveAspectRatio="xMidYMid meet" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerMove={event => {
      const value = drag.current;
      if (!value || value.pointerId !== event.pointerId || disabled) return;
      const point = local(event.clientX, event.clientY, value);
      if (value.handle === "spacing") {
        const spacing = value.input.direction === "X" ? point.x - value.grabOffset.x - value.model.centers[0].x : point.y - value.grabOffset.y - value.model.centers[0].y;
        if (Math.abs(spacing) >= 1e-5) onChange({ spacing: draggedPatternLiteral(spacing) });
      } else if (value.handle === "center") onChange({ centerX: draggedPatternLiteral(point.x - value.grabOffset.x), centerY: draggedPatternLiteral(point.y - value.grabOffset.y) });
      else {
        const angle = Math.atan2(point.y - value.model.center.y, point.x - value.model.center.x);
        value.sweep = draggedPatternSweep(value.sweep, angle, value.angle); value.angle = angle;
        if (Math.abs(value.sweep) >= 1e-5) onChange({ angle: draggedPatternLiteral(value.sweep, true) });
      }
    }} onPointerUp={event => { if (event.pointerId === drag.current?.pointerId) end(false); }} onPointerCancel={event => { if (event.pointerId === drag.current?.pointerId) end(true); }} onLostPointerCapture={() => { if (drag.current) end(true); }}>
      {model.outlines.map((loops, index) => <g key={index} className={index === 0 ? "pattern-control-source" : "pattern-control-copy"} data-pattern-instance={index}>{loops.map((loop, n) => <polygon key={n} points={loop.map(point => `${point.x},${-point.y}`).join(" ")} />)}<text x={model.centers[index].x} y={-model.centers[index].y} fontSize={view.width * .035}>{index + 1}</text></g>)}
      {input.type === "linear" ? <><line className="pattern-control-guide" x1={source.x} y1={-source.y} x2={model.centers[1].x} y2={-model.centers[1].y} />{handle("spacing", model.centers[1], "Drag pattern spacing")}</> : <>
        <line className="pattern-control-guide" x1={model.center.x} y1={-model.center.y} x2={sweepPoint.x} y2={-sweepPoint.y} />
        {handle("center", model.center, "Drag pattern center")}{handle("sweep", sweepPoint, "Drag pattern sweep")}
      </>}
    </svg>
    <label><input type="checkbox" checked={replaceExpressions} disabled={Boolean(active)} onChange={event => setReplaceExpressions(event.target.checked)} />Allow dragging to replace formulas with literal values</label>
    <p className="muted">Parameter formulas remain linked until you explicitly allow replacement. Copy outlines are an arrangement guide; the native preview determines whether Apply is available.</p>
  </section>;
}
