import type { BoundingBox, RenderMesh } from "../kernel/KernelAdapter";
export type Point = [number, number, number];
type Point2 = [number, number];
export interface DrawingRect { x: number; y: number; width: number; height: number }
export interface DrawingView { xAxis: 0 | 1 | 2; yAxis: 0 | 1 | 2; depthAxis: 0 | 1 | 2; direction: 1 | -1 }
export const DRAWING_VIEWS = {
  top: { xAxis: 0, yAxis: 1, depthAxis: 2, direction: 1 },
  front: { xAxis: 0, yAxis: 2, depthAxis: 1, direction: -1 },
  right: { xAxis: 1, yAxis: 2, depthAxis: 0, direction: 1 },
} as const satisfies Record<string, DrawingView>;
export const DRAWING_TRIANGLE_LIMIT = 20000;
export function assertDrawingMesh(mesh: RenderMesh) {
  if (!mesh.positions.length || mesh.positions.length % 3 || !mesh.indices.length || mesh.indices.length % 3 || mesh.indices.length / 3 > DRAWING_TRIANGLE_LIMIT || mesh.normals.length !== mesh.positions.length) throw new Error("Drawing source mesh is malformed or exceeds 20,000 triangles. Select a simpler part.");
  for (let index = 0; index < mesh.positions.length; index++) if (!Number.isFinite(mesh.positions[index]) || !Number.isFinite(mesh.normals[index])) throw new Error("Drawing source contains invalid mesh coordinates.");
  if (mesh.indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= mesh.positions.length / 3)) throw new Error("Drawing source has invalid triangle indices.");
}
const point = (mesh: RenderMesh, index: number): Point => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
/** Nearby intersection points may straddle a cell boundary; search neighbors. */
function pointWelder(tolerance: number) {
  const cells = new Map<string, { point: readonly number[]; key: string }[]>();
  let nextKey = 0;
  return (point: readonly number[]) => {
    const cell = point.map(value => Math.floor(value / tolerance));
    const candidates = point.length === 2 ? [[-1], [0], [1]] : [-1, 0, 1].flatMap(x => [-1, 0, 1].map(y => [x, y]));
    for (const prefix of candidates) for (const last of [-1, 0, 1]) {
      const key = [...prefix, last].map((offset, axis) => cell[axis] + offset).join(":");
      for (const candidate of cells.get(key) ?? []) if (Math.hypot(...point.map((value, axis) => value - candidate.point[axis])) <= tolerance) return candidate.key;
    }
    const cellKey = cell.join(":"), key = `point:${nextKey++}`, entries = cells.get(cellKey) ?? [];
    entries.push({ point, key }); cells.set(cellKey, entries); return key;
  };
}
export function drawingTolerance(bounds: BoundingBox) { return Math.max(1e-6, ...bounds.max.map((value, axis) => (value - bounds.min[axis]) * 1e-10)); }
export function projectDrawingPoint(point: Point, bounds: BoundingBox, view: DrawingView, rect: DrawingRect): Point {
  const width = bounds.max[view.xAxis] - bounds.min[view.xAxis], height = bounds.max[view.yAxis] - bounds.min[view.yAxis], scale = Math.min((rect.width - 80) / width, (rect.height - 75) / height);
  return [rect.x + (rect.width - width * scale) / 2 + (point[view.xAxis] - bounds.min[view.xAxis]) * scale, rect.y + 30 + (rect.height - 75 - height * scale) / 2 + (bounds.max[view.yAxis] - point[view.yAxis]) * scale, point[view.depthAxis] * view.direction];
}
function normal(a: Point, b: Point, c: Point): Point {
  const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
  const n: Point = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n);
  return length ? n.map(value => value / length) as Point : [0, 0, 0];
}
const xy = (point: Point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
/** Bounded depth raster determines visible crease/silhouette edge fragments. */
export function orthographicSvg(mesh: RenderMesh, bounds: BoundingBox, view: DrawingView, rect: DrawingRect) {
  assertDrawingMesh(mesh);
  const factor = 512 / Math.max(rect.width, rect.height), gridWidth = Math.ceil(rect.width * factor), gridHeight = Math.ceil(rect.height * factor), depths = new Float64Array(gridWidth * gridHeight).fill(-Infinity);
  const depthSlopeX = new Float64Array(depths.length), depthSlopeY = new Float64Array(depths.length);
  const edges = new Map<string, { a: Point; b: Point; faces: { normal: Point; front: boolean }[] }>(), tolerance = drawingTolerance(bounds);
  const weld = pointWelder(tolerance);
  let pixelVisits = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = mesh.indices.slice(offset, offset + 3).map(index => point(mesh, index)), n = normal(vertices[0], vertices[1], vertices[2]), front = n[view.depthAxis] * view.direction > 1e-9;
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge], b = vertices[(edge + 1) % 3], keys = [weld(a), weld(b)].sort(), key = keys.join("/");
      if (keys[0] === keys[1]) continue;
      const record = edges.get(key) ?? { a, b, faces: [] }; record.faces.push({ normal: n, front }); edges.set(key, record);
    }
    if (!front) continue;
    const projected = vertices.map(point => projectDrawingPoint(point, bounds, view, rect));
    const raster = projected.map(point => [(point[0] - rect.x) * factor, (point[1] - rect.y) * factor, point[2]] as Point), [a, b, c] = raster;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(gridWidth - 1, Math.ceil(Math.max(a[0], b[0], c[0]))), minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(gridHeight - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(determinant) < 1e-12) continue;
    const slopeX = ((b[1] - c[1]) * (a[2] - c[2]) + (c[1] - a[1]) * (b[2] - c[2])) / determinant;
    const slopeY = ((c[0] - b[0]) * (a[2] - c[2]) + (a[0] - c[0]) * (b[2] - c[2])) / determinant;
    pixelVisits += (maxX - minX + 1) * (maxY - minY + 1); if (pixelVisits > 5000000) throw new Error("Orthographic drawing exceeds its depth-raster resource limit. Select a simpler part.");
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const first = ((b[1] - c[1]) * (x + 0.5 - c[0]) + (c[0] - b[0]) * (y + 0.5 - c[1])) / determinant, second = ((c[1] - a[1]) * (x + 0.5 - c[0]) + (a[0] - c[0]) * (y + 0.5 - c[1])) / determinant, third = 1 - first - second;
      if (first >= -1e-8 && second >= -1e-8 && third >= -1e-8) {
        const index = y * gridWidth + x, depth = a[2] * first + b[2] * second + c[2] * third;
        if (depth > depths[index]) { depths[index] = depth; depthSlopeX[index] = slopeX; depthSlopeY[index] = slopeY; }
      }
    }
  }
  const depthTolerance = (bounds.max[view.depthAxis] - bounds.min[view.depthAxis]) / 512 * 1.5 + tolerance;
  const lines: string[] = []; let samples = 0;
  for (const edge of edges.values()) {
    const front = edge.faces.filter(face => face.front); if (!front.length) continue;
    if (edge.faces.length === 2 && front.length === 2 && edge.faces[0].normal.reduce((sum, value, axis) => sum + value * edge.faces[1].normal[axis], 0) > 0.95) continue;
    const a = projectDrawingPoint(edge.a, bounds, view, rect), b = projectDrawingPoint(edge.b, bounds, view, rect), steps = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) * factor)); samples += steps; if (samples > 1000000) throw new Error("Drawing exceeds its edge-sampling resource limit.");
    let start: Point | undefined, last: Point | undefined;
    const flush = () => { if (start && last && Math.hypot(start[0] - last[0], start[1] - last[1]) > 0.2) lines.push(`M${xy(start)}L${xy(last)}`); start = undefined; last = undefined; };
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, p = a.map((value, axis) => value + (b[axis] - value) * t) as Point, x = Math.min(gridWidth - 1, Math.max(0, Math.floor((p[0] - rect.x) * factor))), y = Math.min(gridHeight - 1, Math.max(0, Math.floor((p[1] - rect.y) * factor)));
      // Evaluate the rasterized face plane at the edge sample, not the pixel
      // centre. This removes the slope-dependent depth error on steep faces.
      const index = y * gridWidth + x, occludingDepth = depths[index] + depthSlopeX[index] * ((p[0] - rect.x) * factor - x - 0.5) + depthSlopeY[index] * ((p[1] - rect.y) * factor - y - 0.5);
      if (p[2] + depthTolerance >= occludingDepth) { start ??= p; last = p; } else flush();
    }
    flush();
  }
  return `<path d="${lines.join("")}" fill="none" stroke="#172f39" stroke-width="1.1" stroke-linecap="round"/>`;
}

