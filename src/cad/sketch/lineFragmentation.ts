import type { ResolvedLine, ResolvedPoint } from "./SketchSolver";
import { SKETCH_TOLERANCE as EPS } from "./tolerances";

// Runtime only: authored entities and their constraints are never split or rewritten.
export const MAX_PROFILE_FRAGMENTS = 2048;
export const MAX_PROFILE_SOURCE_CURVES = 750;
type PointKey = (point: { x: number; y: number }) => string;
interface Cut {
  t: number;
  point: ResolvedPoint;
  anchors: string[];
}
export interface LineFragmentation {
  lines: ResolvedLine[];
  lineage: Map<string, string>;
  errors: string[];
  changed: boolean;
}
const distance = (a: ResolvedPoint, b: ResolvedPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const cross = (ax: number, ay: number, bx: number, by: number) =>
  ax * by - ay * bx;

export function fragmentProfileLines(
  lines: ResolvedLine[],
  key: PointKey,
): LineFragmentation {
  const lineage = new Map(lines.map((l) => [l.id, l.id]));
  const fail = (message: string): LineFragmentation => ({
    lines: [],
    lineage,
    errors: [message],
    changed: false,
  });
  if (lines.length > MAX_PROFILE_SOURCE_CURVES)
    return fail(
      `Line fragmentation exceeds the ${MAX_PROFILE_SOURCE_CURVES} source-line limit.`,
    );
  const cuts = lines.map(
    (l) =>
      [
        { t: 0, point: l.start, anchors: [`point:${l.start.id}`] },
        { t: 1, point: l.end, anchors: [`point:${l.end.id}`] },
      ] as Cut[],
  );
  const byVertex = new Map<string, number[]>();
  lines.forEach((l, i) =>
    [l.start, l.end].forEach((p) => {
      const connected = byVertex.get(key(p)) ?? [];
      connected.push(i);
      byVertex.set(key(p), connected);
    }),
  );
  // Reject self-crossings of authored closed components rather than interpreting
  // a bow-tie as two new regions. Branches are checked by face traversal below.
  const closedComponent = new Map<number, number>();
  const unseen = new Set(lines.map((_, i) => i));
  while (unseen.size) {
    const pending = [unseen.values().next().value!],
      component: number[] = [];
    let closed = true;
    while (pending.length) {
      const i = pending.pop()!;
      if (!unseen.delete(i)) continue;
      component.push(i);
      for (const p of [lines[i].start, lines[i].end]) {
        const adjacent = byVertex.get(key(p))!;
        closed &&= adjacent.length === 2;
        for (const other of adjacent)
          if (unseen.has(other)) pending.push(other);
      }
    }
    if (closed) for (const i of component) closedComponent.set(i, component[0]);
  }
  let additions = 0;
  const addCut = (
    i: number,
    t: number,
    point: ResolvedPoint,
    anchor: string,
  ) => {
    const existing = cuts[i].find((c) => distance(c.point, point) <= EPS);
    if (existing) existing.anchors.push(anchor);
    else {
      cuts[i].push({ t, point, anchors: [anchor] });
      additions++;
    }
  };
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j],
        ax = a.end.x - a.start.x,
        ay = a.end.y - a.start.y,
        bx = b.end.x - b.start.x,
        by = b.end.y - b.start.y,
        al = Math.hypot(ax, ay),
        bl = Math.hypot(bx, by),
        denominator = cross(ax, ay, bx, by);
      if (Math.abs(denominator) <= Number.EPSILON * al * bl * 16) continue;
      const dx = b.start.x - a.start.x,
        dy = b.start.y - a.start.y,
        t = cross(dx, dy, bx, by) / denominator,
        u = cross(dx, dy, ax, ay) / denominator;
      if (
        t < -EPS / al ||
        t > 1 + EPS / al ||
        u < -EPS / bl ||
        u > 1 + EPS / bl
      )
        continue;
      const ai = t > EPS / al && t < 1 - EPS / al,
        bi = u > EPS / bl && u < 1 - EPS / bl;
      if (!ai && !bi) continue;
      if (
        ai &&
        bi &&
        closedComponent.has(i) &&
        closedComponent.get(i) === closedComponent.get(j)
      )
        return fail(
          `Lines "${a.id}" and "${b.id}" self-intersect in an authored closed loop.`,
        );
      const point = !ai
        ? t <= 0.5
          ? a.start
          : a.end
        : !bi
          ? u <= 0.5
            ? b.start
            : b.end
          : {
              id: `intersection:${JSON.stringify([a.id, b.id].sort())}`,
              x: a.start.x + t * ax,
              y: a.start.y + t * ay,
            };
      const anchor = `junction:${JSON.stringify([a.id, b.id].sort())}`;
      addCut(i, Math.max(0, Math.min(1, t)), point, anchor);
      addCut(j, Math.max(0, Math.min(1, u)), point, anchor);
      if (lines.length + additions > MAX_PROFILE_FRAGMENTS)
        return fail(
          `Line fragmentation exceeds the ${MAX_PROFILE_FRAGMENTS} fragment limit near "${a.id}" and "${b.id}".`,
        );
    }
  const fragments: ResolvedLine[] = [];
  lines.forEach((line, i) => {
    const ordered = cuts[i].sort((a, b) => a.t - b.t);
    if (ordered.length === 2) {
      fragments.push(line);
      return;
    }
    for (let c = 1; c < ordered.length; c++) {
      const start = ordered[c - 1],
        end = ordered[c];
      const id = `${line.id}~fragment:${JSON.stringify([start.anchors.sort().join("|"), end.anchors.sort().join("|")].sort())}`;
      fragments.push({ id, start: start.point, end: end.point });
      lineage.set(id, line.id);
    }
  });
  return { lines: fragments, lineage, errors: [], changed: additions > 0 };
}

