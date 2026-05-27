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

export function stableBodyIdForFeature(featureId: string): string {
  return `body:${featureId}`;
}

export function planFeatureGraph(document: CadDocument): FeatureGraphPlan {
  const errors: FeatureGraphIssue[] = [];
  const warnings: FeatureGraphIssue[] = [];
  const orderedFeatures = [...document.features].sort(compareFeatures);
  const stepOwner = new Map<number, string>();
  for (const sketch of Object.values(document.sketches).sort((a, b) => compareStrings(a.id, b.id))) {
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

    if (feature.type === "extrude" || feature.type === "revolve" || feature.type === "hole") {
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
      if (sketch.timelineStep !== undefined && feature.timelineStep !== undefined && feature.timelineStep <= sketch.timelineStep) {
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
