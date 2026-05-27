import { describe, expect, it } from "vitest";
import { createExtrudeFeature, deleteFeature, suppressFeature, upsertFeature } from "../cad/document/CadDocument";
import { ExtrudeFeature } from "../cad/document/schema";
import { planFeatureGraph, stableBodyIdForFeature } from "../cad/features/featureGraph";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createBoxTemplate } from "../templates/templates";

describe("feature graph rebuild", () => {
  it("skips suppressed extrude features", () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    const result = rebuildDocument(suppressFeature(document, feature.id, true));
    expect(result.success).toBe(true);
    expect(result.bodies).toHaveLength(0);
    expect(result.meshes).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.message.includes("suppressed"))).toBe(true);
  });

  it("reports missing sketch references", () => {
    const document = createBoxTemplate();
    const result = rebuildDocument({ ...document, sketches: {} });
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.message.includes("missing sketch"))).toBe(true);
  });

  it("reports missing profile references without falling back to another profile", () => {
    const document = createBoxTemplate();
    const feature = document.features[0] as ExtrudeFeature;
    const result = rebuildDocument(upsertFeature(document, { ...feature, profileId: "missing_profile" }));
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.message.includes("missing_profile"))).toBe(true);
    expect(result.bodies).toHaveLength(0);
  });

  it("reports unsupported extrude operations and directions", () => {
    let document = createBoxTemplate();
    const feature = document.features[0] as ExtrudeFeature;
    document = upsertFeature(document, { ...feature, operation: "join" });
    expect(rebuildDocument(document).errors[0].message).toContain("not supported");

    document = createBoxTemplate();
    document = upsertFeature(document, { ...(document.features[0] as ExtrudeFeature), direction: "symmetric" });
    expect(rebuildDocument(document).errors[0].message).toContain("not supported");
  });

  it("uses stable body ids derived from source features", () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    const first = rebuildDocument(document);
    const second = rebuildDocument({
      ...document,
      parameters: {
        ...document.parameters,
        width: { ...document.parameters.width, expression: "120mm" },
      },
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.bodies[0]).toMatchObject({ id: stableBodyIdForFeature(feature.id), featureId: feature.id });
    expect(second.bodies[0].id).toBe(first.bodies[0].id);
    expect(first.meshes[0].bodyId).toBe(first.bodies[0].id);
    expect(first.bodies[0].triangleCount).toBeGreaterThan(0);
    expect(first.bodies[0].bounds).toBeTruthy();
  });

  it("rejects feature reordering before required sketches", () => {
    const document = createBoxTemplate();
    const sketch = Object.values(document.sketches)[0];
    const feature = document.features[0] as ExtrudeFeature;
    const reordered = upsertFeature(
      {
        ...document,
        sketches: { ...document.sketches, [sketch.id]: { ...sketch, timelineStep: 10 } },
      },
      { ...feature, timelineStep: 1 },
    );

    const result = rebuildDocument(reordered);

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.message.includes("must appear after"))).toBe(true);
  });

  it("rejects duplicate timeline steps across sketches and features", () => {
    const document = createBoxTemplate();
    const sketch = Object.values(document.sketches)[0];
    const feature = document.features[0] as ExtrudeFeature;
    const invalid = {
      ...document,
      sketches: { ...document.sketches, [sketch.id]: { ...sketch, timelineStep: 1 } },
      features: [{ ...feature, timelineStep: 1 }],
    };

    const plan = planFeatureGraph(invalid);

    expect(plan.errors.some((error) => error.message.includes("already used"))).toBe(true);
  });

  it("allows legacy documents without timeline steps to rebuild", () => {
    const document = createBoxTemplate();
    const sketch = Object.values(document.sketches)[0];
    const feature = document.features[0] as ExtrudeFeature;
    const legacy = {
      ...document,
      timelineCursor: undefined,
      sketches: { ...document.sketches, [sketch.id]: { ...sketch, timelineStep: undefined } },
      features: [{ ...feature, timelineStep: undefined }],
    };

    const result = rebuildDocument(legacy);

    expect(result.success).toBe(true);
    expect(result.bodies).toHaveLength(1);
  });

  it("plans features in deterministic timeline order", () => {
    const document = createBoxTemplate();
    const base = document.features[0] as ExtrudeFeature;
    const later = createExtrudeFeature({
      name: "Later",
      sketchId: base.sketchId,
      profileId: base.profileId,
      operation: "newBody",
      distance: { expression: "5mm", unit: "mm" },
      direction: "positive",
    });
    const outOfArrayOrder = { ...document, features: [{ ...later, timelineStep: 20 }, { ...base, timelineStep: 10 }] };

    expect(planFeatureGraph(outOfArrayOrder).orderedFeatures.map((feature) => feature.name)).toEqual([base.name, "Later"]);
  });

  it("deletes features from the timeline", () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    expect(deleteFeature(document, feature.id).features).toHaveLength(0);
  });

  it("creates extrude features with timeline metadata", () => {
    const feature = createExtrudeFeature({
      name: "Manual Extrude",
      sketchId: "sketch_1",
      profileId: "sketch_1:profile:rectangle",
      operation: "newBody",
      distance: { expression: "10mm", unit: "mm" },
      direction: "positive",
    });
    expect(feature.type).toBe("extrude");
    expect(feature.createdAt).toBeTruthy();
  });
});
