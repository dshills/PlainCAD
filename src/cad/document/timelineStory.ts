import type { CadDocument, Feature } from "./schema";
import { documentTimeline } from "./timelineOrdering";

const MAX_STORY_TIMELINE_STEPS = 160;

/** Independent immutable history snapshots; future sketches cannot poison an earlier rebuild. */
export function timelineStoryDocuments(document: CadDocument, featureId: string): { before: CadDocument; after: CadDocument; feature: Feature } {
  const timeline = documentTimeline(document);
  const index = timeline.findIndex(item => item.kind === "feature" && item.feature.id === featureId);
  const item = timeline[index];
  if (item?.kind !== "feature") throw new Error("This feature no longer exists in the project history.");
  if (index >= MAX_STORY_TIMELINE_STEPS) throw new Error(`This history preview exceeds ${MAX_STORY_TIMELINE_STEPS} timeline steps. Inspect an earlier feature or simplify the project.`);
  const prefix = (length: number): CadDocument => {
    const steps = timeline.slice(0, length);
    return { ...document, timelineCursor: length, sketches: Object.fromEntries(steps.flatMap(step => step.kind === "sketch" ? [[step.sketch.id, step.sketch]] : [])), features: steps.flatMap(step => step.kind === "feature" ? [step.feature] : []) };
  };
  return { before: prefix(index), after: prefix(index + 1), feature: item.feature };
}

/** Preserve authored names and describe the actual operation alongside them. */
export function timelineFeatureIntent(feature: Feature): string {
  if (feature.suppressed) return "Suppressed · geometry unchanged";
  if (feature.type === "extrude") return feature.operation === "cut" ? "Cut a sketch profile" : feature.operation === "join" ? "Add material from a sketch" : "Create a part from a sketch";
  if (feature.type === "revolve") return feature.operation === "cut" ? "Cut around an axis" : feature.operation === "join" ? "Add material around an axis" : "Revolve a sketch into a part";
  if (feature.type === "hole") return "Remove material for a hole";
  if (feature.type === "fillet") return "Round selected edges";
  if (feature.type === "chamfer") return "Bevel selected edges";
  if (feature.type === "pattern") return "Repeat geometry in a pattern";
  return "Inspect this modeling operation";
}
