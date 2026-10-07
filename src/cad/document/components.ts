import type {
  CadComponent,
  CadDocument,
  Feature,
  SelectionRef,
} from "./schema";
import { createId } from "./ids";
import { targetBodyIds } from "./bodyScopes";
import { MODEL_RESOURCE_LIMITS } from "../resourceLimits";

export function sketchComponentId(
  document: CadDocument,
  sketchId: string,
): string {
  return document.sketches[sketchId]?.componentId ?? document.rootComponentId;
}

export function featureComponentId(
  document: CadDocument,
  feature: Feature,
): string {
  if (feature.componentId) return feature.componentId;
  if ("sketchId" in feature)
    return sketchComponentId(document, feature.sketchId);
  const ownerId = feature.type === "pattern" ? feature.sourceFeatureId : feature.targetEdgeRefs[0]?.featureId;
  const owner = document.features.find((item) => item.id === ownerId);
  // Supported edge owners are new-body extrusions, so this never follows recursive refs.
  return (
    owner?.componentId ??
    (owner && "sketchId" in owner
      ? sketchComponentId(document, owner.sketchId)
      : document.rootComponentId)
  );
}

export function bodyComponentId(
  document: CadDocument,
  bodyId: string,
): string | undefined {
  const feature = document.features.find(
    (item) => `body:${item.id}` === bodyId,
  );
  return feature ? featureComponentId(document, feature) : undefined;
}

export function selectionComponentId(
  document: CadDocument,
  selection?: SelectionRef,
): string | undefined {
  if (selection?.documentId !== document.id) return;
  if (selection.kind === "sketch")
    return document.sketches[selection.id]
      ? sketchComponentId(document, selection.id)
      : undefined;
  if (selection.kind === "sketchEntity") {
    const sketch = Object.values(document.sketches).find(
      (item) => item.entities[selection.id],
    );
    return (
      sketch?.componentId ?? (sketch ? document.rootComponentId : undefined)
    );
  }
  if (selection.kind === "body") return bodyComponentId(document, selection.id);
  if (selection.kind === "feature") {
    const feature = document.features.find((item) => item.id === selection.id);
    return feature ? featureComponentId(document, feature) : undefined;
  }
}

export function addComponent(
  document: CadDocument,
  name: string,
): { document: CadDocument; component: CadComponent } {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120)
    throw new Error("Component name must contain 1–120 characters.");
  if (
    Object.keys(document.components).length >=
    MODEL_RESOURCE_LIMITS.maxComponents
  )
    throw new Error(
      `Project has too many components (maximum ${MODEL_RESOURCE_LIMITS.maxComponents}, including the root).`,
    );
  const component = { id: createId("component"), name: trimmed };
  return {
    component,
    document: {
      ...document,
      components: { ...document.components, [component.id]: component },
      updatedAt: new Date().toISOString(),
    },
  };
}

export function componentScopeIssues(
  document: CadDocument,
): Array<{ source: "sketch" | "feature"; sourceId: string; message: string }> {
  const issues: ReturnType<typeof componentScopeIssues> = [];
  for (const sketch of Object.values(document.sketches)) {
    const owner = sketch.componentId ?? document.rootComponentId;
    const authoredOwner =
      sketch.componentId !== undefined ? sketch.componentId : owner;
    if (
      typeof authoredOwner !== "string" ||
      !Object.hasOwn(document.components, authoredOwner)
    )
      issues.push({
        source: "sketch",
        sourceId: sketch.id,
        message: "Sketch component was lost. Restore its component ownership.",
      });
  }
  for (const feature of document.features) {
    const owner = featureComponentId(document, feature);
    const authoredOwner =
      feature.componentId !== undefined ? feature.componentId : owner;
    if (
      typeof authoredOwner !== "string" ||
      !Object.hasOwn(document.components, authoredOwner)
    )
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Feature component was lost. Restore its component ownership.",
      });
    if (
      "sketchId" in feature &&
      document.sketches[feature.sketchId] &&
      sketchComponentId(document, feature.sketchId) !== owner
    )
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Feature and source sketch must belong to the same component.",
      });
    for (const target of targetBodyIds(feature)) {
      const targetOwner = bodyComponentId(document, target);
      if (targetOwner && targetOwner !== owner)
        issues.push({
          source: "feature",
          sourceId: feature.id,
          message:
            "Modeling targets must belong to the feature’s component. Select a body in this component.",
        });
    }
  }
  return issues;
}

export function renameComponent(
  document: CadDocument,
  id: string,
  name: string,
): CadDocument {
  const trimmed = name.trim();
  if (!Object.hasOwn(document.components, id))
    throw new Error("Component was lost. Select a current component.");
  if (!trimmed || trimmed.length > 120)
    throw new Error("Component name must contain 1–120 characters.");
  if (document.components[id].name === trimmed) return document;
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    components: {
      ...document.components,
      [id]: { ...document.components[id], name: trimmed },
    },
  };
}
