import { useRepairFocus } from "../commands/repairCommand";
import { useCadStore } from "../../state/useCadStore";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";

export function RepairSketchOverlay({ solved, span }: { solved?: ResolvedSketch; span: number }) {
  const focus = useRepairFocus((state) => state.focus);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  if (!focus || focus.document !== document || focus.session !== session || focus.sketchId !== solved?.id) return null;
  const suggestion = focus.closingEdge;
  const start = suggestion && solved.points[suggestion.startId], end = suggestion && solved.points[suggestion.endId];
  if (!start || !end) return null;
  return <g className="canvas-repair-proposal" aria-label="Proposed missing closing edge" pointerEvents="none">
    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#e08a16" strokeWidth={span / 200} strokeDasharray={`${span / 70} ${span / 100}`} />
    {[start, end].map((point) => <circle key={point.id} cx={point.x} cy={point.y} r={span / 90} fill="none" stroke="#e08a16" strokeWidth={span / 250} />)}
  </g>;
}
