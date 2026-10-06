import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
/** Read-only solved sketch geometry; all coordinates are internal millimeters. */
export function SketchRefinementPreview({ solved }: { solved: ResolvedSketch }) {
  const points = [...Object.values(solved.points), ...[...solved.circles, ...solved.arcs].flatMap((c) => [
    { x: c.center.x - c.radius, y: c.center.y - c.radius }, { x: c.center.x + c.radius, y: c.center.y + c.radius },
  ])];
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY, 1), padding = span * 0.08;
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  return <svg aria-label="Solved sketch refinement preview" role="img" viewBox={`${minX - padding} ${-maxY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`}
    style={{ width: "100%", height: 180, border: "1px solid var(--border)", color: "var(--accent)" }}>
    <title>Solved sketch refinement preview in millimeters</title>
    <g fill="none" stroke="currentColor" strokeWidth={span / 220}>
      {solved.lines.map((line) => <line key={line.id} x1={line.start.x} y1={-line.start.y} x2={line.end.x} y2={-line.end.y} strokeDasharray={line.construction ? `${span / 60} ${span / 60}` : undefined} />)}
      {solved.circles.map((circle) => <circle key={circle.id} cx={circle.center.x} cy={-circle.center.y} r={circle.radius} strokeDasharray={circle.construction ? `${span / 60} ${span / 60}` : undefined} />)}
      {solved.arcs.map((arc) => <path key={arc.id} d={`M ${arc.start.x} ${-arc.start.y} A ${arc.radius} ${arc.radius} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep < 0 ? 1 : 0} ${arc.end.x} ${-arc.end.y}`} />)}
    </g>
  </svg>;
}
