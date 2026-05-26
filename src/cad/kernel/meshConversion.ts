import { BoundingBox, RenderMesh } from "./KernelAdapter";
import { ProfileHole } from "../sketch/profileDetection";

export function createBoxMesh(bodyId: string, width: number, height: number, depth: number): RenderMesh {
  const x = width / 2;
  const y = height / 2;
  const z = depth;
  const positions = [
    -x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0,
    -x, -y, z, x, -y, z, x, y, z, -x, y, z,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  return {
    id: bodyId,
    bodyId,
    positions,
    normals: computeNormals(positions, indices),
    indices,
    color: "#8fb7b4",
    bounds: { min: [-x, -y, 0], max: [x, y, z] },
  };
}

export function createCylinderMesh(bodyId: string, radius: number, height: number, segments = 48): RenderMesh {
  const positions: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, height);
  }
  const indices: number[] = [];
  for (let i = 1; i < segments - 1; i += 1) indices.push(0, i, i + 1);
  for (let i = 1; i < segments - 1; i += 1) indices.push(segments, segments + i + 1, segments + i);
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(i, next, segments + next, i, segments + next, segments + i);
  }
  return {
    id: bodyId,
    bodyId,
    positions,
    normals: computeNormals(positions, indices),
    indices,
    color: "#8fb7b4",
    bounds: { min: [-radius, -radius, 0], max: [radius, radius, height] },
  };
}

export function createPlateWithCircularHolesMesh(
  bodyId: string,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  holes: ProfileHole[],
  depth: number,
): RenderMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const xs = uniqueSorted([bounds.minX, bounds.maxX, ...holes.flatMap((hole) => [hole.x - hole.radius, hole.x + hole.radius])]);
  const ys = uniqueSorted([bounds.minY, bounds.maxY, ...holes.flatMap((hole) => [hole.y - hole.radius, hole.y + hole.radius])]);

  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let yi = 0; yi < ys.length - 1; yi += 1) {
      const minX = xs[xi];
      const maxX = xs[xi + 1];
      const minY = ys[yi];
      const maxY = ys[yi + 1];
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      if (insideAnyHole(centerX, centerY, holes)) continue;
      const a = addVertex(minX, minY, 0);
      const b = addVertex(maxX, minY, 0);
      const c = addVertex(maxX, maxY, 0);
      const d = addVertex(minX, maxY, 0);
      const e = addVertex(minX, minY, depth);
      const f = addVertex(maxX, minY, depth);
      const g = addVertex(maxX, maxY, depth);
      const h = addVertex(minX, maxY, depth);
      indices.push(a, c, b, a, d, c, e, f, g, e, g, h);
    }
  }

  addWall(positions, indices, bounds.minX, bounds.minY, bounds.maxX, bounds.minY, depth);
  addWall(positions, indices, bounds.maxX, bounds.minY, bounds.maxX, bounds.maxY, depth);
  addWall(positions, indices, bounds.maxX, bounds.maxY, bounds.minX, bounds.maxY, depth);
  addWall(positions, indices, bounds.minX, bounds.maxY, bounds.minX, bounds.minY, depth);
  for (const hole of holes) addHoleWall(positions, indices, hole, depth);

  return {
    id: bodyId,
    bodyId,
    positions,
    normals: computeNormals(positions, indices),
    indices,
    color: "#8fb7b4",
    bounds: { min: [bounds.minX, bounds.minY, 0], max: [bounds.maxX, bounds.maxY, depth] },
  };
}

export function computeNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const normal = normalize([
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]);
    for (const index of [a, b, c]) {
      normals[index] += normal[0];
      normals[index + 1] += normal[1];
      normals[index + 2] += normal[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const normal = normalize([normals[i], normals[i + 1], normals[i + 2]]);
    normals[i] = normal[0];
    normals[i + 1] = normal[1];
    normals[i + 2] = normal[2];
  }
  return normals;
}

export function meshToAsciiStl(mesh: RenderMesh, name: string): string {
  const lines = [`solid ${name}`];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i] * 3;
    const ib = mesh.indices[i + 1] * 3;
    const ic = mesh.indices[i + 2] * 3;
    const normal = faceNormal(mesh.positions, ia, ib, ic);
    lines.push(`facet normal ${normal.join(" ")}`, " outer loop");
    for (const index of [ia, ib, ic]) {
      lines.push(`  vertex ${mesh.positions[index]} ${mesh.positions[index + 1]} ${mesh.positions[index + 2]}`);
    }
    lines.push(" endloop", "endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n");
}

export function boundsFromMeshes(meshes: RenderMesh[]): BoundingBox | undefined {
  if (meshes.length === 0) return undefined;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.bounds.min[axis]);
      max[axis] = Math.max(max[axis], mesh.bounds.max[axis]);
    }
  }
  return { min, max };
}

function faceNormal(positions: number[], a: number, b: number, c: number): [number, number, number] {
  const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
  const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
  return normalize([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]);
}

function normalize(value: number[]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100000) / 100000))].sort((a, b) => a - b);
}

function insideAnyHole(x: number, y: number, holes: ProfileHole[]): boolean {
  return holes.some((hole) => Math.hypot(x - hole.x, y - hole.y) < hole.radius);
}

function addWall(positions: number[], indices: number[], x1: number, y1: number, x2: number, y2: number, depth: number) {
  const start = positions.length / 3;
  positions.push(x1, y1, 0, x2, y2, 0, x2, y2, depth, x1, y1, depth);
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function addHoleWall(positions: number[], indices: number[], hole: ProfileHole, depth: number, segments = 40) {
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    addWall(
      positions,
      indices,
      hole.x + Math.cos(a) * hole.radius,
      hole.y + Math.sin(a) * hole.radius,
      hole.x + Math.cos(b) * hole.radius,
      hole.y + Math.sin(b) * hole.radius,
      depth,
    );
  }
}
