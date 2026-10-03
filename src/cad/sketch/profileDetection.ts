import {
  ResolvedArc,
  ResolvedCircle,
  ResolvedLine,
  ResolvedSketch,
} from "./SketchSolver";

import { fragmentCurvedProfiles } from "./curvedFragmentation";
import { SKETCH_TOLERANCE } from "./tolerances";
import { extractLineFaces, fragmentProfileLines } from "./lineFragmentation";

const PROFILE_EPSILON = SKETCH_TOLERANCE;

export interface SketchProfile {
  id: string;
  sketchId: string;
  outerLoop: ProfileLoop;
  innerLoops: ProfileLoop[];
  holes: ProfileHole[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  signature: string;
  alternateIds?: string[];
}

export type ProfileSegment =
  | {
      type: "line";
      id: string;
      sourceEntityId?: string;
      start: { x: number; y: number };
      end: { x: number; y: number };
    }
  | {
      type: "arc";
      id: string;
      start: { x: number; y: number };
      end: { x: number; y: number };
      center: { x: number; y: number };
      radius: number;
      startAngle: number;
      sweep: number;
    };

export interface ProfileLoop {
  segments?: ProfileSegment[];
  entityIds: string[];
  type: "polygon" | "circle";
  role?: "outer" | "inner";
  lineageIds?: string[];
}

export interface ProfileHole {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface ProfileDetectionResult {
  profiles: SketchProfile[];
  errors: string[];
}

export function detectProfiles(sketch: ResolvedSketch): ProfileDetectionResult {
  if (sketch.errors.length)
    return { profiles: [], errors: sketch.errors.map((e) => e.message) };
  let arcs = (sketch.arcs ?? []).filter((a) => !a.construction);
  let arcBySegment = new Map<string, ResolvedArc>();
  let curvedLineage: Map<string, string> | undefined;
  let curved = false;
  const authoredLines = sketch.lines.filter((l) => !l.construction);
  const authoredCircles = sketch.circles.filter((c) => !c.construction);
  let sourceKey: ReturnType<typeof clusterPointKeys> | undefined;
  if (authoredLines.length && (authoredCircles.length || arcs.length)) {
    const initialKey = clusterPointKeys([
      ...authoredLines,
      ...arcs.map((arc) => ({ id: arc.id, start: arc.start, end: arc.end })),
    ]);
    // Legacy arc traversal adds sampled points, which need a new cluster map.
    sourceKey = arcs.length ? undefined : initialKey;
    const errors = validateDirtyGeometry(
      authoredLines,
      [],
      initialKey,
      true,
    ).concat(validateDirtyGeometry([], authoredCircles, initialKey));
    if (errors.length) return { profiles: [], errors };
    const result = fragmentCurvedProfiles(
      authoredLines,
      authoredCircles,
      arcs,
      initialKey,
      sampleArc,
    );
    if (result.errors.length) return { profiles: [], errors: result.errors };
    if (result.handled) {
      curved = true;
      curvedLineage = result.lineage;
      arcBySegment = result.arcs;
      sketch = { ...sketch, lines: result.lines, circles: result.circles };
      arcs = [];
    }
  }
  const lines = sketch.lines.filter((l) => !l.construction);
  for (const arc of arcs) {
    const samples = sampleArc(arc);
    for (let i = 1; i < samples.length; i++) {
      const id = `${arc.id}~${i}`;
      arcBySegment.set(id, arc);
      lines.push({
        id,
        start: { id: `${id}:a`, ...samples[i - 1] },
        end: { id: `${id}:b`, ...samples[i] },
      });
    }
  }
  sketch = {
    ...sketch,
    lines,
    circles: sketch.circles.filter((c) => !c.construction),
  };
  const errors: string[] = [];
  let keyForPoint = !curved && sourceKey ? sourceKey : clusterPointKeys(sketch.lines);
  const dirtyGeometry = curved || sourceKey
    ? []
    : validateDirtyGeometry(
        sketch.lines,
        sketch.circles,
        keyForPoint,
        arcs.length === 0,
      );
  if (dirtyGeometry.length > 0) return { profiles: [], errors: dirtyGeometry };

  let fragmented = curved;
  let lineage = curvedLineage ?? new Map(sketch.lines.map((l) => [l.id, l.id]));
  if (!arcs.length && !curved) {
    const result = fragmentProfileLines(sketch.lines, keyForPoint);
    if (result.errors.length) return { profiles: [], errors: result.errors };
    sketch = { ...sketch, lines: result.lines };
    lineage = result.lineage;
    keyForPoint = clusterPointKeys(sketch.lines);
    const degrees = new Map<string, number>();
    for (const line of sketch.lines)
      for (const p of [line.start, line.end])
        degrees.set(keyForPoint(p), (degrees.get(keyForPoint(p)) ?? 0) + 1);
    fragmented = result.changed || [...degrees.values()].some((n) => n > 2);
  }
  const lineLoops = fragmented
    ? fragmentedLoops(sketch.lines, keyForPoint, lineage, errors, arcBySegment)
    : extractLineLoops(
        sketch.lines,
        errors,
        keyForPoint,
        (id) => !arcBySegment.has(id) || id === `${arcBySegment.get(id)!.id}~1`,
      );
  for (const loop of lineLoops) {
    loop.entityIds = [
      ...new Set(loop.entityIds.map((id) => arcBySegment.get(id)?.id ?? id)),
    ];
    loop.key = stableHash([...loop.entityIds].sort().join("|"));
    const segments: ProfileSegment[] = [];
    for (const segment of loop.segments) {
      const arc = arcBySegment.get(segment.id);
      if (!arc) {
        segments.push(segment);
        continue;
      }
      if (segments.at(-1)?.id === arc.id) continue;
      const forward = distance(segment.start, arc.start) < PROFILE_EPSILON;
      segments.push({
        type: "arc",
        id: arc.id,
        center: arc.center,
        radius: arc.radius,
        start: forward ? arc.start : arc.end,
        end: forward ? arc.end : arc.start,
        startAngle: forward ? arc.startAngle : arc.startAngle + arc.sweep,
        sweep: forward ? arc.sweep : -arc.sweep,
      });
    }
    loop.segments = segments;
  }
  const profiles: SketchProfile[] = [];

  if (lineLoops.length > 0) {
    const orderedLoops = lineLoops.sort(
      (a, b) => loopAreaAbs(b) - loopAreaAbs(a),
    );
    const profileLoops = orderedLoops.filter(
      (loop) => loopDepth(loop, orderedLoops) % 2 === 0,
    );
    const allowLegacyRectangleAlias = profileLoops.length === 1;
    for (const loop of orderedLoops) {
      if (!profileLoops.some((profileLoop) => profileLoop.key === loop.key))
        continue;
      const innerLineLoops = orderedLoops.filter(
        (candidate) =>
          candidate.key !== loop.key &&
          loopDepth(candidate, orderedLoops) ===
            loopDepth(loop, orderedLoops) + 1 &&
          loopContainsLoop(loop, candidate),
      );
      const insideCircles = sketch.circles.filter(
        (circle) =>
          circleInsideLoop(circle, loop) &&
          !innerLineLoops.some((inner) =>
            pointInPolygon(circle.center, inner.points),
          ),
      );
      const profile = createProfile(
        sketch.id,
        loop,
        [
          ...innerLineLoops.map((inner) => createPolygonLoop(inner, "inner")),
          ...insideCircles.map((circle) => createCircleLoop(circle, "inner")),
        ],
        insideCircles,
        allowLegacyRectangleAlias,
      );
      profiles.push(profile);
    }
    const consumedCircles = new Set(
      profiles.flatMap((profile) =>
        profile.innerLoops
          .filter((loop) => loop.type === "circle")
          .flatMap((loop) => loop.entityIds),
      ),
    );
    profiles.push(
      ...createCircleProfiles(
        sketch.id,
        sketch.circles.filter((circle) => !consumedCircles.has(circle.id)),
      ),
    );
    return {
      profiles: profiles.sort((a, b) => a.id.localeCompare(b.id)),
      errors,
    };
  }

  if (sketch.lines.length > 0) {
    if (errors.length === 0)
      errors.push(describeUnsupportedLines(sketch.lines, sketch.circles));
    return { profiles, errors };
  }

  profiles.push(...createCircleProfiles(sketch.id, sketch.circles));

  return {
    profiles: profiles.sort((a, b) => a.id.localeCompare(b.id)),
    errors,
  };
}

interface LineLoop {
  key: string;
  segments: ProfileSegment[];
  entityIds: string[];
  lineageIds?: string[];
  points: { x: number; y: number }[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  centroid: { x: number; y: number };
  signedArea: number;
}

function validateDirtyGeometry(
  lines: ResolvedLine[],
  circles: ResolvedCircle[],
  keyForPoint: (point: { x: number; y: number }) => string,
  allowLineIntersections = false,
): string[] {
  const errors: string[] = [];
  const segments = new Set<string>();
  for (const line of lines) {
    if (distance(line.start, line.end) <= PROFILE_EPSILON)
      errors.push(
        `Line "${line.id}" is zero-length and cannot form a profile.`,
      );
    const key = segmentKey(line, keyForPoint);
    if (segments.has(key))
      errors.push(
        `Line "${line.id}" duplicates or overlaps another sketch segment.`,
      );
    segments.add(key);
  }
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (
        !allowLineIntersections &&
        segmentsCross(lines[i], lines[j], keyForPoint)
      )
        errors.push(
          `Lines "${lines[i].id}" and "${lines[j].id}" intersect outside shared endpoints.`,
        );
      if (segmentsOverlap(lines[i], lines[j], keyForPoint))
        errors.push(
          `Lines "${lines[i].id}" and "${lines[j].id}" overlap and cannot form a clean profile.`,
        );
    }
  }
  for (const circle of circles) {
    if (circle.radius <= 0)
      errors.push(`Circle "${circle.id}" has a non-positive radius.`);
  }
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i],
        b = circles[j],
        d = distance(a.center, b.center);
      if (
        d <= a.radius + b.radius + PROFILE_EPSILON &&
        d >= Math.abs(a.radius - b.radius) - PROFILE_EPSILON
      )
        errors.push(
          `Circles "${a.id}" and "${b.id}" touch or intersect; fragment the boundaries before extrusion.`,
        );
    }
  for (const circle of circles)
    for (const line of lines) {
      const nearest = pointSegmentDistance(circle.center, line.start, line.end),
        farthest = Math.max(
          distance(circle.center, line.start),
          distance(circle.center, line.end),
        );
      if (
        nearest <= circle.radius + PROFILE_EPSILON &&
        farthest >= circle.radius - PROFILE_EPSILON
      )
        errors.push(
          `Circle "${circle.id}" intersects or touches a line/arc boundary; fragment the boundaries before extrusion.`,
        );
    }
  return [...new Set(errors)];
}

