import type { RenderMesh } from "../cad/kernel/KernelAdapter";
interface Face { points: number[][]; normal: number[] }
interface ProjectedFace { face: Face; points: Array<{ x: number; y: number; depth: number }>; normal: number[]; depth: number }
interface PreviewGeometry { faces: Face[]; center: number[]; radius: number; projected: ProjectedFace[] }
/** Bounded CPU preview of actual native triangles, independent of the project camera. */
export function galleryPreviewFaces(meshes: RenderMesh[]): PreviewGeometry {
  if (!meshes.length || meshes.some(mesh => mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid)) throw new Error("A live gallery preview requires valid native geometry.");
  if (meshes.some(mesh => !mesh.indices.length || mesh.indices.length % 3 || mesh.positions.length % 3 || mesh.normals.length !== mesh.positions.length)) throw new Error("Gallery preview has incomplete native triangles or normals.");
  const count = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  if (!Number.isInteger(count) || count <= 0) throw new Error("Gallery preview has no complete native triangles.");
  if (count > 10000) throw new Error("Live rotation is limited to 10,000 native triangles. Open this project to explore it.");
  const faces = meshes.flatMap(mesh => {
    const faces: Face[] = [];
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const indices = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
      if (indices.some(index => !Number.isInteger(index) || index < 0 || index * 3 + 2 >= mesh.positions.length)) throw new Error("Gallery preview has invalid native vertex indices.");
      const face = { points: indices.map(index => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]]), normal: [mesh.normals[indices[0] * 3], mesh.normals[indices[0] * 3 + 1], mesh.normals[indices[0] * 3 + 2]] };
      if (face.points.some(point => point.length !== 3 || point.some(value => !Number.isFinite(value))) || face.normal.length !== 3 || face.normal.some(value => !Number.isFinite(value))) throw new Error("Gallery preview has invalid native mesh coordinates.");
      faces.push(face);
    }
    return faces;
  });
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) for (const point of face.points) for (let axis = 0; axis < 3; axis++) { minimum[axis] = Math.min(minimum[axis], point[axis]); maximum[axis] = Math.max(maximum[axis], point[axis]); }
  const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
  let radius = 0;
  for (const face of faces) for (const point of face.points) radius = Math.max(radius, Math.hypot(...point.map((value, axis) => value - center[axis])));
  return { faces, center, radius, projected: faces.map(face => ({ face, points: face.points.map(() => ({ x: 0, y: 0, depth: 0 })), normal: [0, 0, 0], depth: 0 })) };
}
export function drawGalleryPreview(canvas: HTMLCanvasElement, geometry: PreviewGeometry, angle: number) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser preview rendering is unavailable.");
  const { center, radius, projected } = geometry;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  for (const entry of projected) {
    entry.depth = 0;
    for (let index = 0; index < 3; index++) {
      const source = entry.face.points[index], point = entry.points[index];
      const x = source[0] - center[0], y = source[1] - center[1], z = source[2] - center[2];
      const rx = x * cosine - y * sine, ry = x * sine + y * cosine;
      // Match the viewer's (+X, -Y, +Z) isometric camera; screen Y points down.
      point.x = (rx + ry) * Math.SQRT1_2;
      point.y = (rx - ry) / Math.sqrt(6) - z * Math.sqrt(2 / 3);
      point.depth = rx - ry + z;
      entry.depth += point.depth;
    }
    const normal = entry.face.normal;
    entry.normal[0] = normal[0] * cosine - normal[1] * sine;
    entry.normal[1] = normal[0] * sine + normal[1] * cosine;
    entry.normal[2] = normal[2];
  }
  const scale = (Math.min(canvas.width, canvas.height) - 30) / Math.max(2 * radius, 1e-9);
  context.fillStyle = "#e9efee"; context.fillRect(0, 0, canvas.width, canvas.height);
  projected.sort((a, b) => a.depth - b.depth).forEach(face => {
    context.beginPath();
    face.points.forEach((point, index) => { const x = canvas.width / 2 + point.x * scale, y = canvas.height / 2 + point.y * scale; if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.closePath();
    const shade = Math.max(0.3, Math.min(1, 0.55 + 0.2 * face.normal[0] + 0.1 * face.normal[1] + 0.4 * face.normal[2]));
    context.fillStyle = `rgb(${Math.round(115 * shade)},${Math.round(170 * shade)},${Math.round(165 * shade)})`; context.fill();
  });
}
