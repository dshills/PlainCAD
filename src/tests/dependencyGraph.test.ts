import { describe, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import {
  bindDocumentExpressions,
  renameParameter,
} from "../cad/parameters/expressionBindings";
import {
  createExtrudeFeature,
  upsertFeature,
  upsertParameter,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  buildDependencyGraph,
  dependencyKey,
  dependencySelectionKey,
  traceDependencies,
} from "../cad/document/dependencyGraph";
import { addCircleAt, createSketchOnPlane } from "../cad/sketch/SketchModel";
import type { CadDocument, ExtrudeFeature } from "../cad/document/schema";
import { stableBodyIdForFeature } from "../cad/features/featureGraph";

const labels = (
  document: CadDocument,
  kind: "parameter" | "sketch" | "feature",
  id: string,
  direction: "inputs" | "outputs",
) => {
  const graph = buildDependencyGraph(document);
  return traceDependencies(
    graph,
    dependencyKey(kind, id),
    direction,
  ).entries.map((e) => e.node.label);
};
describe("authored dependency inspection", () => {
  it("traces parameter chains, stable renamed bindings, features, planes and geometry without editing the document", () => {
    let doc = bindDocumentExpressions(createBoxTemplate());
    doc = bindDocumentExpressions(
      upsertParameter(doc, {
        id: "stock",
        name: "stock",
        expression: "width / 2",
        value: 0,
        unit: "mm",
      }),
    );
    const width = doc.parameters.width.id,
      original = JSON.stringify(doc);
    expect(labels(doc, "parameter", width, "outputs")).toEqual(
      expect.arrayContaining(["stock", "Box Base", "Box Extrude"]),
    );
    expect(labels(doc, "feature", doc.features[0].id, "inputs")).toEqual(
      expect.arrayContaining(["width", "height", "depth", "Box Base"]),
    );
    expect(JSON.stringify(doc)).toBe(original);
    const renamed = renameParameter(doc, width, "span");
    expect(labels(renamed, "parameter", width, "outputs")).toContain("stock");
    expect(
      labels(renamed, "parameter", renamed.parameters.stock.id, "inputs"),
    ).toEqual(["span"]);
  });
  it("keeps modifier chains, suppressed intent and missing targets visible; body/entity selection maps to authored owners", () => {
    let doc = bindDocumentExpressions(createBoxTemplate());
    const owner = doc.features[0],
      body = stableBodyIdForFeature(owner.id);
    const sketch = addCircleAt(
      createSketchOnPlane("Face tool", {
        type: "face",
        featureId: owner.id,
        stableFaceId: `${owner.id}:face:endCap`,
      }),
      "0mm",
      "0mm",
      "2mm",
    );
    doc = upsertSketch(doc, sketch);
    const first = createExtrudeFeature({
      name: "First cut",
      sketchId: sketch.id,
      profileId: "unused",
      operation: "cut",
      direction: "negative",
      targetBodyIds: [body],
      distance: { expression: "5mm", unit: "mm" },
    });
    doc = upsertFeature(doc, first);
    const suppressed = {
      ...first,
      id: "suppressed",
      name: "Suppressed cut",
      timelineStep: undefined,
      suppressed: true,
    };
    doc = upsertFeature(doc, suppressed);
    doc = upsertFeature(doc, {
      ...first,
      id: "last",
      name: "Last cut",
      timelineStep: undefined,
      targetBodyIds: [body, "body:gone"],
    });
    const graph = buildDependencyGraph(doc),
      last = dependencyKey("feature", "last");
    const inputs = traceDependencies(graph, last, "inputs");
    expect(
      inputs.entries.find((e) => e.node.label === "First cut")?.distance,
    ).toBe(1);
    expect(
      inputs.entries.find((e) => e.node.label === "Box Extrude")?.distance,
    ).toBeGreaterThan(1);
    expect(
      inputs.entries.find((e) => e.node.label === "Lost target body body:gone")
        ?.node.missing,
    ).toBe(true);
    expect(inputs.entries.map((e) => e.node.label)).not.toContain(
      "Suppressed cut",
    );
    expect(
      graph.nodes.get(dependencyKey("feature", "suppressed"))?.suppressed,
    ).toBe(true);
    expect(labels(doc, "feature", owner.id, "outputs")).toContain("Face tool");
    expect(
      dependencySelectionKey(
        graph,
        { kind: "body", id: body, documentId: doc.id },
        doc.id,
      ),
    ).toBe(last);
    expect(
      dependencySelectionKey(
        graph,
        {
          kind: "sketchEntity",
          id: Object.keys(sketch.entities)[0],
          documentId: doc.id,
        },
        doc.id,
      ),
    ).toBe(dependencyKey("sketch", sketch.id));
    expect(
      dependencySelectionKey(
        graph,
        { kind: "feature", id: owner.id, documentId: "stale" },
        doc.id,
      ),
    ).toBeUndefined();
  });
  it("retains missing bound IDs instead of retargeting reused names and safely bounds cyclic/malformed chains", () => {
    let doc = bindDocumentExpressions(createBoxTemplate());
    const sketch = Object.values(doc.sketches)[0],
      p = Object.values(sketch.entities).find((e) => e.type === "point")!;
    if (p.type !== "point") throw new Error("Missing fixture point");
    doc = upsertSketch(doc, {
      ...sketch,
      entities: {
        ...sketch.entities,
        [p.id]: {
          ...p,
          x: {
            ...p.x,
            expression: "width",
            parameterRefs: { width: "removed-id" },
          },
        },
      },
    });
    const missing = traceDependencies(
      buildDependencyGraph(doc),
      dependencyKey("sketch", sketch.id),
      "inputs",
    ).entries.find((e) => e.node.id === "removed-id");
    expect(missing?.node.missing).toBe(true);
    for (const [name, expression] of [
      ["a", "b"],
      ["b", "a"],
      ["bad", "@"],
    ] as const)
      doc = upsertParameter(doc, {
        id: name,
        name,
        expression,
        value: 0,
        unit: "",
      });
    const graph = buildDependencyGraph(doc),
      trace = traceDependencies(
        graph,
        dependencyKey("parameter", "a"),
        "inputs",
      );
    expect(trace.cycle).toBe(true);
    expect(trace.entries.map((e) => e.node.label)).toEqual(["b"]);
    expect(
      graph.nodes.get(dependencyKey("parameter", "bad"))?.malformedExpression,
    ).toBe(true);
    doc = upsertFeature(doc, {
      ...(doc.features[0] as ExtrudeFeature),
      termination: {
        type: "toFace",
        faceRef: {
          kind: "face",
          featureId: "missing-face-owner",
          stableHint: "cap",
          transientId: "missing-face",
        },
      },
    });
    expect(labels(doc, "feature", doc.features[0].id, "inputs")).toContain(
      "missing-face-owner",
    );
  });
  it("labels suppressed and downstream body owners without promoting them to active owners", () => {
    let doc = bindDocumentExpressions(createBoxTemplate());
    const owner = doc.features[0] as ExtrudeFeature,
      body = stableBodyIdForFeature(owner.id);
    const cut = {
      ...owner,
      id: "future-target",
      name: "Early cut",
      operation: "cut" as const,
      targetBodyIds: [body],
      timelineStep: 0,
    };
    doc = upsertFeature(doc, cut);
    let graph = buildDependencyGraph(doc);
    expect(
      graph.inputs
        .get(dependencyKey("feature", cut.id))
        ?.find((e) => e.from === dependencyKey("feature", owner.id))?.reasons,
    ).toContain("Target body / downstream owner");
    doc = upsertFeature(doc, { ...owner, suppressed: true });
    graph = buildDependencyGraph(doc);
    expect(
      graph.inputs
        .get(dependencyKey("feature", cut.id))
        ?.find((e) => e.from === dependencyKey("feature", owner.id))?.reasons,
    ).toContain("Target body / suppressed owner");
    const trace = traceDependencies(
      graph,
      dependencyKey("feature", cut.id),
      "inputs",
    );
    const entry = trace.entries.find((e) => e.node.id === owner.id)!;
    entry.reasons.push("changed by consumer");
    expect(
      graph.inputs
        .get(dependencyKey("feature", cut.id))
        ?.flatMap((e) => e.reasons),
    ).not.toContain("changed by consumer");
  });
});