function fragmentedLoops(
  lines: ResolvedLine[],
  key: (point: { x: number; y: number }) => string,
  lineage: Map<string, string>,
  errors: string[],
  arcBySegment = new Map<string, ResolvedArc>(),
): LineLoop[] {
  const result = extractLineFaces(lines, key, (line, start, end) => {
    const arc = arcBySegment.get(line.id);
    if (!arc) return Math.atan2(end.y - start.y, end.x - start.x);
    const forward = start.id === line.start.id;
    return (
      Math.atan2(start.y - arc.center.y, start.x - arc.center.x) +
      (forward ? 1 : -1) * Math.sign(arc.sweep) * Math.PI / 2
    );
  });
  errors.push(...result.errors);
  return result.faces.flatMap((face): LineLoop[] => {
    // A restored analytic arc cannot straddle the traversal seam.
    const boundary = face.lines.findIndex((l) => {
      const arc = arcBySegment.get(l.id);
      return (
        !arc ||
        distance(l.start, arc.start) < PROFILE_EPSILON ||
        distance(l.start, arc.end) < PROFILE_EPSILON
      );
    });
    if (boundary < 0) {
      errors.push("Curved profile traversal could not find a complete analytic arc boundary. Repair the sketch before modeling.");
      return [];
    }
    const boundaryLines = [...face.lines.slice(boundary), ...face.lines.slice(0, boundary)];
    const points = boundaryLines.map(l => l.start);
    const entityIds = boundaryLines.map((l) => l.id),
      signedArea = polygonArea(points);
    return [{
      key: stableHash([...entityIds].sort().join("|")),
      entityIds,
      lineageIds: [...new Set(entityIds.map((id) => lineage.get(id)!))].sort(),
      segments: boundaryLines.map((l) => ({
        type: "line" as const,
        id: l.id,
        sourceEntityId: lineage.get(l.id),
        start: l.start,
        end: l.end,
      })),
      points,
      bounds: boundsForPoints(points),
      centroid: polygonCentroid(points, signedArea),
      signedArea,
    }];
  });
}

