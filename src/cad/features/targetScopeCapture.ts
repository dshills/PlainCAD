import { validateDocument } from "../document/validate";
import { assertProjectJsonShape } from "../../persistence/importSafety";
import type {
  CadDocument,
  ExtrudeFeature,
  HoleFeature,
  RevolveFeature,
} from "../document/schema";
import { upsertFeature } from "../document/CadDocument";
import { documentTimeline } from "../document/timelineOrdering";
import { upstreamBodyOwners } from "../document/timelineEditing";
import { stableBodyIdForFeature } from "../document/ids";
import { rebuildDocument } from "./rebuildGraph";

export type ScopedFeature = ExtrudeFeature | RevolveFeature | HoleFeature;
export function scopeFeatureFromDocument(
  document: CadDocument,
  featureId: string,
): ScopedFeature {
  assertProjectJsonShape(document);
  const issues = validateDocument(document, "storage");
  if (issues.length) throw new Error(issues[0].message);
  const feature =
    typeof featureId === "string"
      ? document.features.find((f) => f.id === featureId)
      : undefined;
  if (
    !feature ||
    feature.suppressed ||
    !(
      feature.type === "hole" ||
      ((feature.type === "extrude" || feature.type === "revolve") &&
        feature.operation !== "newBody")
    )
  )
    throw new Error("Select an active cut, join, or hole to capture targets.");
  return feature;
}

export function prepareScopeCapture(
  document: CadDocument,
  feature: ScopedFeature,
): CadDocument {
  if (
    feature.suppressed ||
    (feature.type !== "hole" && feature.operation === "newBody")
  )
    throw new Error("Select an active cut, join, or hole to capture targets.");
  const staged = upsertFeature(document, feature);
  const stored = staged.features.find((f) => f.id === feature.id)!;
  const candidates = upstreamBodyOwners(staged, stored).map((f) =>
    stableBodyIdForFeature(f.id),
  );
  // A join's first target owns the surviving identity. Retargeting must keep
  // that primary first when it still intersects, even if authored later.
  if (feature.type !== "hole" && feature.operation === "join") {
    const primary = feature.targetBodyIds?.[0];
    const index = primary ? candidates.indexOf(primary) : -1;
    if (index > 0) candidates.unshift(...candidates.splice(index, 1));
  }
  if (!candidates.length)
    throw new Error(
      "No surviving upstream bodies are available for scope capture.",
    );
  const ordered = documentTimeline(staged);
  const index = ordered.findIndex(
    (item) => item.kind === "feature" && item.feature.id === feature.id,
  );
  if (index < 0)
    throw new Error("Scope feature was not found in the timeline.");
  const prefix = ordered.slice(0, index + 1);
  const sketchIds = new Set(
    prefix.flatMap((item) => (item.kind === "sketch" ? [item.sketch.id] : [])),
  );
  // Probe only the feature's upstream history. Downstream failures or bodies must
  // neither block this repair nor become implicit targets.
  return {
    ...staged,
    sketches: Object.fromEntries(
      Object.entries(staged.sketches).filter(([id]) => sketchIds.has(id)),
    ),
    features: prefix.flatMap((item) =>
      item.kind === "feature"
        ? [
            {
              ...item.feature,
              ...(item.feature.id === feature.id
                ? {
                    targetBodyIds: candidates,
                    ...(item.feature.type === "hole"
                      ? { targetBodyId: undefined, targetFeatureId: undefined }
                      : {}),
                  }
                : {}),
            },
          ]
        : [],
    ),
  };
}
export function captureDocumentTargetScope(
  document: CadDocument,
  feature: ScopedFeature,
): string[] {
  const probe = prepareScopeCapture(document, feature);
  const result = rebuildDocument(probe, {
    captureTargetScopeFeatureId: feature.id,
  });
  if (!result.success)
    throw new Error(result.errors.map((e) => e.message).join(" "));
  if (!result.capturedTargetBodyIds?.length)
    throw new Error(
      "The tool intersects no upstream body volume. Adjust the feature or choose targets explicitly; face-only contact is not captured.",
    );
  return result.capturedTargetBodyIds;
}
