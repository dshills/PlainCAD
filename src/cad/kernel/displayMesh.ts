import type { CadDocument } from "../document/schema";
import type { BoundingBox, KernelAdapter, KernelShape, RenderMesh } from "./KernelAdapter";
import { MODEL_RESOURCE_LIMITS } from "../resourceLimits";

export interface DisplayMesh {
  bodyId: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface DisplayMeshRequest {
  document: CadDocument;
  bodies: ReadonlyArray<{ id: string; bounds: BoundingBox; volume: number }>;
}

type NativeBody = { shape: KernelShape; mesh?: RenderMesh };

/** Tighten chord error by model scale and keep angular error bounded for small rounds and helices. */
export function refineNativeDisplayMeshes(
  kernel: KernelAdapter, bodies: ReadonlyMap<string, NativeBody>, requests: DisplayMeshRequest["bodies"],
): DisplayMesh[] {
  if (!requests.length || requests.length > MODEL_RESOURCE_LIMITS.maxBodies ||
      new Set(requests.map(body => body.id)).size !== requests.length)
    throw new Error("Close-up detail requires a bounded set of current native bodies.");
  let triangles = 0, vertices = 0;
  const refined: DisplayMesh[] = [];
  for (const request of requests) {
    const source = bodies.get(request.id);
    const mesh = source?.mesh;
    if (!source || mesh?.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid ||
        Math.abs(mesh.geometryAssertions.volume - request.volume) > Math.max(1e-6, request.volume * 1e-8) ||
        !(["min", "max"] as const).every(bound => mesh.bounds[bound].every((value, index) =>
          Math.abs(value - request.bounds[bound][index]) <= 1e-6)))
      throw new Error("The close-up rebuild did not match the accepted geometry.");
    const span = Math.hypot(...mesh.bounds.max.map((value, i) => value - mesh.bounds.min[i]));
    const detail = kernel.tessellate(source.shape, {
      linearDeflection: Math.min(.08, Math.max(.0001, span * .00035)),
      angularDeflection: .08,
      analyticNormals: true,
    });
    if (detail.geometrySource !== "opencascade" || !detail.geometryAssertions?.valid)
      throw new Error("Fine display requires valid native tessellation.");
    triangles += detail.indices.length / 3;
    vertices += detail.positions.length / 3;
    if (triangles > MODEL_RESOURCE_LIMITS.maxTriangles || vertices > MODEL_RESOURCE_LIMITS.maxVerticesPerBody)
      throw new Error("Fine display tessellation exceeds its resource limit.");
    refined.push({
      bodyId: request.id,
      positions: new Float32Array(detail.positions),
      normals: new Float32Array(detail.normals),
      indices: new Uint32Array(detail.indices),
    });
  }
  return refined;
}
