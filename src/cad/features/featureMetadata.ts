import { Feature } from "../document/schema";

export function sketchIdForFeature(feature: Feature): string | undefined {
  if ("sketchId" in feature && typeof feature.sketchId === "string") return feature.sketchId;
  return undefined;
}
