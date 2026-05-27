import {
  CURRENT_SCHEMA_VERSION,
  CadDocument,
  CadParameter,
  ExtrudeFeature,
  Feature,
  Sketch,
} from "./schema";
import { createId } from "./ids";
import { sketchIdForFeature } from "../features/featureMetadata";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyDocument(name = "Untitled"): CadDocument {
  const timestamp = nowIso();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId("doc"),
    name,
    units: "metric",
    unitSettings: { length: "mm", angle: "deg" },
    createdAt: timestamp,
    updatedAt: timestamp,
    timelineCursor: 0,
    parameters: {},
    sketches: {},
    features: [],
  };
}

export function touchDocument(document: CadDocument): CadDocument {
  return { ...document, updatedAt: nowIso() };
}

export function upsertParameter(document: CadDocument, parameter: CadParameter): CadDocument {
  return touchDocument({
    ...document,
    parameters: { ...document.parameters, [parameter.name]: parameter },
  });
}

export function removeParameter(document: CadDocument, name: string): CadDocument {
  const parameters = { ...document.parameters };
  delete parameters[name];
  return touchDocument({ ...document, parameters });
}

export function upsertSketch(document: CadDocument, sketch: Sketch): CadDocument {
  const baseDocument = ensureTimelineMetadata(document);
  const current = baseDocument.sketches[sketch.id];
  const timelineStep = sketch.timelineStep ?? current?.timelineStep ?? nextTimelineStep(baseDocument);
  const nextSketch = {
    ...sketch,
    timelineStep,
    createdAt: sketch.createdAt ?? current?.createdAt ?? nowIso(),
  };
  return touchDocument({
    ...baseDocument,
    timelineCursor: Math.max(baseDocument.timelineCursor ?? 0, timelineStep),
    sketches: { ...baseDocument.sketches, [sketch.id]: nextSketch },
  });
}

export function upsertFeature(document: CadDocument, feature: Feature): CadDocument {
  const baseDocument = ensureTimelineMetadata(document);
  const existing = baseDocument.features.findIndex((item) => item.id === feature.id);
  const existingFeature = existing >= 0 ? baseDocument.features[existing] : undefined;
  const timelineStep = feature.timelineStep ?? existingFeature?.timelineStep ?? nextTimelineStep(baseDocument);
  const nextFeature = {
    ...feature,
    timelineStep,
    createdAt: feature.createdAt ?? existingFeature?.createdAt ?? nowIso(),
  };
  const features =
    existing >= 0
      ? baseDocument.features.map((item) => (item.id === feature.id ? nextFeature : item))
      : [...baseDocument.features, nextFeature];
  return touchDocument({ ...baseDocument, timelineCursor: Math.max(baseDocument.timelineCursor ?? 0, timelineStep), features });
}

export function suppressFeature(document: CadDocument, featureId: string, suppressed: boolean): CadDocument {
  return touchDocument({
    ...document,
    features: document.features.map((feature) =>
      feature.id === featureId ? { ...feature, suppressed } : feature,
    ),
  });
}

export function deleteFeature(document: CadDocument, featureId: string): CadDocument {
  return touchDocument({
    ...document,
    features: document.features.filter((feature) => feature.id !== featureId),
  });
}

export function createExtrudeFeature(input: Omit<ExtrudeFeature, "id" | "type" | "createdAt">): ExtrudeFeature {
  return {
    ...input,
    id: createId("feature"),
    type: "extrude",
    createdAt: nowIso(),
  };
}

function nextTimelineStep(document: CadDocument): number {
  return (document.timelineCursor ?? maxExistingTimelineStep(document)) + 1;
}

function maxExistingTimelineStep(document: CadDocument): number {
  let maxStep = 0;
  for (const sketchId in document.sketches) {
    const sketch = document.sketches[sketchId];
    if (sketch.timelineStep !== undefined && sketch.timelineStep > maxStep) {
      maxStep = sketch.timelineStep;
    }
  }
  for (const feature of document.features) {
    if (feature.timelineStep !== undefined && feature.timelineStep > maxStep) {
      maxStep = feature.timelineStep;
    }
  }
  return maxStep;
}

function ensureTimelineMetadata(document: CadDocument): CadDocument {
  const hasCursor = document.timelineCursor !== undefined;
  const sketches = Object.values(document.sketches);
  const hasMissingSketchSteps = sketches.some((sketch) => sketch.timelineStep === undefined);
  const hasMissingFeatureSteps = document.features.some((feature) => feature.timelineStep === undefined);
  if (hasCursor && !hasMissingSketchSteps && !hasMissingFeatureSteps) return document;
  if (!hasMissingSketchSteps && !hasMissingFeatureSteps) {
    return { ...document, timelineCursor: maxExistingTimelineStep(document) };
  }

  const firstFeatureTimeBySketchId = new Map<string, string>();
  for (const feature of document.features) {
    const sketchId = sketchIdForFeature(feature);
    if (sketchId && feature.createdAt) {
      const current = firstFeatureTimeBySketchId.get(sketchId);
      if (!current || feature.createdAt < current) {
        firstFeatureTimeBySketchId.set(sketchId, feature.createdAt);
      }
    }
  }
  const ordered = [
    ...sketches.map((sketch, index) => ({
      kind: "sketch" as const,
      id: sketch.id,
      timelineStep: sketch.timelineStep,
      order: sketch.createdAt ?? firstFeatureTimeBySketchId.get(sketch.id),
      fallbackIndex: index,
    })),
    ...document.features.map((feature, index) => ({
      kind: "feature" as const,
      id: feature.id,
      timelineStep: feature.timelineStep,
      order: feature.createdAt,
      fallbackIndex: sketches.length + index,
    })),
  ].sort((a, b) => compareTimelineSeedRecords(a, b));

  const stepByKey = new Map<string, number>();
  let nextStep = 0;
  for (const item of ordered) {
    nextStep += 1;
    stepByKey.set(`${item.kind}:${item.id}`, nextStep);
  }
  const nextSketches = Object.fromEntries(
    Object.entries(document.sketches).map(([id, sketch]) => [id, { ...sketch, timelineStep: stepByKey.get(`sketch:${id}`) ?? sketch.timelineStep }]),
  );
  const nextFeatures = document.features.map((feature) => ({
    ...feature,
    timelineStep: stepByKey.get(`feature:${feature.id}`) ?? feature.timelineStep,
  }));

  return {
    ...document,
    sketches: nextSketches,
    features: nextFeatures,
    timelineCursor: nextStep,
  };
}

function compareTimelineSeedRecords(
  a: { timelineStep?: number; order?: string; fallbackIndex: number },
  b: { timelineStep?: number; order?: string; fallbackIndex: number },
): number {
  if (a.timelineStep !== undefined && b.timelineStep !== undefined) {
    const byStep = a.timelineStep - b.timelineStep;
    if (byStep !== 0) return byStep;
  }
  if (a.timelineStep !== undefined && b.timelineStep === undefined) return 1;
  if (a.timelineStep === undefined && b.timelineStep !== undefined) return -1;
  if (a.order && b.order) {
    const byTime = a.order.localeCompare(b.order);
    if (byTime !== 0) return byTime;
  }
  if (a.order && !b.order) return -1;
  if (!a.order && b.order) return 1;
  return a.fallbackIndex - b.fallbackIndex;
}
