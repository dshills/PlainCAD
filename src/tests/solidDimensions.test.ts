import { expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { solidDimensions } from "../cad/inspection/solidDimensions";
import { stableBodyIdForFeature } from "../cad/features/featureGraph";

function fixture() {
  const document = createBoxTemplate(), result = rebuildDocument(document);
  // Unit tests prove field/dependency reporting only. Native browser tests prove geometry.
  result.meshes = result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: {
    valid: true, volume: 80000, surfaceArea: 13200, solidCount: 1,
  } }));
  const feature = document.features[0], selection = { kind: "feature" as const, id: feature.id, documentId: document.id };
  return { document, result, feature, selection };
}
it("reports the authored driving field and keeps its formula; body selection resolves its writer", () => {
  const { document, result, feature, selection } = fixture();
  const labels = solidDimensions(document, result, selection, document.rootComponentId);
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({ label: "Thickness", value: 20, unit: "mm", expression: "depth", bound: true,
    featureId: feature.id, affectedFeatures: ["Box Extrude"], anchor: [0, 0, 10] });
  expect(solidDimensions(document, result, { ...selection, kind: "body", id: stableBodyIdForFeature(feature.id) }, document.rootComponentId)).toEqual(labels);
  expect(document.features[0]).toBe(feature);
});
it("does not annotate failed, stale, fallback, hidden, foreign-component or suppressed geometry", () => {
  const { document, result, feature, selection } = fixture();
  const dims = (doc = document, output = result, picked = selection, component = document.rootComponentId, hidden: string[] = []) =>
    solidDimensions(doc, output, picked, component, hidden);
  expect(dims(document, { ...result, success: false })).toEqual([]);
  expect(dims(document, { ...result, documentId: "old" })).toEqual([]);
  expect(dims(document, { ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "fallback" })) })).toEqual([]);
  expect(dims(document, result, { ...selection, documentId: "old" })).toEqual([]);
  expect(dims(document, result, selection, "another-component")).toEqual([]);
  expect(dims(document, result, selection, document.rootComponentId, [stableBodyIdForFeature(feature.id)])).toEqual([]);
  expect(dims({ ...document, features: [{ ...feature, suppressed: true }] })).toEqual([]);
});
it("does not turn To Face or Through All into a fictitious editable thickness", () => {
  const { document, result, feature, selection } = fixture();
  if (feature.type !== "extrude") throw new Error("Expected extrusion fixture.");
  expect(solidDimensions({ ...document, features: [{ ...feature, termination: { type: "throughAll" } }] }, result, selection, document.rootComponentId)).toEqual([]);
});