function extractLineLoops(
  lines: ResolvedLine[],
  errors: string[],
  keyForPoint: (point: { x: number; y: number }) => string,
  isEntityBoundary: (id: string) => boolean,
): LineLoop[] {
  if (lines.length === 0) return [];
  const byPoint = new Map<string, ResolvedLine[]>();
  const lineById = new Map(lines.map((line) => [line.id, line]));
  for (const line of lines) {
    for (const point of [line.start, line.end]) {
      const key = keyForPoint(point);
      const connected = byPoint.get(key);
      if (connected) {
        connected.push(line);
      } else {
        byPoint.set(key, [line]);
      }
    }
  }
  const openVertices = [...byPoint.entries()].filter(([, connected]) => connected.length !== 2);
  if (openVertices.length > 0) {
    errors.push("Sketch contains an open profile or T-junction. Every line-loop vertex must connect exactly two line segments.");
    return [];
  }
  const unused = new Set(lines.map((line) => line.id));
  const loops: LineLoop[] = [];
  while (unused.size > 0) {
    // Begin at an analytic entity boundary so an arc never spans the seam.
    const firstId = [...unused].find(isEntityBoundary);
    if (!firstId) {
      errors.push(
        "Profile traversal could not find an unfragmented entity boundary.",
      );
      return [];
    }
    const first = firstId ? lineById.get(firstId) : undefined;
    if (!first) break;
    const entityIds = [first.id];
    const segments: ProfileSegment[] = [
      { type: "line", id: first.id, start: first.start, end: first.end },
    ];
    const points = [first.start, first.end];
    unused.delete(first.id);
    let previous = first;
    let currentKey = keyForPoint(first.end);
    const startKey = keyForPoint(first.start);
    while (currentKey !== startKey) {
      const next = (byPoint.get(currentKey) ?? []).find((line) => line.id !== previous.id && unused.has(line.id));
      if (!next) {
        errors.push("Sketch contains an open profile. Add the missing edge before extruding.");
        return [];
      }
      entityIds.push(next.id);
      unused.delete(next.id);
      const nextPoint =
        keyForPoint(next.start) === currentKey ? next.end : next.start;
      segments.push({
        type: "line",
        id: next.id,
        start: points.at(-1)!,
        end: nextPoint,
      });
      points.push(nextPoint);
      previous = next;
      currentKey = keyForPoint(nextPoint);
    }
    const polygon = points.slice(0, -1);
    const signedArea = polygonArea(polygon);
    if (Math.abs(signedArea) <= PROFILE_EPSILON * PROFILE_EPSILON) {
      errors.push("Sketch contains a zero-area loop and cannot form a profile.");
      continue;
    }
    loops.push({
      key: stableHash([...entityIds].sort().join("|")),
      segments,
      entityIds: [...entityIds],
      points: polygon,
      bounds: boundsForPoints(polygon),
      centroid: polygonCentroid(polygon, signedArea),
      signedArea,
    });
  }
  return loops;
}

