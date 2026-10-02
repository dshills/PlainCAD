import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import type { CadBody } from "../cad/worker/workerProtocol";

import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";

export function selectFabricationBodies(
  meshes: RenderMesh[],
  bodies: CadBody[],
  ids?: readonly string[],
): { meshes: RenderMesh[]; bodies: CadBody[] } {
  if (ids === undefined) return { meshes, bodies };
  if (!ids.length) throw new Error("Select at least one body for STL export.");
  if (
    ids.length > MODEL_RESOURCE_LIMITS.maxBodies ||
    new Set(ids).size !== ids.length
  )
    throw new Error(
      "STL body selection is duplicated or exceeds the body limit.",
    );
  const available = new Set(meshes.map((mesh) => mesh.bodyId));
  if (ids.some((id) => !available.has(id)))
    throw new Error(
      "A selected body is no longer available. Select export bodies again.",
    );
  const selected = new Set(ids);
  return {
    meshes: meshes.filter((mesh) => selected.has(mesh.bodyId)),
    bodies: bodies.filter((body) => selected.has(body.id)),
  };
}
