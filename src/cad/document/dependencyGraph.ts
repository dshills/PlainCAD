import type { CadDocument, SelectionRef } from "./schema";
import { documentTimeline } from "./timelineOrdering";
import { targetBodyIds } from "./timelineEditing";
import { stableBodyIdForFeature } from "../features/featureGraph";
import {
  mapDocumentExpressions,
  parameterTokens,
} from "../parameters/expressionBindings";

export type DependencyKind = "parameter" | "sketch" | "feature";
export const dependencyKey = (kind: DependencyKind, id: string) =>
  JSON.stringify([kind, id]);
export interface DependencyNode {
  key: string;
  kind: DependencyKind;
  id: string;
  label: string;
  missing: boolean;
  suppressed?: boolean;
  malformedExpression?: boolean;
}
export interface DependencyEdge {
  from: string;
  to: string;
  reasons: string[];
}
export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  inputs: Map<string, DependencyEdge[]>;
  outputs: Map<string, DependencyEdge[]>;
  bodyWriters: Map<string, string>;
  entitySketches: Map<string, string>;
}

// Read-only authored dependencies, including missing/suppressed references.
export function buildDependencyGraph(document: CadDocument): DependencyGraph {
  const nodes = new Map<string, DependencyNode>(),
    edges = new Map<string, DependencyEdge>();
  const add = (
    kind: DependencyKind,
    id: string,
    label: string,
    missing = false,
    suppressed = false,
  ) => {
    const key = dependencyKey(kind, id);
    if (!nodes.has(key))
      nodes.set(key, { key, kind, id, label, missing, suppressed });
    return key;
  };
  for (const p of Object.values(document.parameters))
    add("parameter", p.id, p.name);
  const entitySketches = new Map<string, string>();
  for (const sketch of Object.values(document.sketches)) {
    add("sketch", sketch.id, sketch.name);
    for (const id of Object.keys(sketch.entities))
      entitySketches.set(id, sketch.id);
  }
  for (const f of document.features)
    add("feature", f.id, f.name, false, f.suppressed);
  const reference = (kind: DependencyKind, id: string, label = id) =>
    add(kind, id, label, true);
  const connect = (from: string, to: string, reason: string) => {
    const key = JSON.stringify([from, to]);
    const edge = edges.get(key) ?? { from, to, reasons: [] };
    if (!edge.reasons.includes(reason)) edge.reasons.push(reason);
    edges.set(key, edge);
  };
  mapDocumentExpressions(document, (expression, source, id, field) => {
    const kind = source as DependencyKind,
      to = dependencyKey(kind, id);
    let names: string[];
    try {
      names = parameterTokens(expression.expression).map((t) => t.value);
    } catch {
      const node = nodes.get(to);
      if (node) node.malformedExpression = true;
      names = Object.keys(expression.parameterRefs ?? {});
    }
    const reason =
      source === "parameter"
        ? "Parameter expression"
        : source === "sketch"
          ? field === "offset"
            ? "Plane offset"
            : field.startsWith("dimension:")
              ? "Driving dimension"
              : "Sketch geometry"
          : field === "termination.distance"
            ? "Termination distance"
            : field.charAt(0).toUpperCase() + field.slice(1);
    for (const name of names) {
      const bound =
        expression.parameterRefs &&
        Object.hasOwn(expression.parameterRefs, name)
          ? expression.parameterRefs[name]
          : undefined;
      const parameter = Object.hasOwn(document.parameters, name)
        ? document.parameters[name]
        : undefined;
      const parameterId = bound ?? parameter?.id ?? `unbound:${name}`;
      connect(
        reference(
          "parameter",
          parameterId,
          bound ? `Lost parameter ${parameterId}` : `Unbound parameter ${name}`,
        ),
        to,
        reason,
      );
    }
    return expression;
  });
  const owners = new Map(
    document.features
      .filter(
        (f) =>
          (f.type === "extrude" || f.type === "revolve") &&
          f.operation === "newBody",
      )
      .map((f) => [stableBodyIdForFeature(f.id), f]),
  );
  const bodyWriters = new Map<string, string>();
  for (const item of documentTimeline(document)) {
    if (item.kind === "sketch") {
      const p = item.sketch.plane,
        face =
          p.type === "face"
            ? p
            : p.type === "offset" && typeof p.base !== "string"
              ? p.base
              : undefined;
      if (face)
        connect(
          reference("feature", face.featureId),
          dependencyKey("sketch", item.sketch.id),
          "Sketch plane face",
        );
      continue;
    }
    const f = item.feature,
      to = dependencyKey("feature", f.id);
    if ("sketchId" in f)
      connect(reference("sketch", f.sketchId), to, "Source sketch");
    if (f.type === "revolve" && f.axis.type === "sketchLine")
      connect(reference("sketch", f.axis.sketchId), to, "Axis line sketch");
    if (f.type === "extrude" && f.termination?.type === "toFace")
      connect(
        reference("feature", f.termination.faceRef.featureId),
        to,
        "Termination face",
      );
    for (const bodyId of new Set(targetBodyIds(f))) {
      const owner = owners.get(bodyId);
      const activeWriter = bodyWriters.get(bodyId);
      const writer = activeWriter ?? owner?.id;
      const reason = activeWriter
        ? "Target body / preceding modifier"
        : owner?.suppressed
          ? "Target body / suppressed owner"
          : owner
            ? "Target body / downstream owner"
            : "Target body reference";
      connect(
        writer
          ? reference("feature", writer)
          : reference(
              "feature",
              `target:${bodyId}`,
              `Lost target body ${bodyId}`,
            ),
        to,
        reason,
      );
    }
    // Suppressed operations retain authored edges but never become an active writer.
    if (!f.suppressed) {
      if (
        (f.type === "extrude" || f.type === "revolve") &&
        f.operation === "newBody"
      )
        bodyWriters.set(stableBodyIdForFeature(f.id), f.id);
      else for (const bodyId of targetBodyIds(f)) bodyWriters.set(bodyId, f.id);
    }
  }
  const inputs = new Map<string, DependencyEdge[]>(),
    outputs = new Map<string, DependencyEdge[]>();
  for (const edge of edges.values()) {
    const incoming = inputs.get(edge.to) ?? [];
    incoming.push(edge);
    inputs.set(edge.to, incoming);
    const outgoing = outputs.get(edge.from) ?? [];
    outgoing.push(edge);
    outputs.set(edge.from, outgoing);
  }
  return { nodes, inputs, outputs, bodyWriters, entitySketches };
}

