import { ResolvedCircle, ResolvedLine, ResolvedSketch } from "./SketchSolver";

const PROFILE_EPSILON = 1e-7;

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

export interface ProfileLoop {
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
  const errors: string[] = [];
  const dirtyGeometry = validateDirtyGeometry(sketch.lines, sketch.circles);
  if (dirtyGeometry.length > 0) return { profiles: [], errors: dirtyGeometry };

  const lineLoops = extractLineLoops(sketch.lines, errors);
  const profiles: SketchProfile[] = [];

  if (lineLoops.length > 0) {
    const orderedLoops = lineLoops.sort((a, b) => loopAreaAbs(b) - loopAreaAbs(a));
    const profileLoops = orderedLoops.filter((loop) => loopDepth(loop, orderedLoops) % 2 === 0);
    const allowLegacyRectangleAlias = profileLoops.length === 1;
    for (const loop of orderedLoops) {
      if (!profileLoops.some((profileLoop) => profileLoop.key === loop.key)) continue;
      const innerLineLoops = orderedLoops.filter((candidate) => candidate.key !== loop.key && loopDepth(candidate, orderedLoops) === loopDepth(loop, orderedLoops) + 1 && loopContainsLoop(loop, candidate));
      const insideCircles = sketch.circles.filter((circle) => circleInsideLoop(circle, loop) && !innerLineLoops.some((inner) => pointInPolygon(circle.center, inner.points)));
      const profile = createProfile(sketch.id, loop, [
        ...innerLineLoops.map((inner) => createPolygonLoop(inner, "inner")),
        ...insideCircles.map((circle) => createCircleLoop(circle, "inner")),
      ], insideCircles, allowLegacyRectangleAlias);
      profiles.push(profile);
    }
    const consumedCircles = new Set(profiles.flatMap((profile) => profile.innerLoops.filter((loop) => loop.type === "circle").flatMap((loop) => loop.entityIds)));
    profiles.push(...createCircleProfiles(sketch.id, sketch.circles.filter((circle) => !consumedCircles.has(circle.id))));
    return { profiles: profiles.sort((a, b) => a.id.localeCompare(b.id)), errors };
  }

  if (sketch.lines.length > 0) {
    if (errors.length === 0) errors.push(describeUnsupportedLines(sketch.lines, sketch.circles));
    return { profiles, errors };
  }

  profiles.push(...createCircleProfiles(sketch.id, sketch.circles));

  return { profiles: profiles.sort((a, b) => a.id.localeCompare(b.id)), errors };
}

interface LineLoop {
  key: string;
  entityIds: string[];
  points: { x: number; y: number }[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  centroid: { x: number; y: number };
  signedArea: number;
}

function validateDirtyGeometry(lines: ResolvedLine[], circles: ResolvedCircle[]): string[] {
  const errors: string[] = [];
  const segments = new Set<string>();
  for (const line of lines) {
    if (distance(line.start, line.end) <= PROFILE_EPSILON) errors.push(`Line "${line.id}" is zero-length and cannot form a profile.`);
    const key = segmentKey(line);
    if (segments.has(key)) errors.push(`Line "${line.id}" duplicates or overlaps another sketch segment.`);
    segments.add(key);
  }
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (segmentsCross(lines[i], lines[j])) errors.push(`Lines "${lines[i].id}" and "${lines[j].id}" intersect outside shared endpoints.`);
      if (segmentsOverlap(lines[i], lines[j])) errors.push(`Lines "${lines[i].id}" and "${lines[j].id}" overlap and cannot form a clean profile.`);
    }
  }
  for (const circle of circles) {
    if (circle.radius <= 0) errors.push(`Circle "${circle.id}" has a non-positive radius.`);
  }
  return [...new Set(errors)];
}

