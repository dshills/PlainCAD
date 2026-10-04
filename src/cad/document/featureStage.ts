import type { CadDocument } from "./schema";
import { documentTimeline, timelineItemId } from "./timelineOrdering";

/** A runtime-only timeline snapshot for native choices and operation verification. */
export function documentAtFeature(
  document: CadDocument,
  featureId: string,
  includeFeature = false,
): CadDocument {
  const timeline = documentTimeline(document);
  const index = timeline.findIndex(
    (item) => item.kind === "feature" && item.feature.id === featureId,
  );
  if (index < 0)
    throw new Error("Feature no longer exists in the project timeline.");
  const ids = new Set(
    timeline.slice(0, index + (includeFeature ? 1 : 0)).map(timelineItemId),
  );
  return {
    ...document,
    sketches: Object.fromEntries(
      Object.entries(document.sketches).filter(([id]) => ids.has(id)),
    ),
    features: document.features.filter((feature) => ids.has(feature.id)),
  };
}
