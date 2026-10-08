import { useEffect, useRef, useState } from "react";
import type { CadDocument } from "../../cad/document/schema";
import { timelineFeatureIntent } from "../../cad/document/timelineStory";
import { loadTimelineStory, type TimelineStory } from "./timelineStoryClient";
import "./timelineStory.css";

export default function TimelineStoryPreview({ document, featureId }: { document: CadDocument; featureId: string }) {
  const cache = useRef<{ document: CadDocument; items: Map<string, TimelineStory> }>({ document, items: new Map() });
  const [state, setState] = useState<{ document: CadDocument; featureId: string; story?: TimelineStory; error?: string }>();
  const feature = document.features.find(item => item.id === featureId);
  const current = state?.document === document && state.featureId === featureId ? state : undefined;
  useEffect(() => {
    if (cache.current.document !== document) cache.current = { document, items: new Map() };
    const cached = cache.current.items.get(featureId);
    if (cached) { setState({ document, featureId, story: cached }); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadTimelineStory(document, featureId, controller.signal).then(story => {
        if (controller.signal.aborted) return;
        if (cache.current.items.size >= 4) cache.current.items.delete(cache.current.items.keys().next().value!);
        cache.current.items.set(featureId, story);
        setState({ document, featureId, story });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ document, featureId, error: error instanceof Error ? error.message : String(error) });
      });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [document, featureId]);
  if (!feature) return null;
  const story = current?.story;
  const volume = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm³`;
  return <aside className="timeline-story" aria-label={`Build story: ${feature.name}`} data-native={story ? "true" : "false"} data-before-volume={story?.beforeVolume} data-after-volume={story?.afterVolume}>
    <div className="timeline-story-heading"><strong>{feature.name}</strong><span>{timelineFeatureIntent(feature)}</span></div>
    {!story ? <p role="status">{current?.error ?? "Building native before and after views…"}</p> : <>
      <div className="timeline-story-frames">
        <figure><img src={story.beforeImage} alt={`Solid geometry before ${feature.name}`} width="208" height="168" /><figcaption>Before · {story.beforeSolids} solids · {volume(story.beforeVolume)}</figcaption></figure>
        <span className="timeline-story-arrow" aria-hidden="true">→</span>
        <figure><img src={story.afterImage} alt={`Solid geometry after ${feature.name}; changed parts highlighted cyan`} width="208" height="168" /><figcaption>After · {story.afterSolids} solids · {volume(story.afterVolume)}</figcaption></figure>
      </div>
      <p className="timeline-story-summary">{story.changedBodies ? `${story.changedBodies} changed ${story.changedBodies === 1 ? "part" : "parts"} in cyan` : story.removedBodies ? `${story.removedBodies} removed ${story.removedBodies === 1 ? "part" : "parts"}` : "Geometry unchanged"} {story.changedBodies && story.removedBodies ? ` · ${story.removedBodies} removed ${story.removedBodies === 1 ? "part" : "parts"}` : ""} · {story.afterVolume >= story.beforeVolume ? "+" : "−"}{volume(Math.abs(story.afterVolume - story.beforeVolume))} material</p>
      <small>OpenCascade solids at this step, with current parameters. Preview only.</small>
    </>}
  </aside>;
}
