import {
  CURRENT_SCHEMA_VERSION,
  CadDocument,
  CadParameter,
  ExtrudeFeature,
  Feature,
  Sketch,
} from "./schema";
import { createId } from "./ids";

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
  return touchDocument({
    ...document,
    sketches: { ...document.sketches, [sketch.id]: sketch },
  });
}

export function upsertFeature(document: CadDocument, feature: Feature): CadDocument {
  const existing = document.features.findIndex((item) => item.id === feature.id);
  const features =
    existing >= 0
      ? document.features.map((item) => (item.id === feature.id ? feature : item))
      : [...document.features, feature];
  return touchDocument({ ...document, features });
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
