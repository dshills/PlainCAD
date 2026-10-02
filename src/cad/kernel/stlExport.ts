import { MODEL_RESOURCE_LIMITS, assertMeshBudget } from "../resourceLimits";
import { RenderMesh } from "./KernelAdapter";

export function exportMeshesToStl(
  meshes: RenderMesh[],
  name = "PlainCAD",
): ArrayBuffer {
  if (meshes.length === 0)
    throw new Error("STL export requires a successfully rebuilt model.");
  for (const mesh of meshes) {
    assertMeshBudget(mesh.positions.length / 3, mesh.indices.length / 3);
    if (
      !mesh.indices.length ||
      mesh.indices.length % 3 ||
      mesh.positions.length % 3
    )
      throw new Error("STL mesh has empty or malformed triangles.");
    for (let i = 0; i < mesh.positions.length; i++)
      if (!Number.isFinite(Math.fround(mesh.positions[i])))
        throw new Error(
          "STL coordinates exceed finite float32 representation.",
        );
    if (
      mesh.indices.some(
        (i) => !Number.isInteger(i) || i < 0 || i * 3 >= mesh.positions.length,
      )
    )
      throw new Error("STL mesh has an invalid vertex index.");
  }
  const triangleCount = meshes.reduce(
    (sum, mesh) => sum + mesh.indices.length / 3,
    0,
  );
  if (
    triangleCount > MODEL_RESOURCE_LIMITS.maxTriangles ||
    meshes.length > MODEL_RESOURCE_LIMITS.maxBodies
  )
    throw new Error("STL exceeds the export resource limit.");
  const bytes = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(bytes);
  writeHeader(bytes, name);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (const mesh of meshes) {
    for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
      const ia = mesh.indices[index] * 3;
      const ib = mesh.indices[index + 1] * 3;
      const ic = mesh.indices[index + 2] * 3;
      offset = writeFaceNormal(view, offset, mesh.positions, ia, ib, ic);
      offset = writeVertex(view, offset, mesh.positions, ia);
      offset = writeVertex(view, offset, mesh.positions, ib);
      offset = writeVertex(view, offset, mesh.positions, ic);
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  return bytes;
}

function writeHeader(bytes: ArrayBuffer, name: string) {
  const header = new Uint8Array(bytes, 0, 80);
  const safeName = name.replace(/\s+/g, "_").slice(0, 64);
  const encoded = new TextEncoder().encode(`PlainCAD binary STL ${safeName}`);
  header.set(encoded.subarray(0, 80));
}

function writeFaceNormal(
  view: DataView,
  offset: number,
  positions: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
): number {
  const abX = positions[b] - positions[a];
  const abY = positions[b + 1] - positions[a + 1];
  const abZ = positions[b + 2] - positions[a + 2];
  const acX = positions[c] - positions[a];
  const acY = positions[c + 1] - positions[a + 1];
  const acZ = positions[c + 2] - positions[a + 2];
  const normalX = abY * acZ - abZ * acY;
  const normalY = abZ * acX - abX * acZ;
  const normalZ = abX * acY - abY * acX;
  const length = Math.hypot(normalX, normalY, normalZ);
  if (length < 1e-12) {
    throw new Error("STL contains a degenerate triangle.");
  }
  view.setFloat32(offset, normalX / length, true);
  view.setFloat32(offset + 4, normalY / length, true);
  view.setFloat32(offset + 8, normalZ / length, true);
  return offset + 12;
}

function writeVertex(
  view: DataView,
  offset: number,
  positions: ArrayLike<number>,
  vertexIndex: number,
): number {
  view.setFloat32(offset, positions[vertexIndex], true);
  view.setFloat32(offset + 4, positions[vertexIndex + 1], true);
  view.setFloat32(offset + 8, positions[vertexIndex + 2], true);
  return offset + 12;
}
