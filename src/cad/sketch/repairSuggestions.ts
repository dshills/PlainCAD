import type { Sketch } from "../document/schema";
import type { ResolvedSketch } from "./SketchSolver";
import { SKETCH_TOLERANCE } from "./tolerances";

export interface ClosingEdgeSuggestion {
  startId: string;
  endId: string;
  distance: number;
}

/** Only a single unbranched open chain has an unambiguous missing closing edge.
 * This is a proposal, not an automatic change to coordinates or constraints. */
export function suggestClosingEdge(
  sketch: Sketch,
  solved: ResolvedSketch,
): ClosingEdgeSuggestion | undefined {
  if (solved.errors.length || solved.circles.some((c) => !c.construction)) return;
  const curves = [...solved.lines, ...solved.arcs].filter((c) => !c.construction);
  if (curves.length < 2 || curves.length > 256) return;
  const nodes: Array<{ id: string; x: number; y: number; neighbors: number[] }> = [];
  const nodeFor = (point: { id: string; x: number; y: number }) => {
    const existing = nodes.findIndex((n) => Math.hypot(n.x - point.x, n.y - point.y) <= SKETCH_TOLERANCE);
    if (existing >= 0) return existing;
    nodes.push({ ...point, neighbors: [] });
    return nodes.length - 1;
  };
  for (const curve of curves) {
    const start = nodeFor(curve.start), end = nodeFor(curve.end);
    if (start === end) return;
    nodes[start].neighbors.push(end);
    nodes[end].neighbors.push(start);
  }
  if (nodes.some((n) => n.neighbors.length > 2)) return;
  const ends = nodes.filter((n) => n.neighbors.length === 1);
  if (ends.length !== 2) return;
  const visited = new Set<number>(), pending = [0];
  while (pending.length) {
    const index = pending.pop()!;
    if (visited.has(index)) continue;
    visited.add(index);
    pending.push(...nodes[index].neighbors);
  }
  if (visited.size !== nodes.length) return;
  ends.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (ends.some((n) => sketch.entities[n.id]?.type !== "point")) return;
  const distance = Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y);
  if (!Number.isFinite(distance) || distance <= SKETCH_TOLERANCE) return;
  return { startId: ends[0].id, endId: ends[1].id, distance };
}
