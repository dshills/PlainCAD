import { Feature } from "../document/schema";

const sketchBasedFeatureTypes = new Set<Feature["type"]>(["extrude", "hole"]);

export function sketchIdForFeature(feature: Feature): string | undefined {
  if (sketchBasedFeatureTypes.has(feature.type) && "sketchId" in feature) return feature.sketchId;
  return undefined;
}
