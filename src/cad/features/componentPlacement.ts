import type { CadDocument, ComponentPlacement } from "../document/schema";
import { bodyComponentId } from "../document/components";
import { placedPoint, placedVector, placementTransform } from "../document/componentPlacement";
import type { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";

export function placedComponentMesh(mesh: RenderMesh, placement: ComponentPlacement): RenderMesh {
  if (!mesh.positions.length || mesh.positions.length % 3 || mesh.normals.length !== mesh.positions.length) throw new Error("Positioned component needs a nonempty complete mesh with matching normals.");
  const frame = placementTransform(placement), positions: number[] = [], normals: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = placedPoint(frame, { x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] });
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error("Positioned component contains nonfinite vertices.");
    const coordinates = [p.x, p.y, p.z]; positions.push(...coordinates);
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], coordinates[axis]); max[axis] = Math.max(max[axis], coordinates[axis]); }
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const n = placedVector(frame, { x: mesh.normals[i], y: mesh.normals[i + 1], z: mesh.normals[i + 2] });
    if (![n.x, n.y, n.z].every(Number.isFinite)) throw new Error("Positioned component contains nonfinite normals.");
    normals.push(n.x, n.y, n.z);
  }
  return { ...mesh, positions, normals, bounds: { min, max } };
}

/** Stage all component placements before publishing any positioned body. */
export function applyComponentPlacements<T extends { shape: KernelShape; mesh?: RenderMesh }>(document: CadDocument, kernel: KernelAdapter, bodies: Map<string, T>, owned: Set<KernelShape>): void {
  const staged = new Map<string, T>();
  for (const [id, body] of bodies) {
    const component = bodyComponentId(document, id), placement = component ? document.components[component]?.placement : undefined;
    if (!placement || [...placement.translation, ...placement.rotation].every(n => n === 0)) continue;
    let shape = body.shape;
    if (body.mesh?.geometrySource === "opencascade") {
      if (!kernel.placeShape) throw new Error("This kernel cannot position native components.");
      shape = kernel.placeShape(shape, placement); owned.add(shape);
    }
    staged.set(id, { ...body, shape, ...(body.mesh ? { mesh: placedComponentMesh(body.mesh, placement) } : {}) });
  }
  for (const [id, body] of staged) bodies.set(id, body);
}
