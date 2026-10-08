import type { RenderMesh } from "../../cad/kernel/KernelAdapter";
import type { RebuildResult } from "../../cad/worker/workerProtocol";

export interface StoryGeometry { meshes: RenderMesh[]; volume: number; solids: number }
export function nativeStoryGeometry(result: RebuildResult, label: string): StoryGeometry {
  if (!result.success || result.errors.length) throw new Error(`${label}: ${result.errors[0]?.message ?? "Native history rebuild failed."}`);
  let triangles = 0, volume = 0, solids = 0;
  for (const mesh of result.meshes) {
    const proof = mesh.geometryAssertions;
    if (mesh.geometrySource !== "opencascade" || !proof?.valid || !Number.isFinite(proof.volume) || proof.volume <= 0 || !Number.isSafeInteger(proof.solidCount) || proof.solidCount < 1) throw new Error(`${label}: this history step has no validated native solid geometry.`);
    triangles += mesh.indices.length / 3;
    volume += proof.volume; solids += proof.solidCount;
  }
  if (triangles > 25000) throw new Error(`${label}: history thumbnail exceeds 25,000 triangles. Inspect an earlier step or simplify the project.`);
  return { meshes: result.meshes, volume, solids };
}

export function changedStoryBodies(before: StoryGeometry, after: StoryGeometry): Set<string> {
  const previous = new Map(before.meshes.map(mesh => [mesh.bodyId, mesh]));
  return new Set(after.meshes.filter(mesh => {
    const old = previous.get(mesh.bodyId);
    return !old || old.geometryAssertions!.volume !== mesh.geometryAssertions!.volume || old.geometryAssertions!.surfaceArea !== mesh.geometryAssertions!.surfaceArea || old.geometryAssertions!.solidCount !== mesh.geometryAssertions!.solidCount || old.positions.length !== mesh.positions.length || old.indices.length !== mesh.indices.length || mesh.indices.some((value, index) => value !== old.indices[index]) || differentCoordinates(mesh.positions, old.positions);
  }).map(mesh => mesh.bodyId));
}

function differentCoordinates(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return true;
  return false;
}
