import type { RenderMesh } from "../../cad/kernel/KernelAdapter";

/** Rasterize native triangles on the worker, looking from +X/-Y/+Z like the modeling isometric view.
 * Both frames share an undistorted projection; per-pixel depth keeps cavities and crossing triangles correct. */
export async function storyThumbnails(before: RenderMesh[], after: RenderMesh[], changed: Set<string>): Promise<{ beforeImage: string; afterImage: string }> {
  const project = (x: number, y: number, z: number) => ({ x: (x + y) * Math.SQRT1_2, y: (x - y) / Math.sqrt(6) - z * Math.sqrt(2 / 3), depth: (x - y + z) / Math.sqrt(3) });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const mesh of [...before, ...after]) for (let index = 0; index < mesh.positions.length; index += 3) {
    const point = project(mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]);
    if (![point.x, point.y, point.depth].every(Number.isFinite)) throw new Error("History geometry has invalid coordinates.");
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const scale = Number.isFinite(minX) ? Math.min(176 / Math.max(maxX - minX, 1e-9), 136 / Math.max(maxY - minY, 1e-9)) : 1;
  const draw = async (meshes: RenderMesh[], highlight: boolean) => {
    if (typeof OffscreenCanvas === "undefined") throw new Error("Native build-story thumbnails require a browser with OffscreenCanvas support.");
    const canvas = new OffscreenCanvas(208, 168), context = canvas.getContext("2d");
    if (!context) throw new Error("Browser history thumbnail rendering is unavailable.");
    const pixels = context.createImageData(canvas.width, canvas.height), depthBuffer = new Float64Array(canvas.width * canvas.height);
    depthBuffer.fill(-Infinity);
    for (let index = 0; index < pixels.data.length; index += 4) { pixels.data[index] = 23; pixels.data[index + 1] = 33; pixels.data[index + 2] = 43; pixels.data[index + 3] = 255; }
    for (const mesh of meshes) for (let index = 0; index < mesh.indices.length; index += 3) {
      const projectedVertex = (vertex: number) => {
        const point = project(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
        return { x: 104 + (point.x - (minX + maxX) / 2) * scale, y: 84 + (point.y - (minY + maxY) / 2) * scale, depth: point.depth };
      };
      const points = [projectedVertex(mesh.indices[index]), projectedVertex(mesh.indices[index + 1]), projectedVertex(mesh.indices[index + 2])];
      if (points.some(point => ![point.x, point.y, point.depth].every(Number.isFinite))) throw new Error("History mesh has invalid triangles.");
      const [a, b, c] = points;
      // Outward triangle winding faces this camera when screen area is negative, independent of smooth normals.
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (area >= -1e-12) continue;
      let nx = 0, ny = 0, nz = 0;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = mesh.indices[index + corner], normal = [mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]];
        if (!normal.every(Number.isFinite)) throw new Error("History mesh has invalid normals.");
        nx += normal[0]; ny += normal[1]; nz += normal[2];
      }
      const normalLength = Math.max(Math.hypot(nx, ny, nz), 1e-9);
      const shade = Math.max(0.28, Math.min(1, 0.52 + (0.25 * nx + 0.15 * ny + 0.4 * nz) / normalLength));
      const color = (highlight && changed.has(mesh.bodyId) ? [74, 217, 240] : [176, 185, 194]).map(value => Math.round(value * shade));
      const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), right = Math.min(canvas.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), bottom = Math.min(canvas.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const px = x + 0.5, py = y + 0.5;
        const wa = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const wb = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area, wc = 1 - wa - wb;
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
        const depth = wa * a.depth + wb * b.depth + wc * c.depth, pixel = y * canvas.width + x;
        if (depth < depthBuffer[pixel]) continue;
        depthBuffer[pixel] = depth;
        pixels.data[pixel * 4] = color[0]; pixels.data[pixel * 4 + 1] = color[1]; pixels.data[pixel * 4 + 2] = color[2];
      }
    }
    context.putImageData(pixels, 0, 0);
    if (!meshes.length) { context.fillStyle = "#b3bfcb"; context.font = "13px sans-serif"; context.textAlign = "center"; context.fillText("No solid yet", 104, 84); }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (blob.size > 100000) throw new Error("History thumbnail exceeds its image resource limit.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:image/png;base64,${btoa(binary)}`;
  };
  return { beforeImage: await draw(before, false), afterImage: await draw(after, true) };
}
