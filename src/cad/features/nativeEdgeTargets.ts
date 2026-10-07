import type { CadDocument } from "../document/schema";
import type { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";
import type { AvailableEdge, RebuildWarning } from "../worker/workerProtocol";
import { stableBodyIdForFeature } from "./featureGraph";

/** Offer only original edges proven against the final native body.
 * Runtime metadata is bounded by document resource limits; the UI caps targets
 * after applying the active component and visibility filters. */
export function currentNativeEdges(
  document: CadDocument,
  kernel: KernelAdapter,
  bodies: ReadonlyMap<string, { shape: KernelShape; mesh?: RenderMesh }>,
  failedBodies: ReadonlySet<string>,
  warnings: RebuildWarning[] = [],
): AvailableEdge[] {
  if (!kernel.availableExtrudeCapEdges) return [];
  const groups: AvailableEdge[] = [], individual: AvailableEdge[] = [];
  for (const owner of document.features) {
    if (owner.type !== "extrude" || owner.suppressed || owner.operation !== "newBody" || (owner.termination && owner.termination.type !== "distance")) continue;
    const bodyId = stableBodyIdForFeature(owner.id), body = bodies.get(bodyId);
    if (!body || failedBodies.has(bodyId) || body.mesh?.geometrySource !== "opencascade" || !body.mesh.geometryAssertions?.valid || !["extrusion", "cut", "fuse"].includes(body.mesh.kernelOperation ?? "")) continue;
    try {
      for (const edge of kernel.availableExtrudeCapEdges(body.shape)) {
        const target = { ...edge, featureId: owner.id, bodyId };
        if (edge.sourceEntityId) {
          individual.push(target);
        } else {
          groups.push(target);
        }
      }
    } catch (error) {
      // Expected lost/split/smooth boundaries return no targets. Unexpected
      // native failures remain visible without invalidating already-valid solids.
      warnings.push({
        id: `feature:${owner.id}:edge-picking`,
        source: "kernel",
        sourceId: owner.id,
        message: `Native edge picking is unavailable for "${owner.name}": ${error instanceof Error ? error.message : String(error)}. Rebuild the model or simplify this part; its validated geometry is preserved.`,
      });
    }
  }
  return [...groups, ...individual];
}