export interface LineFace {
  lines: ResolvedLine[];
  points: ResolvedPoint[];
}
export function extractLineFaces(
  lines: ResolvedLine[],
  key: PointKey,
  angleForEdge?: (
    line: ResolvedLine,
    start: ResolvedPoint,
    end: ResolvedPoint,
  ) => number,
): { faces: LineFace[]; errors: string[] } {
  interface Edge {
    id: number;
    line: ResolvedLine;
    start: ResolvedPoint;
    end: ResolvedPoint;
    angle: number;
  }
  const edges: Edge[] = [],
    fans = new Map<string, Edge[]>();
  for (const line of lines)
    for (const reverse of [false, true]) {
      const start = reverse ? line.end : line.start,
        end = reverse ? line.start : line.end;
      const edge = {
        id: edges.length,
        line,
        start,
        end,
        angle:
          angleForEdge?.(line, start, end) ??
          Math.atan2(end.y - start.y, end.x - start.x),
      };
      edges.push(edge);
      const fan = fans.get(key(start)) ?? [];
      fan.push(edge);
      fans.set(key(start), fan);
    }
  for (const fan of fans.values()) {
    if (fan.length < 2)
      return {
        faces: [],
        errors: [
          `Line "${fan[0].line.id}" has an open profile endpoint after intersection fragmentation.`,
        ],
      };
    fan.sort((a, b) => a.angle - b.angle || a.line.id.localeCompare(b.line.id));
  }
  const visited = new Set<number>(),
    faces: LineFace[] = [];
  for (const first of edges) {
    if (visited.has(first.id)) continue;
    const boundary: Edge[] = [],
      vertices = new Set<string>();
    let current = first;
    do {
      if (visited.has(current.id) || vertices.has(key(current.start)))
        return {
          faces: [],
          errors: [
            `Line "${current.line.id}" belongs to an ambiguous touching, self-intersecting or dangling profile boundary.`,
          ],
        };
      visited.add(current.id);
      vertices.add(key(current.start));
      boundary.push(current);
      const fan = fans.get(key(current.end))!,
        reverse = current.id ^ 1;
      const at = fan.findIndex((e) => e.id === reverse);
      current = fan[(at + fan.length - 1) % fan.length];
    } while (current.id !== first.id);
    const origin = boundary[0].start;
    const area =
      boundary.reduce(
        (sum, e) =>
          sum +
          (e.start.x - origin.x) * (e.end.y - origin.y) -
          (e.end.x - origin.x) * (e.start.y - origin.y),
        0,
      ) / 2;
    if (Math.abs(area) <= EPS * EPS)
      return {
        faces: [],
        errors: [
          `Line "${first.line.id}" belongs to a zero-area fragmented profile boundary.`,
        ],
      };
    if (area > EPS * EPS)
      faces.push({
        lines: boundary.map((e) => ({ ...e.line, start: e.start, end: e.end })),
        points: boundary.map((e) => e.start),
      });
  }
  return { faces, errors: [] };
}
