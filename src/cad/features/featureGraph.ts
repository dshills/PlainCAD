import { stableBodyIdForFeature } from "../document/ids";
export { stableBodyIdForFeature } from "../document/ids";
import { targetBodyIds } from "../document/bodyScopes";
import { MODEL_RESOURCE_LIMITS } from "../resourceLimits";
import { CadDocument, Feature, ValidationIssue } from "../document/schema";

export interface FeatureGraphIssue {
  id: string;
  source: Extract<ValidationIssue["source"], "sketch" | "feature">;
  featureId?: string;
  sourceId?: string;
  message: string;
}

export interface FeatureGraphPlan {
  orderedFeatures: Feature[];
  errors: FeatureGraphIssue[];
  warnings: FeatureGraphIssue[];
}

export function planFeatureGraph(document: CadDocument): FeatureGraphPlan {
  const errors: FeatureGraphIssue[] = [];
  const warnings: FeatureGraphIssue[] = [];
  const orderedFeatures = [...document.features].sort(compareFeatures);
  const stepOwner = new Map<number, string>();
  for (const sketch of Object.values(document.sketches).sort((a, b) =>
    compareStrings(a.id, b.id),
  )) {
    if (sketch.timelineStep === undefined) continue;
    const owner = stepOwner.get(sketch.timelineStep);
    if (owner) {
      errors.push({
        id: `sketch:${sketch.id}:timeline-duplicate`,
        source: "sketch",
        sourceId: sketch.id,
        message: `Sketch timeline step ${sketch.timelineStep} is already used by ${owner}.`,
      });
    }
    stepOwner.set(sketch.timelineStep, `sketch:${sketch.id}`);
  }

  for (const feature of orderedFeatures) {
    if (feature.timelineStep !== undefined) {
      const owner = stepOwner.get(feature.timelineStep);
      if (owner) {
        errors.push({
          id: `feature:${feature.id}:timeline-duplicate`,
          source: "feature",
          featureId: feature.id,
          sourceId: feature.id,
          message: `Feature timeline step ${feature.timelineStep} is already used by ${owner}.`,
        });
      }
      stepOwner.set(feature.timelineStep, `feature:${feature.id}`);
    }

    if (
      feature.type === "extrude" ||
      feature.type === "revolve" ||
      feature.type === "hole"
    ) {
      const sketch = document.sketches[feature.sketchId];
      if (!sketch) {
        errors.push({
          id: `feature:${feature.id}:missing-sketch`,
          source: "feature",
          featureId: feature.id,
          sourceId: feature.id,
          message: `${feature.type} "${feature.name}" references missing sketch "${feature.sketchId}".`,
        });
        continue;
      }
      if (
        sketch.timelineStep !== undefined &&
        feature.timelineStep !== undefined &&
        feature.timelineStep <= sketch.timelineStep
      ) {
        errors.push({
          id: `feature:${feature.id}:order`,
          source: "feature",
          featureId: feature.id,
          sourceId: feature.id,
          message: `${feature.type} "${feature.name}" must appear after its required sketch "${sketch.name}" in the timeline.`,
        });
      }
      if (feature.suppressed) {
        warnings.push({
          id: `feature:${feature.id}:suppressed`,
          source: "feature",
          featureId: feature.id,
          sourceId: feature.id,
          message: `Feature "${feature.name}" is suppressed and will not generate a body.`,
        });
      }
    }
  }

  const featureDepths = new Map<string, number>(),
    bodyDepths = new Map<string, number>();
  for (const feature of orderedFeatures) {
    if (feature.suppressed) continue;
    const targets = targetBodyIds(feature);
    let depth = 1;
    for (const id of targets)
      depth = Math.max(depth, 1 + (bodyDepths.get(id) ?? 0));
    if ("sketchId" in feature) {
      const plane = document.sketches[feature.sketchId]?.plane;
      const ref =
        plane?.type === "face"
          ? plane
          : plane?.type === "offset" && typeof plane.base !== "string"
            ? plane.base
            : undefined;
      if (ref)
        depth = Math.max(depth, 1 + (featureDepths.get(ref.featureId) ?? 0));
    }
    if (feature.type === "extrude" && feature.termination?.type === "toFace")
      depth = Math.max(
        depth,
        1 + (featureDepths.get(feature.termination.faceRef.featureId) ?? 0),
      );
    featureDepths.set(feature.id, depth);
    if (
      (feature.type === "extrude" || feature.type === "revolve") &&
      feature.operation === "newBody"
    )
      bodyDepths.set(stableBodyIdForFeature(feature.id), depth);
    else for (const id of targets) bodyDepths.set(id, depth);
    if (depth > MODEL_RESOURCE_LIMITS.maxFeatureDependencyDepth)
      errors.push({
        id: `feature:${feature.id}:depth`,
        source: "feature",
        sourceId: feature.id,
        message:
          "Feature dependency chain exceeds the resource limit. Split the project into smaller models.",
      });
  }
  return { orderedFeatures, errors, warnings };
}

function compareFeatures(a: Feature, b: Feature): number {
  const aStep = a.timelineStep ?? Number.MAX_SAFE_INTEGER;
  const bStep = b.timelineStep ?? Number.MAX_SAFE_INTEGER;
  if (aStep !== bStep) return aStep - bStep;
  const aCreated = a.createdAt ?? "";
  const bCreated = b.createdAt ?? "";
  if (aCreated < bCreated) return -1;
  if (aCreated > bCreated) return 1;
  return compareStrings(a.id, b.id);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
