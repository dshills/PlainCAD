import type { RenderMesh } from "../kernel/KernelAdapter";
import { TESSELLATION_LOD } from "../kernel/tessellationCache";
import type { SketchPlaneChoice } from "./planePicking";
import type { SketchProfile } from "./profileDetection";
import {
  transformPoint,
  worldPointToSketch,
  type SketchPlaneTransform,
} from "./planes";
import { KERNEL_LINEAR_TOLERANCE } from "./tolerances";
export interface FacePoint {
  x: number;
  y: number;
}
export type FaceTriangle = [FacePoint, FacePoint, FacePoint];
/** Actual coplanar native mesh triangles are a placement guide, never a modeling result. */
export function guidedFaceTriangles(
  choice: SketchPlaneChoice,
  mesh: RenderMesh,
): FaceTriangle[] {
  if (typeof choice.reference === "string") return [];
  const faces = new Map([[choice.id, choice.transform]]);
  const triangles: FaceTriangle[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const points = Array.from(mesh.indices.slice(i, i + 3)).map((index) =>
      worldPointToSketch(
        choice.reference,
        {
          x: mesh.positions[index * 3],
          y: mesh.positions[index * 3 + 1],
          z: mesh.positions[index * 3 + 2],
        },
        {},
        faces,
      ),
    );
    if (
      points.length === 3 &&
      points.every(
        (p) =>
          Math.abs(p.z) < 1e-5 && Number.isFinite(p.x) && Number.isFinite(p.y),
      )
    ) {
      const [a, b, c] = points;
      // u × v is the chosen face's outward normal. Opposite-facing triangles
      // on the same plane are not part of this placement surface.
      const signedArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (signedArea > 0) triangles.push([a, b, c]);
    }
  }
  return triangles;
}
export function guidedFaceBounds(triangles: FaceTriangle[]) {
  if (!triangles.length)
    throw new Error(
      "This supported face has no current native placement surface.",
    );
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const triangle of triangles)
    for (const point of triangle) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  const padding = Math.max(maxX - minX, maxY - minY, 1) * 0.12;
  return {
    x: minX - padding,
    y: -maxY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
export function guidedFaceContains(
  triangles: FaceTriangle[],
  point: FacePoint,
) {
  const cross = (a: FacePoint, b: FacePoint) =>
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  return triangles.some(([a, b, c]) => {
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-10) return false;
    const values = [cross(a, b), cross(b, c), cross(c, a)];
    return values.every((v) => v >= -1e-7) || values.every((v) => v <= 1e-7);
  });
}

export interface FaceBoundarySegment {
  points: [FacePoint, FacePoint];
  clearanceAllowance: number;
}
export type FaceBoundary = FaceBoundarySegment[];
/** Only authored straight cap edges establish exact line geometry. Other native
 * boundary chords, including opening edges and side-face contours, stay conservative. */
export function guidedFaceStraightCapEdges(
  choice: SketchPlaneChoice,
  profile: SketchProfile | undefined,
  sketchPlane: SketchPlaneTransform | undefined,
): Array<[FacePoint, FacePoint]> {
  if (typeof choice.reference === "string" || !profile || !sketchPlane)
    return [];
  const reference = choice.reference;
  if (
    !["startCap", "endCap"].some(
      (role) => choice.id === `extrude:${reference.featureId}:${role}`,
    )
  )
    return [];
  const faces = new Map([[choice.id, choice.transform]]);
  return (profile.outerLoop.segments ?? [])
    .filter((segment) => segment.type === "line")
    .map((segment) => {
      const local = (point: FacePoint) =>
        worldPointToSketch(
          choice.reference,
          transformPoint(sketchPlane, point.x, point.y),
          {},
          faces,
        );
      return [local(segment.start), local(segment.end)];
    });
}
/** Native tessellation duplicates vertices across face patches. Neighboring spatial
 * buckets join endpoints within tolerance, including points across a bucket seam.
 * Edges incident to one triangle bound material or an opening. */
export function guidedFaceBoundary(
  triangles: FaceTriangle[],
  straightEdges: Array<[FacePoint, FacePoint]> = [],
): FaceBoundary {
  const vertices = new Map<string, Array<{ id: number; point: FacePoint }>>();
  let nextId = 0;
  const vertexId = (point: FacePoint): number => {
    const x = Math.floor(point.x / KERNEL_LINEAR_TOLERANCE);
    const y = Math.floor(point.y / KERNEL_LINEAR_TOLERANCE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nearby = vertices.get(`${x + dx}:${y + dy}`);
        const match = nearby?.find(
          (candidate) =>
            Math.hypot(
              candidate.point.x - point.x,
              candidate.point.y - point.y,
            ) <= KERNEL_LINEAR_TOLERANCE,
        );
        if (match) return match.id;
      }
    }
    const id = nextId++;
    const key = `${x}:${y}`;
    const bucket = vertices.get(key) ?? [];
    bucket.push({ id, point });
    vertices.set(key, bucket);
    return id;
  };
  const edges = new Map<
    string,
    { count: number; points: [FacePoint, FacePoint] }
  >();
  for (const triangle of triangles) {
    for (let i = 0; i < 3; i++) {
      const a = triangle[i],
        b = triangle[(i + 1) % 3];
      const aKey = vertexId(a),
        bKey = vertexId(b);
      if (aKey === bKey) continue;
      const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      const edge = edges.get(edgeKey);
      if (edge) edge.count += 1;
      else edges.set(edgeKey, { count: 1, points: [a, b] });
    }
  }
  const liesOnEdge = (point: FacePoint, [a, b]: [FacePoint, FacePoint]) => {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= KERNEL_LINEAR_TOLERANCE) return false;
    const along = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
    const perpendicular =
      Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
    return (
      perpendicular <= KERNEL_LINEAR_TOLERANCE &&
      along >= -KERNEL_LINEAR_TOLERANCE &&
      along <= length + KERNEL_LINEAR_TOLERANCE
    );
  };
  return [...edges.values()]
    .filter((edge) => edge.count === 1)
    .map(({ points }) => ({
      points,
      clearanceAllowance: straightEdges.some((edge) =>
        points.every((p) => liesOnEdge(p, edge)),
      )
        ? 0
        : TESSELLATION_LOD.default.linearDeflection,
    }));
}
/** Clearance includes outer and opening contours. Native rebuilds use the default
 * absolute linear deflection: reserve that uncertainty unless the native chord
 * matches a known authored straight cap edge. Coarse circles can have only four
 * chords, so turn-angle heuristics cannot establish exact boundary geometry. */
export function guidedFaceClearance(
  boundary: FaceBoundary,
  point: FacePoint,
): number {
  if (!boundary.length) return 0;
  let minimum = Infinity;
  for (const {
    points: [a, b],
    clearanceAllowance,
  } of boundary) {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
            ),
          )
        : 0;
    minimum = Math.min(
      minimum,
      Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) -
        clearanceAllowance,
    );
  }
  return minimum;
}
