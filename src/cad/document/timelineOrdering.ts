import { CadDocument, Feature, Sketch } from "./schema";
import { sketchIdForFeature } from "../features/featureMetadata";

export type TimelineItem =
  { kind: "sketch"; sketch: Sketch } | { kind: "feature"; feature: Feature };

export function buildTimelineItems(
  sketches: Sketch[],
  features: Feature[],
): TimelineItem[] {
  const firstFeatureTimeBySketchId = new Map<string, string>();
  features.forEach((feature) => {
    const sketchId = sketchIdForFeature(feature);
    if (
      sketchId &&
      feature.createdAt &&
      !firstFeatureTimeBySketchId.has(sketchId)
    ) {
      firstFeatureTimeBySketchId.set(sketchId, feature.createdAt);
    }
  });
  const records = [
    ...sketches.map((sketch, index) => ({
      item: { kind: "sketch", sketch } as TimelineItem,
      timelineStep: sketch.timelineStep,
      order: sketch.createdAt ?? firstFeatureTimeBySketchId.get(sketch.id),
      fallbackIndex: index,
    })),
    ...features.map((feature, index) => ({
      item: { kind: "feature", feature } as TimelineItem,
      timelineStep: feature.timelineStep,
      order: feature.createdAt,
      fallbackIndex: sketches.length + index,
    })),
  ];
  const legacyOrder = records
    .filter((record) => record.timelineStep === undefined)
    .sort(compareLegacyTimelineRecords);
  const legacyRankByIndex = new Map(
    legacyOrder.map((record, index) => [record.fallbackIndex, index + 1]),
  );

  return records
    .sort((a, b) => {
      const byStep =
        effectiveTimelineStep(a, legacyRankByIndex) -
        effectiveTimelineStep(b, legacyRankByIndex);
      if (byStep !== 0) return byStep;
      return compareLegacyTimelineRecords(a, b);
    })
    .map(({ item }) => item);
}

function effectiveTimelineStep(
  record: { timelineStep?: number; fallbackIndex: number },
  legacyRankByIndex: Map<number, number>,
): number {
  const legacyCount = legacyRankByIndex.size;
  return record.timelineStep === undefined
    ? (legacyRankByIndex.get(record.fallbackIndex) ?? record.fallbackIndex + 1)
    : legacyCount + record.timelineStep;
}

function compareLegacyTimelineRecords(
  a: { order?: string; fallbackIndex: number },
  b: { order?: string; fallbackIndex: number },
): number {
  if (a.order !== b.order) {
    if (a.order && b.order) return a.order.localeCompare(b.order);
    if (a.order) return -1;
    if (b.order) return 1;
  }

  return a.fallbackIndex - b.fallbackIndex;
}

export function documentTimeline(document: CadDocument): TimelineItem[] {
  return buildTimelineItems(
    Object.values(document.sketches).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    document.features,
  );
}

export function timelineItemId(item: TimelineItem): string {
  return item.kind === "sketch" ? item.sketch.id : item.feature.id;
}
