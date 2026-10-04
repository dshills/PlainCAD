import { ShapeUtils, Vector2 } from "three";
import {
  ProfileLoop,
  ProfileSegment,
  SketchProfile,
  sampleArc,
} from "../sketch/profileDetection";
import {
  SketchPlaneTransform,
  transformPoint,
  sketchVectorToWorld,
} from "../sketch/planes";
import { RenderMesh } from "./KernelAdapter";
import { computeNormals } from "./meshConversion";

export function loopPoints(
  loop: ProfileLoop,
  profile: SketchProfile,
): { x: number; y: number }[] {
  if (loop.type === "circle") {
    const hole = profile.holes.find((h) => loop.entityIds.includes(h.id));
    if (loop !== profile.outerLoop && !hole)
      throw new Error(
        "Inner circle profile is missing its center and radius geometry.",
      );
    const r = hole?.radius ?? (profile.bounds.maxX - profile.bounds.minX) / 2;
    const x = hole?.x ?? (profile.bounds.maxX + profile.bounds.minX) / 2,
      y = hole?.y ?? (profile.bounds.maxY + profile.bounds.minY) / 2;
    return Array.from({ length: 128 }, (_, i) => ({
      x: x + r * Math.cos((i * Math.PI) / 64),
      y: y + r * Math.sin((i * Math.PI) / 64),
    }));
  }
  if (!loop.segments?.length)
    throw new Error("Polygon profile is missing its boundary geometry.");
  return loop.segments.flatMap((segment) =>
    segment.type === "line" ? [segment.start] : sampleArc(segment).slice(0, -1),
  );
}
export function signedArea(points: { x: number; y: number }[]): number {
  return (
    points.reduce((s, p, i) => {
      const q = points[(i + 1) % points.length];
      return s + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );
}
export function orientedSegments(
  loop: ProfileLoop,
  clockwise: boolean,
): ProfileSegment[] {
  const segments = loop.segments ?? [];
  const pts = segments.flatMap((s) =>
    s.type === "line" ? [s.start] : sampleArc(s).slice(0, -1),
  );
  if (signedArea(pts) < 0 === clockwise) return segments;
  return [...segments].reverse().map((s) =>
    s.type === "line"
      ? { ...s, start: s.end, end: s.start }
      : {
          ...s,
          start: s.end,
          end: s.start,
          startAngle: s.startAngle + s.sweep,
          sweep: -s.sweep,
        },
  );
}
export function extrudedProfileMesh(
  id: string,
  profile: SketchProfile,
  depth: number,
  transform: SketchPlaneTransform,
): RenderMesh {
  if (!Number.isFinite(depth) || depth <= 0)
    throw new Error("Extrude distance must be a positive finite length.");
  const orient = (p: { x: number; y: number }[], clockwise: boolean) =>
    signedArea(p) < 0 === clockwise ? p : [...p].reverse();
  const outer = orient(loopPoints(profile.outerLoop, profile), false),
    holes = profile.innerLoops.map((l) => orient(loopPoints(l, profile), true));
  const loops = [outer, ...holes],
    flat = loops.flat();
  const positions: number[] = [],
    indices: number[] = [];
  for (const z of [0, depth])
    for (const p of flat) {
      const w = transformPoint(transform, p.x, p.y, z);
      positions.push(w.x, w.y, w.z);
    }
  const n = flat.length;
  for (const [a, b, c] of ShapeUtils.triangulateShape(
    outer.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y))),
  ))
    indices.push(c, b, a, a + n, b + n, c + n);
  let offset = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = offset + i,
        b = offset + ((i + 1) % loop.length);
      indices.push(a, b, b + n, a, b + n, a + n);
    }
    offset += loop.length;
  }
  // Keep cap/wall normals distinct; shared vertices would smooth hard edges.
  const facePositions = indices.flatMap((index) =>
    positions.slice(index * 3, index * 3 + 3),
  );
  const faceIndices = indices.map((_, index) => index);
  return {
    id,
    bodyId: id,
    positions: facePositions,
    normals: computeNormals(facePositions, faceIndices),
    indices: faceIndices,
    bounds: meshBounds(facePositions),
  };
}
export function meshBounds(positions: ArrayLike<number>): RenderMesh["bounds"] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity],
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], positions[i]);
    max[axis] = Math.max(max[axis], positions[i]);
  }
  return { min, max };
}
export function transformProfileMesh(
  mesh: RenderMesh,
  transform: SketchPlaneTransform,
): RenderMesh {
  const positions: number[] = [],
    normals: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = transformPoint(
      transform,
      mesh.positions[i],
      mesh.positions[i + 1],
      mesh.positions[i + 2],
    );
    positions.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const p = sketchVectorToWorld(
      transform,
      mesh.normals[i],
      mesh.normals[i + 1],
      mesh.normals[i + 2],
    );
    normals.push(p.x, p.y, p.z);
  }
  return { ...mesh, positions, normals, bounds: meshBounds(positions) };
}

/** Original authored boundary roles, including analytic circles without segments. */
export function authoredBoundarySegments(
  profile: SketchProfile,
): ProfileSegment[] {
  return [profile.outerLoop, ...profile.innerLoops].flatMap((loop) => {
    if (loop.type !== "circle")
      return orientedSegments(loop, loop !== profile.outerLoop);
    const hole = profile.holes.find((item) => loop.entityIds.includes(item.id));
    if (loop !== profile.outerLoop && !hole)
      throw new Error("Inner circle profile lost its geometry.");
    const center = hole
      ? { x: hole.x, y: hole.y }
      : {
          x: (profile.bounds.minX + profile.bounds.maxX) / 2,
          y: (profile.bounds.minY + profile.bounds.maxY) / 2,
        };
    const radius =
        hole?.radius ?? (profile.bounds.maxX - profile.bounds.minX) / 2,
      id = loop.entityIds[0];
    if (!id) throw new Error("Circle perimeter lost its source entity.");
    const start = { x: center.x + radius, y: center.y };
    return [
      {
        type: "arc" as const,
        id,
        start,
        end: start,
        center,
        radius,
        startAngle: 0,
        sweep: Math.PI * 2,
      },
    ];
  });
}
