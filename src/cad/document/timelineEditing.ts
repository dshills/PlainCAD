import { featureComponentId, sketchComponentId } from "./components";
import { absorbedBodyIds, targetBodyIds } from "./bodyScopes";
export { absorbedBodyIds, targetBodyIds } from "./bodyScopes";
import { CadDocument, Feature, SelectionRef } from "./schema";
import { touchDocument } from "./CadDocument";
import { documentTimeline, timelineItemId } from "./timelineOrdering";
import {
  planFeatureGraph,
  stableBodyIdForFeature,
} from "../features/featureGraph";
import { faceOwnerModifiedBefore } from "../sketch/planes";

export type TimelineDirection = "earlier" | "later";
export type TimelineMove =
  | { document: CadDocument; reason?: never }
  | { reason: string; document?: never };

// The same immutable plan drives UI availability and command execution.
const moveCache = new WeakMap<CadDocument, Map<string, TimelineMove>>();
export function planTimelineMove(
  document: CadDocument,
  selection: SelectionRef | undefined,
  direction: TimelineDirection,
): TimelineMove {
  if (
    !selection ||
    selection.documentId !== document.id ||
    (selection.kind !== "sketch" && selection.kind !== "feature")
  )
    return { reason: "Select a sketch or feature to move." };
  const key = `${selection.kind}:${selection.id}:${direction}`;
  let plans = moveCache.get(document);
  if (!plans) {
    plans = new Map();
    moveCache.set(document, plans);
  }
  const cached = plans.get(key);
  if (cached) return cached;
  const ordered = documentTimeline(document);
  const index = ordered.findIndex(
    (item) =>
      item.kind === selection.kind && timelineItemId(item) === selection.id,
  );
  const neighbor = index + (direction === "earlier" ? -1 : 1);
  let result: TimelineMove;
  if (index < 0)
    result = { reason: "Selected timeline item no longer exists." };
  else if (neighbor < 0 || neighbor >= ordered.length)
    result = {
      reason: `Already at the ${direction === "earlier" ? "start" : "end"} of the timeline.`,
    };
  else {
    [ordered[index], ordered[neighbor]] = [ordered[neighbor], ordered[index]];
    const steps = new Map(
      ordered.map((item, i) => [`${item.kind}:${timelineItemId(item)}`, i + 1]),
    );
    const candidate: CadDocument = {
      ...document,
      sketches: Object.fromEntries(
        Object.entries(document.sketches).map(([id, sketch]) => [
          id,
          { ...sketch, timelineStep: steps.get(`sketch:${sketch.id}`)! },
        ]),
      ),
      features: document.features.map((feature) => ({
        ...feature,
        timelineStep: steps.get(`feature:${feature.id}`)!,
      })),
      timelineCursor: ordered.length,
    };
    const reason =
      timelineDependencyErrors(candidate)[0] ??
      modifierOrderError(document, candidate);
    result = reason ? { reason } : { document: candidate };
  }
  // Selection alone must not retain thousands of full candidate documents.
  if (plans.size >= 8) plans.delete(plans.keys().next().value!);
  plans.set(key, result);
  return result;
}

export function moveTimelineItem(
  document: CadDocument,
  selection: SelectionRef | undefined,
  direction: TimelineDirection,
): CadDocument {
  const plan = planTimelineMove(document, selection, direction);
  if (plan.reason) throw new Error(plan.reason);
  return touchDocument(plan.document!);
}