export interface DrawingSection { loops: Point2[][]; area: number }
export function drawingSection(mesh: RenderMesh, bounds: BoundingBox, height: number): DrawingSection {
  if (!Number.isFinite(height) || height <= bounds.min[2] || height >= bounds.max[2]) throw new Error(`Choose a section height strictly between ${bounds.min[2]} and ${bounds.max[2]} mm.`);
  assertDrawingMesh(mesh);
  const tolerance = drawingTolerance(bounds), segments = new Map<string, [Point2, Point2]>();
  const weld = pointWelder(tolerance);
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = mesh.indices.slice(offset, offset + 3).map(index => point(mesh, index)), hits = new Map<string, Point2>(), distances = vertices.map(point => point[2] - height);
    if (distances.every(value => Math.abs(value) <= tolerance)) throw new Error("Section is coplanar with a surface. Choose a slightly different height.");
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge], b = vertices[(edge + 1) % 3], first = distances[edge], second = distances[(edge + 1) % 3];
      if (Math.abs(first) <= tolerance) { const p: Point2 = [a[0], a[1]]; hits.set(weld(p), p); }
      if ((first < -tolerance && second > tolerance) || (first > tolerance && second < -tolerance)) { const t = first / (first - second), p: Point2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; hits.set(weld(p), p); }
    }
    if (hits.size === 2) { const points = [...hits.values()] as [Point2, Point2], key = points.map(point => weld(point)).sort().join("/"); segments.set(key, points); }
  }
  if (!segments.size) throw new Error("Section does not intersect this part. Choose another height.");
  const nodes = new Map<string, { point: Point2; neighbors: Set<string> }>();
  for (const [a, b] of segments.values()) { const ka = weld(a), kb = weld(b); for (const [key, point, neighbor] of [[ka, a, kb], [kb, b, ka]] as [string, Point2, string][]) { const node = nodes.get(key) ?? { point, neighbors: new Set<string>() }; node.neighbors.add(neighbor); nodes.set(key, node); } }
  if ([...nodes.values()].some(node => node.neighbors.size !== 2)) throw new Error("Section has ambiguous/open boundaries at this height. Choose another height or repair the part.");
  const visited = new Set<string>(), loops: Point2[][] = [];
  for (const start of nodes.keys()) {
    if (visited.has(start)) continue;
    const loop: Point2[] = []; let current = start, previous = "";
    do { if (visited.has(current)) throw new Error("Section contours intersect ambiguously. Choose another height."); visited.add(current); const node = nodes.get(current)!; loop.push(node.point); const next = [...node.neighbors].find(key => key !== previous)!; previous = current; current = next; } while (current !== start);
    if (loop.length < 3) throw new Error("Section has a collapsed boundary."); loops.push(loop);
  }
  const contains = (loop: Point2[], p: Point2) => { let inside = false; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) { const a = loop[i], b = loop[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
  const area = loops.reduce((sum, loop, index) => { const area = Math.abs(loop.reduce((sum, p, i) => { const q = loop[(i + 1) % loop.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2), depth = loops.filter((other, otherIndex) => otherIndex !== index && contains(other, loop[0])).length; return sum + area * (depth % 2 ? -1 : 1); }, 0);
  if (!(area > 0) || !Number.isFinite(area)) throw new Error("Section produced no finite area.");
  return { loops, area };
}