function createProfile(
  sketchId: string,
  outer: LineLoop,
  innerLoops: ProfileLoop[],
  holeCircles: ResolvedCircle[],
  allowLegacyRectangleAlias: boolean,
): SketchProfile {
  const signature = profileSignature(createPolygonLoop(outer, "outer"), innerLoops);
  return {
    id: `${sketchId}:profile:${signature}`,
    sketchId,
    outerLoop: createPolygonLoop(outer, "outer"),
    innerLoops,
    holes: holeCircles.map(circleToHole),
    bounds: outer.bounds,
    signature,
    alternateIds:
      allowLegacyRectangleAlias && isAxisAlignedRectangle(outer)
        ? [`${sketchId}:profile:rectangle`]
        : undefined,
  };
}

function createCircleProfile(sketchId: string, circle: ResolvedCircle, innerCircles: ResolvedCircle[]): SketchProfile {
  const bounds = circleBounds(circle);
  const outerLoop = createCircleLoop(circle, "outer");
  const innerLoops = innerCircles.map((inner) => createCircleLoop(inner, "inner"));
  const signature = profileSignature(outerLoop, innerLoops);
  return {
    id: `${sketchId}:profile:${signature}`,
    sketchId,
    outerLoop,
    innerLoops,
    holes: innerCircles.map(circleToHole),
    bounds,
    signature,
    alternateIds: [`${sketchId}:profile:${circle.id}`],
  };
}

