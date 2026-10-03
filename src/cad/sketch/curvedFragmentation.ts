import type {
  ResolvedArc,
  ResolvedCircle,
  ResolvedLine,
  ResolvedPoint,
} from "./SketchSolver";
import {
  fragmentProfileLines,
  MAX_PROFILE_FRAGMENTS,
  MAX_PROFILE_SOURCE_CURVES,
} from "./lineFragmentation";
import { SKETCH_TOLERANCE as EPS } from "./tolerances";

export const MAX_CURVE_GRAPH_SEGMENTS = 8192;
interface Cut {
  t: number;
  point: ResolvedPoint;
  anchors: string[];
}
export interface CurvedFragmentation {
  handled: boolean;
  lines: ResolvedLine[];
  circles: ResolvedCircle[];
  arcs: Map<string, ResolvedArc>;
  lineage: Map<string, string>;
  errors: string[];
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const turn = Math.PI * 2;
const angle = (p: ResolvedPoint, c: ResolvedCircle) =>
  (Math.atan2(p.y - c.center.y, p.x - c.center.x) + turn) % turn;
function addCut(cuts: Cut[], cut: Cut) {
  const existing = cuts.find((c) => distance(c.point, cut.point) <= EPS);
  if (existing) existing.anchors.push(...cut.anchors);
  else cuts.push({ ...cut, anchors: [...cut.anchors] });
}
/** Analytic circle/line contacts only. No durable entity is split or rewritten.
 * Other circular intersections remain diagnostic in the profile validator. */
export function fragmentCircleProfiles(
  sourceLines: ResolvedLine[],
  sourceCircles: ResolvedCircle[],
  key: (point: { x: number; y: number }) => string,
  sample: (arc: ResolvedArc) => { x: number; y: number }[],
): CurvedFragmentation {
  const result: CurvedFragmentation = {
    handled: false,
    lines: sourceLines,
    circles: sourceCircles,
    arcs: new Map(),
    lineage: new Map(sourceLines.map((l) => [l.id, l.id])),
    errors: [],
  };
  const fail = (message: string): CurvedFragmentation => ({
    ...result,
    handled: true,
    lines: [],
    errors: [message],
  });
  if (!sourceLines.length || !sourceCircles.length) return result;
  if (sourceLines.length + sourceCircles.length > MAX_PROFILE_SOURCE_CURVES)
    return fail(
      `Curved fragmentation exceeds the ${MAX_PROFILE_SOURCE_CURVES} source-curve limit.`,
    );
  const lineCuts = new Map(sourceLines.map((l) => [l.id, [] as Cut[]]));
  const circleCuts = new Map(sourceCircles.map((c) => [c.id, [] as Cut[]]));
  let contacts = 0;
  for (const circle of sourceCircles)
    for (const line of sourceLines) {
      // Canonical endpoint order gives the two roots stable identities under winding edits.
      const start = line.start.id < line.end.id ? line.start : line.end;
      const end = start === line.start ? line.end : line.start;
      const dx = end.x - start.x,
        dy = end.y - start.y,
        length = Math.hypot(dx, dy);
      if (length <= EPS)
        return fail(
          `Line "${line.id}" is zero-length and cannot form a profile.`,
        );
      const ux = dx / length,
        uy = dy / length,
        px = start.x - circle.center.x,
        py = start.y - circle.center.y;
      const along = -(px * ux + py * uy),
        perpendicular = px * uy - py * ux;
      if (Math.abs(perpendicular) > circle.radius + EPS) continue;
      if (
        Math.abs(Math.abs(perpendicular) - circle.radius) <= EPS &&
        along >= -EPS &&
        along <= length + EPS
      )
        return fail(
          `Circle "${circle.id}" and line "${line.id}" touch tangentially or ambiguously. Separate the boundaries before modeling.`,
        );
      const nearestRoot = Math.max(0, Math.min(length, along));
      const nearest = Math.hypot(px + nearestRoot * ux, py + nearestRoot * uy);
      const farthest = Math.max(
        Math.hypot(px, py),
        Math.hypot(end.x - circle.center.x, end.y - circle.center.y),
      );
      const closeToBoundary =
        nearest <= circle.radius + EPS && farthest >= circle.radius - EPS;
      const ambiguous = () =>
        fail(
          `Circle "${circle.id}" and line "${line.id}" have an ambiguous contact within sketch tolerance. Separate the boundaries before modeling.`,
        );
      const radicand =
        circle.radius * circle.radius - perpendicular * perpendicular;
      if (radicand <= 0) {
        if (closeToBoundary) return ambiguous();
        continue;
      }
      const half = Math.sqrt(radicand),
        roots = [along - half, along + half];
      let hits = 0;
      for (const [branch, root] of roots.entries()) {
        if (root < -EPS || root > length + EPS) continue;
        hits++;
        const anchor = `circle-contact:${JSON.stringify([circle.id, line.id, branch])}`;
        const point: ResolvedPoint =
          Math.abs(root) <= EPS
            ? start
            : Math.abs(root - length) <= EPS
              ? end
              : { id: anchor, x: start.x + root * ux, y: start.y + root * uy };
        const t =
          ((point.x - line.start.x) * (line.end.x - line.start.x) +
            (point.y - line.start.y) * (line.end.y - line.start.y)) /
          (length * length);
        addCut(lineCuts.get(line.id)!, { t, point, anchors: [anchor] });
        addCut(circleCuts.get(circle.id)!, {
          t: angle(point, circle),
          point,
          anchors: [anchor],
        });
        if (++contacts > MAX_PROFILE_FRAGMENTS)
          return fail(
            `Curved fragmentation exceeds the ${MAX_PROFILE_FRAGMENTS} contact limit.`,
          );
      }
      if (!hits && closeToBoundary) return ambiguous();
    }
  if (!contacts) return result;
  result.handled = true;
  const base = fragmentProfileLines(sourceLines, key);
  if (base.errors.length) return fail(base.errors[0]);
  const lines: ResolvedLine[] = [];
  const lineage = new Map<string, string>();
  for (const line of base.lines) {
    const source = base.lineage.get(line.id)!;
    const dx = line.end.x - line.start.x,
      dy = line.end.y - line.start.y,
      length = Math.hypot(dx, dy);
    const cuts: Cut[] = [
      { t: 0, point: line.start, anchors: [`point:${line.start.id}`] },
      { t: 1, point: line.end, anchors: [`point:${line.end.id}`] },
    ];
    for (const cut of lineCuts.get(source)!) {
      const t =
        ((cut.point.x - line.start.x) * dx +
          (cut.point.y - line.start.y) * dy) /
        (length * length);
      if (t >= -EPS / length && t <= 1 + EPS / length)
        addCut(cuts, { ...cut, t: Math.max(0, Math.min(1, t)) });
    }
    cuts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1],
        b = cuts[i];
      const id =
        cuts.length === 2
          ? line.id
          : `${line.id}~circle-fragment:${JSON.stringify([[...a.anchors].sort().join("|"), [...b.anchors].sort().join("|")].sort())}`;
      lines.push({ id, start: a.point, end: b.point });
      lineage.set(id, source);
    }
    if (lines.length > MAX_PROFILE_FRAGMENTS)
      return fail(
        `Curved fragmentation exceeds the ${MAX_PROFILE_FRAGMENTS} fragment limit.`,
      );
  }
  const untouched: ResolvedCircle[] = [];
  const arcs = new Map<string, ResolvedArc>();
  let fragmentCount = lines.length;
  for (const circle of sourceCircles) {
    const cuts = circleCuts.get(circle.id)!.sort((a, b) => a.t - b.t);
    if (!cuts.length) {
      untouched.push(circle);
      continue;
    }
    if (cuts.length < 2)
      return fail(
        `Circle "${circle.id}" has only one boundary contact. Complete the divider or separate touching geometry.`,
      );
    for (let i = 0; i < cuts.length; i++) {
      const a = cuts[i],
        b = cuts[(i + 1) % cuts.length];
      const id = `${circle.id}~arc-fragment:${JSON.stringify([[...a.anchors].sort().join("|"), [...b.anchors].sort().join("|")])}`;
      const arc: ResolvedArc = {
        ...circle,
        id,
        start: a.point,
        end: b.point,
        startAngle: a.t,
        sweep: (b.t - a.t + turn) % turn,
      };
      if (++fragmentCount > MAX_PROFILE_FRAGMENTS)
        return fail(
          `Curved fragmentation exceeds the ${MAX_PROFILE_FRAGMENTS} fragment limit.`,
        );
      const sampled = sample(arc);
      if (sampled.length < 2 || distance(a.point, b.point) <= EPS)
        return fail(
          `Curved fragment "${id}" is too small to form an unambiguous profile boundary.`,
        );
      const samples = sampled.map((p) => ({
        ...p,
        t:
          (Math.atan2(p.y - circle.center.y, p.x - circle.center.x) -
            arc.startAngle +
            turn) %
          turn,
      }));
      // Include exact extrema so profile/tool bounds do not depend on sample alignment.
      for (let q = 0; q < 4; q++) {
        const t = ((q * Math.PI) / 2 - arc.startAngle + turn) % turn;
        if (t > EPS / circle.radius && t < arc.sweep - EPS / circle.radius)
          samples.push({
            x: circle.center.x + circle.radius * Math.cos((q * Math.PI) / 2),
            y: circle.center.y + circle.radius * Math.sin((q * Math.PI) / 2),
            t,
          });
      }
      samples[0].t = 0;
      samples[sampled.length - 1].t = arc.sweep;
      samples.sort((a, b) => a.t - b.t);
      const distinct: { x: number; y: number; t: number }[] = [
        { ...a.point, t: 0 },
      ];
      for (const p of samples.slice(1, -1)) {
        if (distance(p, distinct.at(-1)!) > EPS && distance(p, b.point) > EPS)
          distinct.push(p);
      }
      distinct.push({ ...b.point, t: arc.sweep });
      if (lines.length + distinct.length - 1 > MAX_CURVE_GRAPH_SEGMENTS)
        return fail(
          `Curved profile traversal exceeds the ${MAX_CURVE_GRAPH_SEGMENTS} graph-segment limit.`,
        );
      for (let j = 1; j < distinct.length; j++) {
        const segmentId = `${id}~sample:${j}`;
        const point = (
          p: { x: number; y: number },
          index: number,
        ): ResolvedPoint =>
          index === 0
            ? a.point
            : index === distinct.length - 1
              ? b.point
              : { id: `${id}:sample:${index}`, x: p.x, y: p.y };
        lines.push({
          id: segmentId,
          start: point(distinct[j - 1], j - 1),
          end: point(distinct[j], j),
        });
        arcs.set(segmentId, arc);
        lineage.set(segmentId, circle.id);
      }
    }
  }
  return { ...result, lines, circles: untouched, arcs, lineage };
}