function extractLineLoops(lines: ResolvedLine[], errors: string[]): LineLoop[] {
  if (lines.length === 0) return [];
  const byPoint = new Map<string, ResolvedLine[]>();
  const lineById = new Map(lines.map((line) => [line.id, line]));
  for (const line of lines) {
    for (const point of [line.start, line.end]) {
      const key = pointKey(point);
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
    const firstId = unused.values().next().value;
    const first = firstId ? lineById.get(firstId) : undefined;
    if (!first) break;
    const entityIds = [first.id];
    const points = [first.start, first.end];
    unused.delete(first.id);
    let previous = first;
    let currentKey = pointKey(first.end);
    const startKey = pointKey(first.start);
    while (currentKey !== startKey) {
      const next = (byPoint.get(currentKey) ?? []).find((line) => line.id !== previous.id && unused.has(line.id));
      if (!next) {
        errors.push("Sketch contains an open profile. Add the missing edge before extruding.");
        return [];
      }
      entityIds.push(next.id);
      unused.delete(next.id);
      const nextPoint = pointKey(next.start) === currentKey ? next.end : next.start;
      points.push(nextPoint);
      previous = next;
      currentKey = pointKey(nextPoint);
    }
    const polygon = points.slice(0, -1);
    const signedArea = polygonArea(polygon);
    if (Math.abs(signedArea) <= PROFILE_EPSILON * PROFILE_EPSILON) {
      errors.push("Sketch contains a zero-area loop and cannot form a profile.");
      continue;
    }
    loops.push({
      key: stableHash(entityIds.sort().join("|")),
      entityIds: [...entityIds],
      points: polygon,
      bounds: boundsForPoints(polygon),
      centroid: polygonCentroid(polygon, signedArea),
      signedArea,
    });
  }
  return loops;
}

function createProfile(sketchId: string, outer: LineLoop, innerLoops: ProfileLoop[], holeCircles: ResolvedCircle[], allowLegacyRectangleAlias: boolean): SketchProfile {
  const signature = profileSignature(createPolygonLoop(outer, "outer"), innerLoops);
  return {
    id: `${sketchId}:profile:${signature}`,
    sketchId,
    outerLoop: createPolygonLoop(outer, "outer"),
    innerLoops,
    holes: holeCircles.map(circleToHole),
    bounds: outer.bounds,
    signature,
    alternateIds: allowLegacyRectangleAlias && isAxisAlignedRectangle(outer) ? [`${sketchId}:profile:rectangle`] : undefined,
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

function createPolygonLoop(loop: LineLoop, role: "outer" | "inner"): ProfileLoop {
  return { entityIds: [...loop.entityIds].sort(), type: "polygon", role, lineageIds: [...loop.entityIds].sort() };
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
    return pointSegmentDistance(circle.center, point, next) >= circle.radius - PROFILE_EPSILON;
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

function pointKey(point: { x: number; y: number }): string {
  return `${round(point.x)},${round(point.y)}`;
}

function segmentKey(line: ResolvedLine): string {
  return [pointKey(line.start), pointKey(line.end)].sort().join("|");
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: ResolvedLine, b: ResolvedLine): boolean {
  const shared = [pointKey(a.start), pointKey(a.end)].some((key) => key === pointKey(b.start) || key === pointKey(b.end));
  if (shared) return false;
  const o1 = orientation(a.start, a.end, b.start);
  const o2 = orientation(a.start, a.end, b.end);
  const o3 = orientation(b.start, b.end, a.start);
  const o4 = orientation(b.start, b.end, a.end);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function segmentsOverlap(a: ResolvedLine, b: ResolvedLine): boolean {
  if (Math.abs(orientation(a.start, a.end, b.start)) > PROFILE_EPSILON || Math.abs(orientation(a.start, a.end, b.end)) > PROFILE_EPSILON) return false;
  const shared = [pointKey(a.start), pointKey(a.end)].filter((key) => key === pointKey(b.start) || key === pointKey(b.end));
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
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
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
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const factor = point.x * next.y - next.x * point.y;
    x += (point.x + next.x) * factor;
    y += (point.y + next.y) * factor;
  }
  const divisor = 6 * signedArea;
  return { x: x / divisor, y: y / divisor };
}

function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function loopContainsPoint(loop: LineLoop, point: { x: number; y: number }): boolean {
  return pointInBounds(point, loop.bounds) && pointInPolygon(point, loop.points);
}

function loopContainsLoop(parent: LineLoop, child: LineLoop): boolean {
  return loopAreaAbs(parent) > loopAreaAbs(child) && child.points.every((point) => loopContainsPoint(parent, point));
}

function pointInBounds(point: { x: number; y: number }, bounds: LineLoop["bounds"]): boolean {
  return point.x > bounds.minX && point.x < bounds.maxX && point.y > bounds.minY && point.y < bounds.maxY;
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

function profileSignature(outerLoop: ProfileLoop, innerLoops: ProfileLoop[]): string {
  const parts = [
    outerLoop.type,
    [...outerLoop.entityIds].sort().join(","),
    ...innerLoops.map((loop) => `${loop.type}:${[...loop.entityIds].sort().join(",")}`).sort(),
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
