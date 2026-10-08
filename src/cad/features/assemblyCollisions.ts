import { bodyComponentId } from "../document/components";
import type { CadDocument } from "../document/schema";
import type { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";
/** Broad phase rejects disjoint boxes only. Positive answers require native common volume. */
export function assemblyCollisions(document: CadDocument, kernel: KernelAdapter, bodies: ReadonlyMap<string, { shape: KernelShape; mesh?: RenderMesh }>): { pairs: [string, string][]; complete: boolean } {
  if (!document.assemblyJoints?.length) return { pairs: [], complete: true };
  if (!kernel.hasCommonVolume) throw new Error("Assembly collision checks require native OpenCascade intersection support.");
  const entries = [...bodies], collisions: [string, string][] = []; let probes = 0;
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [aId, a] = entries[i], [bId, b] = entries[j];
    if (bodyComponentId(document, aId) === bodyComponentId(document, bId)) continue;
    if (!a.mesh || !b.mesh || a.mesh.geometrySource !== "opencascade" || b.mesh.geometrySource !== "opencascade") throw new Error("Assembly collision checks need current native solids for every component.");
    if ([0, 1, 2].some(axis => a.mesh!.bounds.max[axis] <= b.mesh!.bounds.min[axis] || b.mesh!.bounds.max[axis] <= a.mesh!.bounds.min[axis])) continue;
    if (++probes > 256) return { pairs: collisions, complete: false };
    if (kernel.hasCommonVolume(a.shape, b.shape)) collisions.push([aId, bId]);
  }
  return { pairs: collisions, complete: true };
}