function createCircleProfiles(sketchId: string, circles: ResolvedCircle[]): SketchProfile[] {
  const orderedCircles = [...circles].sort((a, b) => b.radius - a.radius);
  return orderedCircles
    .filter((circle) => circleDepth(circle, orderedCircles) % 2 === 0)
    .map((circle) => {
      const depth = circleDepth(circle, orderedCircles);
      const innerCircles = orderedCircles.filter((candidate) => candidate.id !== circle.id && circleDepth(candidate, orderedCircles) === depth + 1 && circleContainsCircle(circle, candidate));
      return createCircleProfile(sketchId, circle, innerCircles);
    });
}

function createPolygonLoop(
  loop: LineLoop,
  role: "outer" | "inner",
): ProfileLoop {
  return {
    entityIds: [...loop.entityIds].sort(),
    type: "polygon",
    role,
    lineageIds: loop.lineageIds ?? [...loop.entityIds].sort(),
    segments: loop.segments,
  };
}

function createCircleLoop(circle: ResolvedCircle, role: "outer" | "inner"): ProfileLoop {
  return { entityIds: [circle.id], type: "circle", role, lineageIds: [circle.id] };
}

function circleToHole(circle: ResolvedCircle): ProfileHole {
  return { id: circle.id, x: circle.center.x, y: circle.center.y, radius: circle.radius };
}

function circleInsideLoop(circle: ResolvedCircle, loop: LineLoop): boolean {
  if (!pointInPolygon(circle.center, loop.points)) return false;
  if (
    circle.center.x - circle.radius <= loop.bounds.minX ||
    circle.center.x + circle.radius >= loop.bounds.maxX ||
    circle.center.y - circle.radius <= loop.bounds.minY ||
    circle.center.y + circle.radius >= loop.bounds.maxY
  ) {
    return false;
  }
  return loop.points.every((point, index) => {
    const next = loop.points[(index + 1) % loop.points.length];
    return (
      pointSegmentDistance(circle.center, point, next) >=
      circle.radius - PROFILE_EPSILON
    );
  });
}

