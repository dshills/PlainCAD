export const MODEL_RESOURCE_LIMITS = {
  maxBodies: 64,
  maxTrianglesPerBody: 100000,
  maxTriangles: 250000,
  maxVerticesPerBody: 300000,
  maxFeatureDependencyDepth: 100,
  maxIntersectionTests: 2000000,
} as const;

export function assertMeshBudget(vertexCount: number, triangleCount: number) {
  if (
    vertexCount > MODEL_RESOURCE_LIMITS.maxVerticesPerBody ||
    triangleCount > MODEL_RESOURCE_LIMITS.maxTrianglesPerBody
  )
    throw new Error(
      "Mesh exceeds the per-body resource limit. Simplify the model or use coarser tessellation.",
    );
}