export function timelineDependencyErrors(document: CadDocument): string[] {
  const errors = planFeatureGraph(document).errors.map(
    (error) => error.message,
  );
  // All dependency comparisons share the displayed order, including mixed legacy records.
  const normalizedSteps = new Map(
    documentTimeline(document).map((item, index) => [
      `${item.kind}:${timelineItemId(item)}`,
      index + 1,
    ]),
  );
  document = {
    ...document,
    sketches: Object.fromEntries(
      Object.entries(document.sketches).map(([id, sketch]) => [
        id,
        {
          ...sketch,
          timelineStep: normalizedSteps.get(`sketch:${sketch.id}`)!,
        },
      ]),
    ),
    features: document.features.map((feature) => ({
      ...feature,
      timelineStep: normalizedSteps.get(`feature:${feature.id}`)!,
    })),
  };
  const owners = new Map(
    document.features.map((feature) => [feature.id, feature]),
  );
  const bodyOwners = new Map(
    document.features
      .filter(
        (f) =>
          (f.type === "extrude" || f.type === "revolve") &&
          f.operation === "newBody",
      )
      .map((f) => [stableBodyIdForFeature(f.id), f]),
  );
  const requireOwner = (
    ownerId: string,
    consumer: { name: string; timelineStep?: number },
    role: string,
    face = false,
  ) => {
    const owner = owners.get(ownerId);
    if (!owner)
      errors.push(
        `${consumer.name}: ${role} reference lost. Reselect its owner before moving the timeline.`,
      );
    else if (
      (owner.timelineStep ?? Infinity) >= (consumer.timelineStep ?? Infinity)
    )
      errors.push(
        `${consumer.name} must appear after ${role} owner ${owner.name}.`,
      );
    else if (face && faceOwnerModifiedBefore(document, ownerId, consumer))
      errors.push(
        `${consumer.name}: ${role} owner ${owner.name} is modified before this reference. Repair the reference or move its modifier later.`,
      );
  };
  for (const sketch of Object.values(document.sketches)) {
    const plane = sketch.plane;
    const ref =
      plane.type === "face"
        ? plane
        : plane.type === "offset" && typeof plane.base !== "string"
          ? plane.base
          : undefined;
    if (ref) requireOwner(ref.featureId, sketch, "sketch plane", true);
  }
  const absorbed = new Map<string, Feature>();
  for (const item of documentTimeline(document)) {
    if (item.kind !== "feature") continue;
    const feature = item.feature;
    for (const target of targetBodyIds(feature)) {
      const owner = bodyOwners.get(target);
      const join = absorbed.get(target);
      if (join && !feature.suppressed)
        errors.push(
          `${feature.name}: target ${target} was absorbed by ${join.name}. Reselect its surviving body.`,
        );
      if (!owner)
        errors.push(
          `${feature.name}: target reference lost (${target}). Reselect an upstream body.`,
        );
      else requireOwner(owner.id, feature, "target body");
    }
    for (const id of absorbedBodyIds(feature)) absorbed.set(id, feature);
    if (feature.type === "extrude" && feature.termination?.type === "toFace")
      requireOwner(
        feature.termination.faceRef.featureId,
        feature,
        "termination face",
        true,
      );
    if (feature.type === "revolve" && feature.axis.type === "sketchLine") {
      const sketch = document.sketches[feature.axis.sketchId];
      if (
        !sketch ||
        (sketch.timelineStep ?? Infinity) >= (feature.timelineStep ?? Infinity)
      )
        errors.push(`${feature.name} must appear after its axis sketch.`);
    }
    if (feature.type === "fillet" || feature.type === "chamfer")
      for (const ref of feature.targetEdgeRefs)
        requireOwner(ref.featureId, feature, "edge");
  }
  return errors;
}

function modifierOrderError(
  before: CadDocument,
  after: CadDocument,
): string | undefined {
  const chains = (document: CadDocument) => {
    const result = new Map<string, string[]>();
    for (const item of documentTimeline(document)) {
      if (item.kind !== "feature") continue;
      for (const id of targetBodyIds(item.feature))
        result.set(id, [...(result.get(id) ?? []), item.feature.id]);
    }
    return result;
  };
  const original = chains(before);
  for (const [body, ids] of chains(after))
    if (ids.join("\0") !== original.get(body)?.join("\0"))
      return "Modifiers on the same body must keep their existing order to preserve geometry references.";
  return undefined;
}

export function upstreamBodyOwners(
  document: CadDocument,
  consumer: Feature,
  includeSuppressed = false,
): Feature[] {
  const consumerComponent = featureComponentId(document, consumer);
  const items = documentTimeline(document);
  const index = items.findIndex(
    (item) => item.kind === "feature" && item.feature.id === consumer.id,
  );
  const prefix = items.slice(0, Math.max(index, 0));
  const absorbed = new Set(
    prefix.flatMap((item) =>
      item.kind === "feature" ? absorbedBodyIds(item.feature) : [],
    ),
  );
  return prefix.flatMap((item) =>
    item.kind === "feature" &&
    featureComponentId(document, item.feature) === consumerComponent &&
    !absorbed.has(stableBodyIdForFeature(item.feature.id)) &&
    (includeSuppressed || !item.feature.suppressed) &&
    (item.feature.type === "extrude" || item.feature.type === "revolve") &&
    item.feature.operation === "newBody"
      ? [item.feature]
      : [],
  );
}

export function upstreamSketches(document: CadDocument, consumer: Feature) {
  const consumerComponent = featureComponentId(document, consumer);
  const items = documentTimeline(document);
  const index = items.findIndex(
    (item) => item.kind === "feature" && item.feature.id === consumer.id,
  );
  return items
    .slice(0, Math.max(index, 0))
    .flatMap((item) => (item.kind === "sketch" && sketchComponentId(document, item.sketch.id) === consumerComponent ? [item.sketch] : []));
}