function describeUnsupportedLines(lines: ResolvedLine[], circles: ResolvedCircle[]): string {
  if (circles.length > 0) return "Sketch has circles but no supported closed outer profile.";
  if (lines.length < 4) return "Sketch contains an open profile. Add the missing edges before extruding.";
  return "Sketch does not contain a supported closed profile.";
}

function round(value: number): number {
  return Math.round(value / PROFILE_EPSILON) * PROFILE_EPSILON;
}

// Neighbouring spatial cells are checked by distance, so near-coincident
// vertices on opposite rounding boundaries still have one graph identity.
function clusterPointKeys(
  lines: ResolvedLine[],
): (point: { x: number; y: number }) => string {
  const keys = new Map<object, string>(),
    cells = new Map<
      string,
      Array<{ point: { x: number; y: number }; key: string }>
    >();
  const points = lines
    .flatMap((l) => [l.start, l.end])
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  let next = 0;
  for (const point of points) {
    if (keys.has(point)) continue;
    const cx = Math.floor(point.x / PROFILE_EPSILON),
      cy = Math.floor(point.y / PROFILE_EPSILON);
    let match: string | undefined;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const entry of cells.get(`${cx + dx}:${cy + dy}`) ?? [])
          if (distance(point, entry.point) <= PROFILE_EPSILON)
            match ??= entry.key;
    if (!match) {
      match = `vertex:${next++}`;
      const cell = `${cx}:${cy}`,
        entries = cells.get(cell) ?? [];
      entries.push({ point, key: match });
      cells.set(cell, entries);
    }
    keys.set(point, match);
  }
  return (point) => {
    const key = keys.get(point);
    if (key === undefined)
      throw new Error("Profile traversal references an unregistered vertex.");
    return key;
  };
}

function segmentKey(
  line: ResolvedLine,
  keyForPoint: (point: { x: number; y: number }) => string,
): string {
  return [keyForPoint(line.start), keyForPoint(line.end)].sort().join("|");
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(
  a: ResolvedLine,
  b: ResolvedLine,
  keyForPoint: (point: { x: number; y: number }) => string,
): boolean {
  const shared = [keyForPoint(a.start), keyForPoint(a.end)].some(
    (key) => key === keyForPoint(b.start) || key === keyForPoint(b.end),
  );
  if (shared) return false;
  const o1 = orientation(a.start, a.end, b.start);
  const o2 = orientation(a.start, a.end, b.end);
  const o3 = orientation(b.start, b.end, a.start);
  const o4 = orientation(b.start, b.end, a.end);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function segmentsOverlap(
  a: ResolvedLine,
  b: ResolvedLine,
  keyForPoint: (point: { x: number; y: number }) => string,
): boolean {
  if (Math.abs(orientation(a.start, a.end, b.start)) > PROFILE_EPSILON || Math.abs(orientation(a.start, a.end, b.end)) > PROFILE_EPSILON) return false;
  const shared = [keyForPoint(a.start), keyForPoint(a.end)].filter(
    (key) => key === keyForPoint(b.start) || key === keyForPoint(b.end),
  );
  if (shared.length === 2) return false;
  const xOverlap = Math.max(Math.min(a.start.x, a.end.x), Math.min(b.start.x, b.end.x)) < Math.min(Math.max(a.start.x, a.end.x), Math.max(b.start.x, b.end.x)) - PROFILE_EPSILON;
  const yOverlap = Math.max(Math.min(a.start.y, a.end.y), Math.min(b.start.y, b.end.y)) < Math.min(Math.max(a.start.y, a.end.y), Math.max(b.start.y, b.end.y)) - PROFILE_EPSILON;
  return Math.abs(a.start.x - a.end.x) >= Math.abs(a.start.y - a.end.y) ? xOverlap : yOverlap;
}

function pointSegmentDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= PROFILE_EPSILON * PROFILE_EPSILON) return distance(point, start);
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function polygonArea(points: { x: number; y: number }[]): number {
  const origin = points[0];
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + (point.x - origin.x) * (next.y - origin.y) - (next.x - origin.x) * (point.y - origin.y);
    }, 0) / 2
  );
}

