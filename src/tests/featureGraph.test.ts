import { describe, expect, it } from "vitest";
import { createExtrudeFeature, deleteFeature, suppressFeature, upsertFeature } from "../cad/document/CadDocument";
import { ExtrudeFeature } from "../cad/document/schema";
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
