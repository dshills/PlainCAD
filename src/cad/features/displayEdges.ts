import type { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";
import type { RebuildWarning } from "../worker/workerProtocol";
import { MAX_BODY_EDGE_SEGMENTS, MAX_PROJECT_EDGE_SEGMENTS, MAX_PROJECT_EDGE_USES } from "../kernel/nativeDisplayEdges";

/** Attach presentation buffers to the final feature outputs before applying
 * component poses, while the native face triangulations are still available. */
export function attachDisplayEdges(
  kernel: KernelAdapter,
  bodies: Iterable<{ shape: KernelShape; mesh?: RenderMesh }>,
  warnings: RebuildWarning[],
) {
  if (!kernel.nativeDisplayEdges) return;
  let remaining = MAX_PROJECT_EDGE_SEGMENTS;
  const budget = { edgeUses: MAX_PROJECT_EDGE_USES };
  for (const body of bodies) {
    if (!body.mesh || body.mesh.geometrySource !== "opencascade") continue;
    try {
      if (!remaining) throw new Error("The project exceeds the display segment budget.");
      if (budget.edgeUses <= 0) throw new Error("Project exceeds the native edge traversal budget.");
      const nativeEdgeSegments = kernel.nativeDisplayEdges(body.shape, Math.min(remaining, MAX_BODY_EDGE_SEGMENTS), budget);
      remaining -= nativeEdgeSegments.length / 6;
      body.mesh = { ...body.mesh, nativeEdgeSegments };
    } catch (error) {
      warnings.push({
        id: `mesh:${body.mesh.bodyId}:display-edges`,
        source: "kernel",
        sourceId: body.mesh.bodyId,
        message: `CAD edge display skipped. ${error instanceof Error ? error.message : "Native edge sampling failed."}`,
      });
    }
  }
}
