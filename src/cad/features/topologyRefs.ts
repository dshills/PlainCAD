import { CadDocument, ExtrudeFeature, TopologyRef } from "../document/schema";

export type SupportedEdgeRole =
  "profileEdge" | "startCapPerimeter" | "endCapPerimeter";

export interface ResolvedTopologyRef {
  ref: TopologyRef;
  feature: ExtrudeFeature;
  stableId: string;
}

export function createExtrudeEdgeRef(
  featureId: string,
  role: SupportedEdgeRole,
  sourceEntityId?: string,
): TopologyRef {
  return {
    featureId,
    kind: "edge",
    transientId: stableExtrudeEdgeId(featureId, role, sourceEntityId),
    stableHint: stableExtrudeEdgeId(featureId, role, sourceEntityId),
    role,
    ...(sourceEntityId ? { sourceEntityId } : {}),
  };
}

export function resolveSupportedEdgeRef(
  document: CadDocument,
  ref: TopologyRef,
): ResolvedTopologyRef | { error: string } {
  if (ref.kind !== "edge")
    return { error: "Edge treatment references must target edges." };
  if (ref.repairRequired)
    return { error: "Edge reference requires repair before rebuild." };
  if (!isSupportedEdgeRole(ref.role))
    return {
      error: "Edge reference is not a supported stable feature-owned edge.",
    };
  const feature = document.features.find(
    (item): item is ExtrudeFeature =>
      item.id === ref.featureId && item.type === "extrude",
  );
  if (!feature)
    return {
      error: "Edge reference owner feature was not found or is not an extrude.",
    };
  // Only new-body distance extrusions own these durable roles. Boolean-created
  // features do not acquire an independent body or reusable edge identity.
  if (
    feature.suppressed ||
    feature.operation !== "newBody" ||
    feature.direction !== "positive" ||
    (feature.termination && feature.termination.type !== "distance")
  )
    return {
      error:
        "Edge reference owner must be an active positive-distance new-body extrusion. Reselect a supported owner.",
    };
  const sketch = document.sketches[feature.sketchId];
  if (!sketch) return { error: "Edge reference owner sketch was not found." };
  if (ref.role === "profileEdge") {
    if (!ref.sourceEntityId)
      return {
        error: "Profile edge references require a source sketch entity.",
      };
    const entity = sketch.entities[ref.sourceEntityId];
    if (!entity || entity.type !== "line")
      return {
        error: "Profile edge source entity was not found or is not a line.",
      };
  }
  const stableId = stableExtrudeEdgeId(
    ref.featureId,
    ref.role,
    ref.sourceEntityId,
  );
  if (ref.stableHint && ref.stableHint !== stableId)
    return {
      error:
        "Edge reference stable identity no longer matches its feature role.",
    };
  return { ref, feature, stableId };
}

export function resolveSupportedEdgeRefs(
  document: CadDocument,
  refs: TopologyRef[],
): ResolvedTopologyRef[] | { error: string } {
  if (refs.length === 0)
    return { error: "Edge treatment requires at least one target edge." };
  const resolved: ResolvedTopologyRef[] = [];
  for (const ref of refs) {
    const item = resolveSupportedEdgeRef(document, ref);
    if ("error" in item) return item;
    resolved.push(item);
  }
  const owner = resolved[0].feature.id;
  if (resolved.some((item) => item.feature.id !== owner))
    return {
      error: "Edge treatment currently supports edges from one owner feature.",
    };
  return resolved;
}

function stableExtrudeEdgeId(
  featureId: string,
  role: SupportedEdgeRole,
  sourceEntityId?: string,
): string {
  return `extrude:${featureId}:${role}:${sourceEntityId ?? "all"}`;
}

function isSupportedEdgeRole(value: unknown): value is SupportedEdgeRole {
  return (
    value === "profileEdge" ||
    value === "startCapPerimeter" ||
    value === "endCapPerimeter"
  );
}