export function dependencySelectionKey(
  graph: DependencyGraph,
  selection: SelectionRef | undefined,
  documentId: string,
): string | undefined {
  if (!selection || selection.documentId !== documentId) return undefined;
  const kind = selection.kind;
  if (kind === "body") {
    const writer = graph.bodyWriters.get(selection.id);
    return writer ? dependencyKey("feature", writer) : undefined;
  }
  if (kind === "sketchEntity") {
    const sketch = graph.entitySketches.get(selection.id);
    return sketch ? dependencyKey("sketch", sketch) : undefined;
  }
  if (kind !== "parameter" && kind !== "feature" && kind !== "sketch")
    return undefined;
  const key = dependencyKey(kind, selection.id);
  return graph.nodes.has(key) ? key : undefined;
}
export interface DependencyEntry {
  node: DependencyNode;
  distance: number;
  via: DependencyNode;
  reasons: string[];
}
export function traceDependencies(
  graph: DependencyGraph,
  root: string,
  direction: "inputs" | "outputs",
) {
  const entries: DependencyEntry[] = [],
    seen = new Set([root]),
    queue = [{ key: root, distance: 0 }];
  let cycle = false;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const edge of graph[direction].get(current.key) ?? []) {
      const key = direction === "inputs" ? edge.from : edge.to;
      if (key === root) cycle = true;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = graph.nodes.get(key),
        via = graph.nodes.get(current.key);
      if (!node || !via) continue;
      const distance = current.distance + 1;
      entries.push({
        node,
        distance,
        via,
        reasons: [...edge.reasons],
      });
      queue.push({ key, distance });
    }
  }
  return { entries, cycle };
}