function loopAreaAbs(loop: LineLoop): number {
  return Math.abs(loop.signedArea);
}

function boundsForPoints(points: { x: number; y: number }[]): LineLoop["bounds"] {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function polygonCentroid(points: { x: number; y: number }[], signedArea: number): { x: number; y: number } {
  const origin = points[0];
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const px = point.x - origin.x, py = point.y - origin.y,
      nx = next.x - origin.x, ny = next.y - origin.y;
    const factor = px * ny - nx * py;
    x += (px + nx) * factor;
    y += (py + ny) * factor;
  }
  const divisor = 6 * signedArea;
  return { x: origin.x + x / divisor, y: origin.y + y / divisor };
}

function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function loopContainsPoint(
  loop: LineLoop,
  point: { x: number; y: number },
): boolean {
  return (
    pointInBounds(point, loop.bounds) && pointInPolygon(point, loop.points)
  );
}

function loopContainsLoop(parent: LineLoop, child: LineLoop): boolean {
  return (
    loopAreaAbs(parent) > loopAreaAbs(child) &&
    child.points.every((point) => loopContainsPoint(parent, point))
  );
}

function pointInBounds(
  point: { x: number; y: number },
  bounds: LineLoop["bounds"],
): boolean {
  return (
    point.x > bounds.minX &&
    point.x < bounds.maxX &&
    point.y > bounds.minY &&
    point.y < bounds.maxY
  );
}

function loopDepth(loop: LineLoop, loops: LineLoop[]): number {
  return loops.filter((candidate) => candidate.key !== loop.key && loopContainsLoop(candidate, loop)).length;
}

function circleBounds(circle: ResolvedCircle): LineLoop["bounds"] {
  return {
    minX: circle.center.x - circle.radius,
    maxX: circle.center.x + circle.radius,
    minY: circle.center.y - circle.radius,
    maxY: circle.center.y + circle.radius,
  };
}

function circleContainsCircle(parent: ResolvedCircle, child: ResolvedCircle): boolean {
  return distance(parent.center, child.center) + child.radius < parent.radius;
}

function circleDepth(circle: ResolvedCircle, circles: ResolvedCircle[]): number {
  return circles.filter((candidate) => candidate.id !== circle.id && candidate.radius > circle.radius && circleContainsCircle(candidate, circle)).length;
}

function profileSignature(
  outerLoop: ProfileLoop,
  innerLoops: ProfileLoop[],
): string {
  const parts = [
    outerLoop.type,
    [...outerLoop.entityIds].sort().join(","),
    ...innerLoops
      .map((loop) => `${loop.type}:${[...loop.entityIds].sort().join(",")}`)
      .sort(),
  ];
  return stableHash(parts.join("|"));
}

function isAxisAlignedRectangle(loop: LineLoop): boolean {
  if (loop.points.length !== 4 || loop.entityIds.length !== 4) return false;
  const xs = [...new Set(loop.points.map((point) => round(point.x)))];
  const ys = [...new Set(loop.points.map((point) => round(point.y)))];
  return xs.length === 2 && ys.length === 2;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `p${(hash >>> 0).toString(36)}`;
}

export function sampleArc(arc: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  center: { x: number; y: number };
  radius: number;
  startAngle: number;
  sweep: number;
}): { x: number; y: number }[] {
  const count = Math.max(2, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 64)));
  return Array.from({ length: count + 1 }, (_, i) =>
    i === 0
      ? arc.start
      : i === count
        ? arc.end
        : {
            x:
              arc.center.x +
              arc.radius * Math.cos(arc.startAngle + (arc.sweep * i) / count),
            y:
              arc.center.y +
              arc.radius * Math.sin(arc.startAngle + (arc.sweep * i) / count),
          },
  );
}
