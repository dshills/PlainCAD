import { featureComponentId, sketchComponentId } from "../document/components";
import type { CadDocument, ExtrudeFeature } from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import { stableBodyIdForFeature } from "./featureGraph";

/** Shared authored intent. Neither a caller-provided face frame nor a mesh is durable. */
export function facePocketFeature(document: CadDocument, feature: ExtrudeFeature, bodyId: string): ExtrudeFeature {
  const plane = document.sketches[feature.sketchId]?.plane;
  const owner = plane?.type === "face" && !plane.lost && document.features.find(item => item.id === plane.featureId);
  if (!owner || owner.suppressed || owner.type !== "extrude" || owner.operation !== "newBody" ||
      (owner.termination && owner.termination.type !== "distance") || stableBodyIdForFeature(owner.id) !== bodyId ||
      featureComponentId(document, owner) !== sketchComponentId(document, feature.sketchId))
    throw new Error("Pocket requires a current face sketch and its explicit native body in the same component.");
  if (feature.termination?.type === "toFace") throw new Error("An inward pocket supports Distance or Through All termination.");
  return { ...feature, operation: "cut", direction: "negative", targetBodyIds: [bodyId] };
}

export function assertPocketCut(result: RebuildResult, bodyId: string, baseVolume: number) {
  const mesh = result.meshes.find(item => item.bodyId === bodyId);
  const proof = mesh?.geometryAssertions;
  if (mesh?.geometrySource !== "opencascade" || mesh.kernelOperation !== "cut" || !proof?.valid ||
      proof.solidCount !== 1 || !(proof.volume > 0) ||
      !(proof.volume < baseVolume - Math.max(1e-7, baseVolume * 1e-9)))
    throw new Error("The pocket must remove measurable material and leave one valid native solid. Move the region onto the face or reduce the depth.");
}
