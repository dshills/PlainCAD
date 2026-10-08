import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fittedPartPlan, followFittedPlacements } from "../cad/features/fittedPart";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { appendProject } from "../persistence/appendProject";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { planFeatureGraph } from "../cad/features/featureGraph";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { withComponentPlacement } from "../cad/document/componentPlacement";
const load = () => importProjectText(readFileSync("src/persistence/fixtures/schema-v19.pcaddoc", "utf8"));
const bounds = { min: [0, 0, 0] as [number, number, number], max: [20, 10, 5] as [number, number, number] };
describe("linked fitted parts", () => {
  it.each([["enclosure", 2520], ["bracket", 1400], ["adapter", 1512]] as const)("plans exact %s material and no source overlap", (style, volume) => {
    const plan = fittedPartPlan(bounds, 2, 2, style); expect(plan.volume).toBe(volume); expect(plan.boxes[0].min.slice(0, 2)).toEqual([-4, -4]); expect(plan.boxes[0].size.slice(0, 2)).toEqual([28, 18]);
  });
  it("rejects invalid units, dimensions and overflowing geometry", () => {
    for (const value of [-1, NaN, Infinity, 1e7]) expect(() => fittedPartPlan(bounds, value, 2, "enclosure")).toThrow();
    expect(() => fittedPartPlan(bounds, 2, 0, "enclosure")).toThrow();
    expect(() => fittedPartPlan({ ...bounds, max: [1e8, 10, 5] }, 2, 2, "enclosure")).toThrow();
  });
  it("migrates, round trips and copies stable source references; rejects partial extraction", () => {
    const document = load(); expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(serializeProject(importProjectText(serializeProject(document)))).toBe(serializeProject(document));
    const copy = appendProject(createEmptyDocument(), document).document, fit = copy.features.find(feature => feature.type === "fit")!;
    if (fit.type !== "fit") throw new Error("Missing fitted feature");
    expect(fit.sourceBodyId).not.toBe("body:first-solid"); expect(copy.features.some(feature => `body:${feature.id}` === fit.sourceBodyId)).toBe(true);
    expect(() => appendProject(createEmptyDocument(), document, { componentId: "fitted-component" })).toThrow(/outside the selected component/);
    const legacy = JSON.parse(readFileSync("src/persistence/fixtures/schema-v18.pcaddoc", "utf8")); const upgraded = importProjectText(JSON.stringify(legacy)); expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(upgraded.features.map(feature => feature.id)).toEqual(legacy.features.map((feature: { id: string }) => feature.id)); expect(upgraded.features.some(feature => feature.type === "fit")).toBe(false); expect(upgraded.assemblyJoints).toEqual(legacy.assemblyJoints);
  });
  it("follows parent position but does not overwrite saved authored positions", () => {
    const document = withComponentPlacement(load(), "first-component", { translation: [10, 20, 30], rotation: [0, 0, Math.PI / 2] });
    expect(followFittedPlacements(document).components["fitted-component"].placement).toEqual(document.components["first-component"].placement); expect(document.components["fitted-component"].placement).toBeUndefined();
  });
  it("diagnoses missing, later and same-component sources without pretending fallback geometry works", () => {
    const document = load(), feature = document.features.find(feature => feature.type === "fit")!;
    if (feature.type !== "fit") throw new Error("Missing fitted feature");
    expect(planFeatureGraph(document).errors).toEqual([]);
    expect(planFeatureGraph({ ...document, features: document.features.map(item => item.id === feature.id ? { ...feature, timelineStep: 0 } : item) }).errors.some(issue => issue.message.includes("source"))).toBe(true);
    const lost = { ...document, features: document.features.map(item => item.id === feature.id ? { ...feature, sourceBodyId: "body:lost", suppressed: true } : item) }; expect(planFeatureGraph(lost).errors).toEqual([]); expect(rebuildDocument(lost).success).toBe(true);
    expect(planFeatureGraph({ ...document, features: document.features.map(item => item.id === feature.id ? { ...feature, sourceBodyId: "body:lost" } : item) }).errors.some(issue => issue.message.includes("source"))).toBe(true);
    expect(planFeatureGraph({ ...document, features: document.features.map(item => item.id === feature.id ? { ...feature, componentId: "first-component" } : item) }).errors.some(issue => issue.message.includes("different component"))).toBe(true);
    expect(rebuildDocument(document).errors.some(issue => issue.message.includes("native OpenCascade"))).toBe(true);
    expect(() => importProjectText(JSON.stringify({ ...document, features: document.features.map(item => item.id === feature.id ? { ...feature, followSourcePlacement: "yes" } : item) }))).toThrow(/Malformed fitted/);
  });
});
