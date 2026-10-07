import type { CadDocument } from "../document/schema";
import { documentTimeline, timelineItemId } from "../document/timelineOrdering";
import type { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";
import type { RebuildError } from "../worker/workerProtocol";
import { stableBodyIdForFeature } from "./featureGraph";
import { projectionSource } from "../sketch/sketchProjection";
import type { NativeEdgeProofCache } from "./nativeEdgeProofCache";

export function nativeProjectionValidator(document: CadDocument, kernel: KernelAdapter, bodies: ReadonlyMap<string, { shape: KernelShape; mesh?: RenderMesh }>, failed: ReadonlySet<string>, errors: RebuildError[], native: boolean, cache?: NativeEdgeProofCache) {
  const timeline = documentTimeline(document);
  const rank = new Map(timeline.map((item, index) => [timelineItemId(item), index]));
  const pending = timeline.flatMap((item) => item.kind === "sketch" && item.sketch.projections?.length ? [item.sketch] : []);
  const invalidSketchIds = new Set<string>();
  let next = 0;
  const validateUntil = (limit: number) => {
    while (next < pending.length && rank.get(pending[next].id)! < limit) {
      const sketch = pending[next++];
      try {
        if (!native || !kernel.availableExtrudeCapEdges) throw new Error("Linked projections require native OpenCascade boundary validation.");
        for (const projection of sketch.projections!) {
          const source = projectionSource(document, sketch, projection);
          const bodyId = stableBodyIdForFeature(source.id), body = bodies.get(bodyId);
          if (!body || failed.has(bodyId)) throw new Error("Projected boundary owner failed or was absorbed. Reselect an upstream cap or delete the link.");
          const edges = cache ? cache.read(kernel, body.shape) : kernel.availableExtrudeCapEdges(body.shape);
          if (!edges.some((edge) => edge.role === projection.role && !edge.sourceEntityId)) throw new Error("Projected boundary was trimmed, split or lost. Reselect a complete cap or delete the link; geometry was not guessed.");
        }
      } catch (error) {
        invalidSketchIds.add(sketch.id);
        errors.push({ id: `sketch:${sketch.id}:native-projection`, source: "sketch", sourceId: sketch.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  return { invalidSketchIds, beforeFeature: (id: string) => { const position = rank.get(id); if (position !== undefined) validateUntil(position); }, finish: () => validateUntil(Infinity) };
}
