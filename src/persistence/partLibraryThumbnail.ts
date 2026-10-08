import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import { canvasPng } from "./pngCapture";
import { PART_LIBRARY_LIMITS, validateLibraryThumbnail } from "./partLibrary";

/** A small deterministic shaded thumbnail of actual native tessellation, without an extra WebGL context. */
export async function libraryThumbnail(meshes: RenderMesh[]): Promise<string> {
  if (!meshes.length || meshes.some(mesh => mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid)) throw new Error("Save a successfully rebuilt native component to create its thumbnail.");
  const triangleCount = meshes.reduce((count, mesh) => count + mesh.indices.length / 3, 0);
  if (triangleCount > 50000) throw new Error("Part thumbnail exceeds 50,000 triangles. Use a coarser display tessellation or simplify this component.");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser thumbnail rendering is unavailable.");
  const project = (x: number, y: number, z: number) => ({ x: (x - y) * Math.SQRT1_2, y: (x + y) / Math.sqrt(6) - z * Math.sqrt(2 / 3), depth: (x + y + z) / Math.sqrt(3) });
  const faces: Array<{ points: ReturnType<typeof project>[]; depth: number; shade: number }> = [];
  for (const mesh of meshes) for (let index = 0; index < mesh.indices.length; index += 3) {
    const points = mesh.indices.slice(index, index + 3).map(vertex => project(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]));
    if (points.some(point => ![point.x, point.y, point.depth].every(Number.isFinite))) throw new Error("Part thumbnail contains invalid mesh coordinates.");
    const vertex = mesh.indices[index], nx = mesh.normals[vertex * 3], ny = mesh.normals[vertex * 3 + 1], nz = mesh.normals[vertex * 3 + 2];
    if (![nx, ny, nz].every(Number.isFinite)) throw new Error("Part thumbnail contains invalid mesh normals.");
    faces.push({ points, depth: points.reduce((sum, point) => sum + point.depth, 0) / 3, shade: Math.max(0.25, Math.min(1, 0.5 + 0.25 * nx + 0.15 * ny + 0.45 * nz)) });
  }
  if (!faces.length) throw new Error("Part thumbnail has no triangles.");
  const points = faces.flatMap(face => face.points);
  const min = { x: Infinity, y: Infinity }, max = { x: -Infinity, y: -Infinity };
  points.forEach(point => { min.x = Math.min(min.x, point.x); min.y = Math.min(min.y, point.y); max.x = Math.max(max.x, point.x); max.y = Math.max(max.y, point.y); });
  const scale = 168 / Math.max(max.x - min.x, max.y - min.y, 1e-9);
  context.fillStyle = "#e9efee"; context.fillRect(0, 0, 192, 192);
  faces.sort((a, b) => a.depth - b.depth).forEach(face => {
    context.beginPath();
    face.points.forEach((point, index) => {
      const x = 96 + (point.x - (min.x + max.x) / 2) * scale, y = 96 + (point.y - (min.y + max.y) / 2) * scale;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = `rgb(${Math.round(115 * face.shade)}, ${Math.round(170 * face.shade)}, ${Math.round(165 * face.shade)})`;
    context.fill();
  });
  const blob = await canvasPng(canvas);
  if (blob.size > PART_LIBRARY_LIMITS.thumbnailBytes) throw new Error("Part thumbnail is too large to save locally.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = `data:image/png;base64,${btoa(binary)}`;
  validateLibraryThumbnail(url); return url;
}
