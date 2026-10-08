import type { CadDocument } from "../document/schema";
import { featureComponentId, sketchComponentId } from "../document/components";
import { documentTimeline } from "../document/timelineOrdering";
import { targetBodyIds } from "../document/bodyScopes";
import { stableBodyIdForFeature } from "./featureGraph";

/** Moving a source or destination can change downstream authored geometry through
 * world links. Independent solids still receive only a rigid placement. */
export function placedProjectionConsumerBodies(document: CadDocument, movedComponentId: string): Set<string> {
  const byId = new Map(document.features.map(feature => [feature.id, feature]));
  const sketches = new Set<string>(), features = new Set<string>(), bodies = new Set<string>();
  for (const item of documentTimeline(document)) {
    if (item.kind === "sketch") {
      const sketch = item.sketch, targetOwner = sketchComponentId(document, item.sketch.id);
      const plane = sketch.plane.type === "face" ? sketch.plane : sketch.plane.type === "offset" && typeof sketch.plane.base !== "string" ? sketch.plane.base : undefined;
      const affected = (plane && features.has(plane.featureId)) || sketch.projections?.some((projection) => {
        if (features.has(projection.sourceFeatureId)) return true;
        if (projection.coordinateSpace !== "world") return false;
        const source = byId.get(projection.sourceFeatureId);
        if (!source) return false;
        const sourceOwner = featureComponentId(document, source);
        return sourceOwner !== targetOwner && (sourceOwner === movedComponentId || targetOwner === movedComponentId);
      });
      if (affected) sketches.add(sketch.id);
      continue;
    }
    const feature = item.feature;
    if (feature.suppressed) continue;
    const targets = targetBodyIds(feature);
    const affected = ("sketchId" in feature && sketches.has(feature.sketchId)) || targets.some(id => bodies.has(id)) ||
      (feature.type === "pattern" && features.has(feature.sourceFeatureId)) ||
      (feature.type === "fit" && bodies.has(feature.sourceBodyId)) ||
      ((feature.type === "fillet" || feature.type === "chamfer") && feature.targetEdgeRefs.some(ref => features.has(ref.featureId))) ||
      (feature.type === "extrude" && feature.termination?.type === "toFace" && features.has(feature.termination.faceRef.featureId));
    if (!affected) continue;
    features.add(feature.id);
    if ((feature.type === "extrude" || feature.type === "revolve" || feature.type === "fit") && feature.operation === "newBody") bodies.add(stableBodyIdForFeature(feature.id));
    for (const id of targets) bodies.add(id);
  }
  return bodies;
}
