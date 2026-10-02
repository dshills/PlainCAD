import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import { assertMeshBudget, MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";

type Vec = [number, number, number];
export interface Triangle {
  vertices: [Vec, Vec, Vec];
  ids: number[];
  min: Vec;
  max: Vec;
}
export interface MeshCheck {
  mesh: RenderMesh;
  triangles: Triangle[];
  min: Vec;
  max: Vec;
  volume: number;
  shells: number;
}
export interface CheckBudget {
  pairs: number;
}
const EPS = 1e-7;
class ContainmentAmbiguityError extends Error {}
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec) => Math.hypot(...a);
export const boundsOverlap = (
  a: { min: Vec; max: Vec },
  b: { min: Vec; max: Vec },
) => a.min.every((v, i) => v <= b.max[i] + EPS && a.max[i] + EPS >= b.min[i]);
function tick(budget: CheckBudget) {
  if (++budget.pairs > MODEL_RESOURCE_LIMITS.maxIntersectionTests)
    throw new Error(
      "Intersection validation exceeded its resource limit. Use separate files with expensive checks skipped, or simplify the model.",
    );
}
interface Node {
  min: Vec;
  max: Vec;
  children?: [Node, Node];
  items?: Triangle[];
}
function bounds(triangles: Triangle[]) {
  const min: Vec = [Infinity, Infinity, Infinity],
    max: Vec = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], t.min[i]);
      max[i] = Math.max(max[i], t.max[i]);
    }
  return { min, max };
}
function tree(items: Triangle[]): Node {
  const box = bounds(items);
  if (items.length <= 8) return { ...box, items };
  const axis = [0, 1, 2].sort(
    (a, b) => box.max[b] - box.min[b] - (box.max[a] - box.min[a]),
  )[0];
  const sorted = [...items].sort(
      (a, b) => a.min[axis] + a.max[axis] - (b.min[axis] + b.max[axis]),
    ),
    half = Math.floor(items.length / 2);
  return {
    ...box,
    children: [tree(sorted.slice(0, half)), tree(sorted.slice(half))],
  };
}
function visit(
  node: Node,
  triangle: Triangle,
  test: (other: Triangle) => boolean,
): boolean {
  if (!boundsOverlap(node, triangle)) return false;
  if (node.items)
    return node.items.some(
      (other) => boundsOverlap(triangle, other) && test(other),
    );
  return node.children!.some((child) => visit(child, triangle, test));
}
function segmentHits(a: Vec, b: Vec, t: Triangle): boolean {
  const dir = sub(b, a),
    edge1 = sub(t.vertices[1], t.vertices[0]),
    edge2 = sub(t.vertices[2], t.vertices[0]);
  const h = cross(dir, edge2),
    det = dot(edge1, h);
  if (Math.abs(det) <= 1e-12 * length(edge1) * length(h)) return false;
  const s = sub(a, t.vertices[0]),
    u = dot(s, h) / det;
  if (u < -EPS || u > 1 + EPS) return false;
  const q = cross(s, edge1),
    v = dot(dir, q) / det,
    distance = dot(edge2, q) / det;
  return (
    v >= -EPS && u + v <= 1 + EPS && distance >= -EPS && distance <= 1 + EPS
  );
}
function coplanarOverlap(a: Triangle, b: Triangle, n: Vec): boolean {
  const axis = [0, 1, 2].sort((i, j) => Math.abs(n[j]) - Math.abs(n[i]))[0];
  const project = (v: Vec) => v.filter((_, i) => i !== axis);
  const orient = (p: number[], q: number[], r: number[]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const av = a.vertices.map(project),
    bv = b.vertices.map(project);
  const inside = (p: number[], v: number[][]) => {
    const s = v.map((q, i) => orient(q, v[(i + 1) % 3], p));
    return s.every((x) => x >= -EPS) || s.every((x) => x <= EPS);
  };
  if (av.some((p) => inside(p, bv)) || bv.some((p) => inside(p, av)))
    return true;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const p = av[i],
        q = av[(i + 1) % 3],
        r = bv[j],
        s = bv[(j + 1) % 3];
      if (
        Math.min(p[0], q[0]) > Math.max(r[0], s[0]) + EPS ||
        Math.min(r[0], s[0]) > Math.max(p[0], q[0]) + EPS ||
        Math.min(p[1], q[1]) > Math.max(r[1], s[1]) + EPS ||
        Math.min(r[1], s[1]) > Math.max(p[1], q[1]) + EPS
      )
        continue;
      if (
        orient(p, q, r) * orient(p, q, s) <= EPS * EPS &&
        orient(r, s, p) * orient(r, s, q) <= EPS * EPS
      )
        return true;
    }
  return false;
}
function intersects(a: Triangle, b: Triangle): boolean {
  const an = cross(
      sub(a.vertices[1], a.vertices[0]),
      sub(a.vertices[2], a.vertices[0]),
    ),
    bn = cross(
      sub(b.vertices[1], b.vertices[0]),
      sub(b.vertices[2], b.vertices[0]),
    );
  if (
    length(cross(an, bn)) <= 1e-8 * length(an) * length(bn) &&
    Math.abs(dot(an, sub(b.vertices[0], a.vertices[0]))) <= EPS * length(an)
  )
    return coplanarOverlap(a, b, an);
  return (
    a.vertices.some((v, i) => segmentHits(v, a.vertices[(i + 1) % 3], b)) ||
    b.vertices.some((v, i) => segmentHits(v, b.vertices[(i + 1) % 3], a))
  );
}
function inside(
  point: Vec,
  triangles: Triangle[],
  budget: CheckBudget,
): boolean {
  const box = bounds(triangles),
    span =
      Math.max(
        ...box.max.map(
          (v, i) => Math.abs(v - point[i]) + Math.abs(box.min[i] - point[i]),
        ),
      ) + 1;
  // A boundary hit is ambiguous: retry a different direction instead of counting
  // both triangles on a shared edge. Never silently guess after repeated ambiguity.
  for (const direction of [
    [3, 0.731, 0.417],
    [0.619, 3, 0.283],
    [0.337, 0.853, 3],
  ]) {
    const dir = direction.map((v) => v * span) as Vec;
    let hits = 0,
      ambiguous = false;
    for (const t of triangles) {
      tick(budget);
      const edge1 = sub(t.vertices[1], t.vertices[0]),
        edge2 = sub(t.vertices[2], t.vertices[0]);
      const h = cross(dir, edge2),
        det = dot(edge1, h);
      if (Math.abs(det) <= 1e-12 * length(edge1) * length(h)) continue;
      const s = sub(point, t.vertices[0]),
        u = dot(s, h) / det,
        q = cross(s, edge1);
      const v = dot(dir, q) / det,
        distance = dot(edge2, q) / det;
      const tolerance = 1e-10;
      if (
        u < -tolerance ||
        v < -tolerance ||
        u + v > 1 + tolerance ||
        distance < 0 ||
        distance > 1
      )
        continue;
      if (
        u <= tolerance ||
        v <= tolerance ||
        1 - u - v <= tolerance ||
        distance <= tolerance
      ) {
        ambiguous = true;
        break;
      }
      hits++;
    }
    if (!ambiguous) return hits % 2 === 1;
  }
  throw new ContainmentAmbiguityError(
    "Containment validation is numerically ambiguous. Use separate files or simplify the geometry.",
  );
}
export function validateMesh(
  mesh: RenderMesh,
  full = true,
  budget: CheckBudget = { pairs: 0 },
): MeshCheck {
  const fail = (message: string): never => {
    throw new Error(`Body ${mesh.bodyId}: ${message}`);
  };
  if (
    !mesh.positions.length ||
    mesh.positions.length % 3 ||
    !mesh.indices.length ||
    mesh.indices.length % 3
  )
    fail("empty or malformed triangle mesh.");
  assertMeshBudget(mesh.positions.length / 3, mesh.indices.length / 3);
  const vertices: Vec[] = [],
    weld = new Map<string, number[]>(),
    remap: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p: Vec = [
      Math.fround(mesh.positions[i]),
      Math.fround(mesh.positions[i + 1]),
      Math.fround(mesh.positions[i + 2]),
    ];
    if (!p.every(Number.isFinite))
      fail("nonfinite or float32-overflow coordinates.");
    const cell = p.map((v) => Math.floor(v / EPS));
    let id: number | undefined;
    for (let dx = -1; dx <= 1 && id === undefined; dx++)
      for (let dy = -1; dy <= 1 && id === undefined; dy++)
        for (let dz = -1; dz <= 1 && id === undefined; dz++) {
          const candidates =
            weld.get([cell[0] + dx, cell[1] + dy, cell[2] + dz].join(",")) ??
            [];
          id = candidates.find(
            (candidate) => length(sub(vertices[candidate], p)) <= EPS,
          );
        }
    if (id === undefined) {
      id = vertices.length;
      vertices.push(p);
      const key = cell.join(","),
        bucket = weld.get(key) ?? [];
      bucket.push(id);
      weld.set(key, bucket);
    }
    remap.push(id);
  }
  const triangles: Triangle[] = [],
    edges = new Map<string, Array<{ triangle: number; direction: number }>>(),
    duplicate = new Set<string>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const indices = Array.from(mesh.indices.slice(i, i + 3));
    if (indices.some((v) => !Number.isInteger(v) || v < 0 || v >= remap.length))
      fail("triangle index is out of range.");
    const ids = indices.map((v) => remap[v]),
      points = ids.map((id) => vertices[id]) as [Vec, Vec, Vec];
    if (
      new Set(ids).size < 3 ||
      length(cross(sub(points[1], points[0]), sub(points[2], points[0]))) <=
        1e-12
    )
      fail("degenerate triangle after float32 conversion.");
    const key = [...ids].sort((a, b) => a - b).join(",");
    if (duplicate.has(key)) fail("duplicate triangles.");
    duplicate.add(key);
    const triangle: Triangle = {
      ids,
      vertices: points,
      min: [0, 1, 2].map((axis) =>
        Math.min(...points.map((p) => p[axis])),
      ) as Vec,
      max: [0, 1, 2].map((axis) =>
        Math.max(...points.map((p) => p[axis])),
      ) as Vec,
    };
    triangles.push(triangle);
    for (let e = 0; e < 3; e++) {
      const a = ids[e],
        b = ids[(e + 1) % 3],
        k = `${Math.min(a, b)}:${Math.max(a, b)}`,
        entries = edges.get(k) ?? [];
      entries.push({ triangle: i / 3, direction: a < b ? 1 : -1 });
      edges.set(k, entries);
    }
  }
  const adjacency = triangles.map(() => new Set<number>());
  for (const entries of edges.values()) {
    if (entries.length !== 2)
      fail(
        entries.length === 1
          ? "open boundary; mesh is not watertight."
          : "non-manifold edge.",
      );
    if (entries[0].direction === entries[1].direction)
      fail("inconsistent triangle winding.");
    adjacency[entries[0].triangle].add(entries[1].triangle);
    adjacency[entries[1].triangle].add(entries[0].triangle);
  }
  // A manifold vertex has one connected triangle fan, even when edge counts are valid.
  const fans = new Map<number, number[]>();
  for (const [i, t] of triangles.entries())
    for (const id of t.ids) {
      const fan = fans.get(id) ?? [];
      fan.push(i);
      fans.set(id, fan);
    }
  for (const fan of fans.values()) {
    const todo = [fan[0]],
      allowed = new Set(fan),
      seen = new Set<number>();
    while (todo.length) {
      const i = todo.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      for (const j of adjacency[i]) if (allowed.has(j)) todo.push(j);
    }
    if (seen.size !== fan.length)
      fail("non-manifold vertex with disconnected triangle fans.");
  }
  const unseen = new Set(triangles.map((_, i) => i)),
    components: Triangle[][] = [];
  while (unseen.size) {
    const todo = [unseen.values().next().value!],
      group: Triangle[] = [];
    while (todo.length) {
      const i = todo.pop()!;
      if (!unseen.delete(i)) continue;
      group.push(triangles[i]);
      todo.push(...adjacency[i]);
    }
    components.push(group);
  }
  const volumes = components.map((group) => {
    const origin = group[0].vertices[0];
    return group.reduce(
      (sum, t) =>
        sum +
        dot(
          sub(t.vertices[0], origin),
          cross(sub(t.vertices[1], origin), sub(t.vertices[2], origin)),
        ) /
          6,
      0,
    );
  });
  const volume = volumes.reduce((sum, v) => sum + v, 0);
  if (
    !Number.isFinite(volume) ||
    volume <= 1e-12 ||
    volumes.some((v) => Math.abs(v) <= 1e-12)
  )
    fail("zero volume or inward shell orientation.");
  for (const [i, v] of volumes.entries())
    if (
      v < 0 &&
      !components.some(
        (group, j) =>
          volumes[j] > 0 && inside(components[i][0].vertices[0], group, budget),
      )
    )
      fail("inward shell is not an enclosed cavity.");
  if (
    mesh.geometryAssertions &&
    Math.abs(volume - mesh.geometryAssertions.volume) >
      Math.max(1e-6, mesh.geometryAssertions.volume * 0.02)
  )
    fail("mesh volume disagrees with native solid volume by more than 2%.");
  if (full) {
    const index = new Map(triangles.map((t, i) => [t, i])),
      root = tree(triangles);
    for (const [i, t] of triangles.entries())
      if (
        visit(root, t, (other) => {
          if (
            index.get(other)! <= i ||
            other.ids.some((id) => t.ids.includes(id))
          )
            return false;
          tick(budget);
          return intersects(t, other);
        })
      )
        fail("self-intersection between non-adjacent triangles.");
  }
  return {
    mesh: { ...mesh, positions: remap.flatMap((id) => vertices[id]) },
    ...bounds(triangles),
    triangles,
    volume,
    shells: components.length,
  };
}
export function overlapWarnings(
  checks: MeshCheck[],
  names: string[],
  budget: CheckBudget,
): string[] {
  const warnings: string[] = [];
  const roots = new Map<number, Node>();
  for (let i = 0; i < checks.length; i++)
    for (let j = i + 1; j < checks.length; j++)
      if (boundsOverlap(checks[i], checks[j])) {
        let root = roots.get(j);
        if (!root) {
          root = tree(checks[j].triangles);
          roots.set(j, root);
        }
        let contact = false;
        try {
          contact =
            checks[i].triangles.some((t) =>
              visit(root, t, (other) => {
                tick(budget);
                return intersects(t, other);
              }),
            ) ||
            inside(
              checks[i].triangles[0].vertices[0],
              checks[j].triangles,
              budget,
            ) ||
            inside(
              checks[j].triangles[0].vertices[0],
              checks[i].triangles,
              budget,
            );
        } catch (error) {
          if (!(error instanceof ContainmentAmbiguityError)) throw error;
          warnings.push(
            `${names[i]} and ${names[j]} have numerically ambiguous containment; verify placement or use separate files.`,
          );
          continue;
        }
        if (contact)
          warnings.push(
            `${names[i]} and ${names[j]} intersect, touch, or contain one another. Separate shells may be unsuitable for fabrication; use native union or separate files.`,
          );
      }
  return warnings;
}
