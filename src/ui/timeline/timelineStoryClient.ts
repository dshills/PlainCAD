import StoryWorker from "./timelineStoryWorker?worker";
import { backgroundJob } from "../../persistence/backgroundJob";
import type { CadDocument } from "../../cad/document/schema";

export interface TimelineStory { beforeImage: string; afterImage: string; beforeVolume: number; afterVolume: number; beforeSolids: number; afterSolids: number; changedBodies: number; removedBodies: number }
export async function loadTimelineStory(document: CadDocument, featureId: string, signal: AbortSignal): Promise<TimelineStory> {
  const result = await backgroundJob<{ document: CadDocument; featureId: string }, TimelineStory>(StoryWorker, { document, featureId }, signal);
  if (signal.aborted) throw new Error("History preview cancelled.");
  return result;
}
