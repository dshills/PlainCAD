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
const wrapAngle = (value: number) => ((value % turn) + turn) % turn;
const angle = (p: ResolvedPoint, c: ResolvedCircle) =>
  wrapAngle(Math.atan2(p.y - c.center.y, p.x - c.center.x));
function addCut(cuts: Cut[], cut: Cut) {
  const existing = cuts.find((c) => distance(c.point, cut.point) <= EPS);
  if (existing) existing.anchors.push(...cut.anchors);
  else cuts.push({ ...cut, anchors: [...cut.anchors] });
}
/** Analytic straight-line contacts with circles and arcs. No durable entity is
 * split or rewritten. Curve/curve intersections and ambiguities stay diagnostic. */
export function fragmentCurvedProfiles(
  sourceLines: ResolvedLine[],
  sourceCircles: ResolvedCircle[],
  sourceArcs: ResolvedArc[],
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
  if (!sourceLines.length || !(sourceCircles.length + sourceArcs.length))
    return result;
  if (
    sourceLines.length + sourceCircles.length + sourceArcs.length >
    MAX_PROFILE_SOURCE_CURVES
  )
    return fail(
      `Curved fragmentation exceeds the ${MAX_PROFILE_SOURCE_CURVES} source-curve limit.`,
    );
  const lineCuts = new Map(sourceLines.map((l) => [l.id, [] as Cut[]]));
  // Canonical CCW orientation is transient; source arcs and their IDs stay intact.
  const curves = [
    ...sourceCircles,
    ...sourceArcs.map((arc) =>
      arc.sweep < 0
        ? {
            ...arc,
            start: arc.end,
            end: arc.start,
            startAngle: arc.startAngle + arc.sweep,
            sweep: -arc.sweep,
          }
        : arc,
    ),
  ];
  const conflict = unsupportedCurveContact(curves);
  if (conflict) return fail(conflict);
  const closedOwners = closedCurveOwners(sourceLines, sourceArcs, key);
  const circleCuts = new Map(
    curves.map((c) => [
      c.id,
      isArc(c)
        ? [
            { t: 0, point: c.start, anchors: [`point:${c.start.id}`] },
            { t: c.sweep, point: c.end, anchors: [`point:${c.end.id}`] },
          ]
        : ([] as Cut[]),
    ]),
  );
  let contacts = 0,
    changed = false;
  for (const circle of curves)
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
      const tangentPoint = { x: start.x + along * ux, y: start.y + along * uy };
      if (
        Math.abs(Math.abs(perpendicular) - circle.radius) <= EPS &&
        along >= -EPS &&
        along <= length + EPS &&
        (!isArc(circle) || onArc(tangentPoint, circle))
      ) {
        if (
          isArc(circle) &&
          arcEndpoint(tangentPoint, circle) &&
          (distance(tangentPoint, start) <= EPS ||
            distance(tangentPoint, end) <= EPS)
        )
          continue;
        return fail(
          `Curve "${circle.id}" and line "${line.id}" touch tangentially or ambiguously. Separate the boundaries before modeling.`,
        );
      }
      const nearestRoot = Math.max(0, Math.min(length, along));
      const nearest = Math.hypot(px + nearestRoot * ux, py + nearestRoot * uy);
      const farthest = Math.max(
        Math.hypot(px, py),
        Math.hypot(end.x - circle.center.x, end.y - circle.center.y),
      );
      const nearestPoint = {
        x: start.x + nearestRoot * ux,
        y: start.y + nearestRoot * uy,
      };
      const closeToBoundary =
        (nearest <= circle.radius + EPS &&
          farthest >= circle.radius - EPS &&
          (!isArc(circle) || onArc(nearestPoint, circle))) ||
        (isArc(circle) &&
          [circle.start, circle.end].some(
            (p) => pointLineDistance(p, line) <= EPS,
          ));
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
        const anchor = `${isArc(circle) ? "arc-contact" : "circle-contact"}:${JSON.stringify([circle.id, line.id, branch])}`;
        let point: ResolvedPoint =
          Math.abs(root) <= EPS
            ? start
            : Math.abs(root - length) <= EPS
              ? end
              : { id: anchor, x: start.x + root * ux, y: start.y + root * uy };
        if (isArc(circle)) {
          const endpoint = arcEndpoint(point, circle);
          if (endpoint) point = endpoint;
          else if (!onArc(point, circle)) continue;
        }
        hits++;
        const curveT = isArc(circle)
          ? arcParameter(point, circle)
          : angle(point, circle);
        const interior = root > EPS && root < length - EPS;
        const curveInterior =
          !isArc(circle) ||
          (curveT > EPS / circle.radius &&
            curveT < circle.sweep - EPS / circle.radius);
        if (
          isArc(circle) &&
          (interior || curveInterior) &&
          closedOwners.has(line.id) &&
          closedOwners.get(line.id) === closedOwners.get(circle.id)
        )
          return fail(
            `Line "${line.id}" and arc "${circle.id}" self-intersect in an authored closed loop. Repair its boundary before modeling.`,
          );
        changed ||= interior || curveInterior;
        const t =
          ((point.x - line.start.x) * (line.end.x - line.start.x) +
            (point.y - line.start.y) * (line.end.y - line.start.y)) /
          (length * length);
        addCut(lineCuts.get(line.id)!, { t, point, anchors: [anchor] });
        addCut(circleCuts.get(circle.id)!, {
          t: curveT,
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
  if (!changed && !sourceArcs.length) return result;
  const base = fragmentProfileLines(sourceLines, key, closedOwners);
  if (base.errors.length) return fail(base.errors[0]);
  const degree = new Map<string, number>();
  for (const c of [...sourceLines, ...sourceArcs])
    for (const p of [c.start, c.end])
      degree.set(key(p), (degree.get(key(p)) ?? 0) + 1);
  if (!changed && !base.changed && ![...degree.values()].some((n) => n > 2))
    return result;
  result.handled = true;
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
  for (const circle of curves) {
    const cuts = circleCuts.get(circle.id)!.sort((a, b) => a.t - b.t);
    if (!cuts.length) {
      untouched.push(circle);
      continue;
    }
    if (cuts.length < 2)
      return fail(
        `Circle "${circle.id}" has only one boundary contact. Complete the divider or separate touching geometry.`,
      );
    const count = isArc(circle) ? cuts.length - 1 : cuts.length;
    for (let i = 0; i < count; i++) {
      const a = cuts[i],
        b = cuts[(i + 1) % cuts.length];
      const id =
        isArc(circle) && cuts.length === 2
          ? circle.id
          : `${circle.id}~arc-fragment:${JSON.stringify([[...a.anchors].sort().join("|"), [...b.anchors].sort().join("|")])}`;
      const arc: ResolvedArc = {
        ...circle,
        id,
        start: a.point,
        end: b.point,
        startAngle: (isArc(circle) ? circle.startAngle : 0) + a.t,
        sweep: isArc(circle) ? b.t - a.t : (b.t - a.t + turn) % turn,
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
        t: wrapAngle(
          Math.atan2(p.y - circle.center.y, p.x - circle.center.x) -
            arc.startAngle,
        ),
      }));
      // Include exact extrema so profile/tool bounds do not depend on sample alignment.
      for (let q = 0; q < 4; q++) {
        const t = wrapAngle((q * Math.PI) / 2 - arc.startAngle);
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

function isArc(curve: ResolvedCircle): curve is ResolvedArc {
  return "start" in curve;
}
function arcEndpoint(
  point: { x: number; y: number },
  arc: ResolvedArc,
): ResolvedPoint | undefined {
  return distance(point, arc.start) <= EPS
    ? arc.start
    : distance(point, arc.end) <= EPS
      ? arc.end
      : undefined;
}
function arcParameter(point: { x: number; y: number }, arc: ResolvedArc) {
  if (distance(point, arc.start) <= EPS) return 0;
  if (distance(point, arc.end) <= EPS) return arc.sweep;
  return wrapAngle(
    Math.atan2(point.y - arc.center.y, point.x - arc.center.x) - arc.startAngle,
  );
}
function onArc(point: { x: number; y: number }, arc: ResolvedArc) {
  return (
    !!arcEndpoint(point, arc) ||
    arcParameter(point, arc) <= arc.sweep + EPS / arc.radius
  );
}
function pointLineDistance(
  point: { x: number; y: number },
  line: ResolvedLine,
) {
  const dx = line.end.x - line.start.x,
    dy = line.end.y - line.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distance(point, line.start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - line.start.x - t * dx,
    point.y - line.start.y - t * dy,
  );
}
function closedCurveOwners(
  lines: ResolvedLine[],
  arcs: ResolvedArc[],
  key: (p: { x: number; y: number }) => string,
) {
  const curves = [...lines, ...arcs],
    byId = new Map(curves.map((c) => [c.id, c]));
  const fans = new Map<string, string[]>();
  for (const c of curves)
    for (const p of [c.start, c.end]) {
      const at = key(p),
        fan = fans.get(at) ?? [];
      fan.push(c.id);
      fans.set(at, fan);
    }
  const unseen = new Set(byId.keys()),
    owners = new Map<string, string>();
  while (unseen.size) {
    const pending = [unseen.values().next().value!],
      component: string[] = [];
    let closed = true;
    while (pending.length) {
      const id = pending.pop()!;
      if (!unseen.delete(id)) continue;
      component.push(id);
      const curve = byId.get(id)!;
      for (const p of [curve.start, curve.end]) {
        const fan = fans.get(key(p))!;
        closed &&= fan.length === 2;
        for (const other of fan) if (unseen.has(other)) pending.push(other);
      }
    }
    if (closed) for (const id of component) owners.set(id, component[0]);
  }
  return owners;
}
/** Curved-boundary intersections remain unsupported; shared authored arc
 * endpoints are allowed so ordinary rounded closed profiles retain their meaning. */
function unsupportedCurveContact(curves: ResolvedCircle[]): string | undefined {
  const fail = (a: ResolvedCircle, b: ResolvedCircle) =>
    `Curved boundaries "${a.id}" and "${b.id}" intersect or overlap. Arc/arc and circle/arc intersection fragmentation is unsupported; separate the boundaries.`;
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i],
        b = curves[j];
      if (!isArc(a) && !isArc(b)) continue;
      const d = distance(a.center, b.center);
      if (d <= EPS && Math.abs(a.radius - b.radius) <= EPS) {
        if (!isArc(a) || !isArc(b)) return fail(a, b);
        const angles = [
          0,
          turn,
          ...[
            a.startAngle,
            a.startAngle + a.sweep,
            b.startAngle,
            b.startAngle + b.sweep,
          ].map(wrapAngle),
        ].sort((x, y) => x - y);
        for (let n = 1; n < angles.length; n++) {
          const t = (angles[n - 1] + angles[n]) / 2;
          const p = {
            x: a.center.x + a.radius * Math.cos(t),
            y: a.center.y + a.radius * Math.sin(t),
          };
          const ta = arcParameter(p, a),
            tb = arcParameter(p, b);
          if (
            ta > EPS / a.radius &&
            ta < a.sweep - EPS / a.radius &&
            tb > EPS / b.radius &&
            tb < b.sweep - EPS / b.radius
          )
            return fail(a, b);
        }
        continue;
      }
      if (
        d > a.radius + b.radius + EPS ||
        d < Math.abs(a.radius - b.radius) - EPS ||
        d <= EPS
      )
        continue;
      const along =
        ((a.radius - b.radius) * (a.radius + b.radius) + d * d) / (2 * d);
      const radicand = a.radius * a.radius - along * along;
      if (radicand < -2 * EPS * a.radius) return fail(a, b);
      const h = Math.sqrt(Math.max(0, radicand)),
        ux = (b.center.x - a.center.x) / d,
        uy = (b.center.y - a.center.y) / d;
      for (const sign of [-1, 1]) {
        const p = {
          x: a.center.x + along * ux - sign * h * uy,
          y: a.center.y + along * uy + sign * h * ux,
        };
        if ((isArc(a) && !onArc(p, a)) || (isArc(b) && !onArc(p, b))) continue;
        if (isArc(a) && isArc(b) && arcEndpoint(p, a) && arcEndpoint(p, b))
          continue;
        return fail(a, b);
      }
    }
}
