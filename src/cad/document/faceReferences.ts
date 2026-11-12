import type { CadDocument, FacePlaneReference, Feature } from "./schema";
import { stableBodyIdForFeature } from "./ids";

export const pocketFloorId = (featureId: string) => `extrude:${featureId}:pocketFloor`;
export const MAX_MACHINED_REFERENCES = 64;

export function pocketFloorTarget(feature: Feature): string | undefined {
  if (feature.type !== "extrude" || feature.suppressed || feature.operation !== "cut" ||
      feature.direction !== "negative" || (feature.termination && feature.termination.type !== "distance") ||
      feature.targetBodyIds?.length !== 1) return;
  return feature.targetBodyIds[0];
}

/** Resolve authored ownership only. A native stage must prove that the actual face survives. */
export function faceReferenceBodyId(document: CadDocument, reference: Pick<FacePlaneReference, "featureId" | "stableFaceId" | "lost">): string | undefined {
  if (reference.lost) return;
  const owner = document.features.find(feature => feature.id === reference.featureId);
  if (!owner || owner.type !== "extrude" || owner.suppressed || (owner.termination && owner.termination.type !== "distance")) return;
  if (reference.stableFaceId === pocketFloorId(owner.id)) return pocketFloorTarget(owner);
  const prefix = `extrude:${owner.id}:`;
  if (owner.operation !== "newBody" || !reference.stableFaceId.startsWith(prefix)) return;
  const role = reference.stableFaceId.slice(prefix.length);
  if (role === "startCap" || role === "endCap" || (role.startsWith("side:") && role.length > 5)) return stableBodyIdForFeature(owner.id);
}
