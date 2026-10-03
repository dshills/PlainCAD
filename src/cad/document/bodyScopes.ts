import type { Feature } from "./schema";
import { stableBodyIdForFeature } from "./ids";

export function targetBodyIds(feature: Feature): string[] {
  if (feature.type === "hole")
    return (
      feature.targetBodyIds ??
      (feature.targetBodyId
        ? [feature.targetBodyId]
        : feature.targetFeatureId
          ? [stableBodyIdForFeature(feature.targetFeatureId)]
          : [])
    );
  if (feature.type === "fillet" || feature.type === "chamfer")
    return [
      ...new Set(
        feature.targetEdgeRefs.map((ref) =>
          stableBodyIdForFeature(ref.featureId),
        ),
      ),
    ];
  return feature.operation === "newBody" ? [] : (feature.targetBodyIds ?? []);
}

// Saved scope order chooses the surviving body; suppression restores all targets.
export function absorbedBodyIds(feature: Feature): string[] {
  return !feature.suppressed &&
    (feature.type === "extrude" || feature.type === "revolve") &&
    feature.operation === "join"
    ? [...new Set((feature.targetBodyIds ?? []).slice(1))].filter(
        (id) => id !== feature.targetBodyIds?.[0],
      )
    : [];
}
