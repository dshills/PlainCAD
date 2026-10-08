import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { importProjectText } from "../persistence/importProject";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { COACH_PRESETS, COACH_TRIANGLE_LIMIT, manufacturingReport, overhangArea, correctManufacturingFinding } from "../cad/inspection/manufacturingCoach";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
const load = () => importProjectText(readFileSync("src/persistence/fixtures/schema-v19.pcaddoc", "utf8"));
function native() {
  const document = load(), result = rebuildDocument({ ...document, features: document.features.filter(feature => feature.type !== "fit") });
  return { ...result, success: true, errors: [], meshes: [...result.meshes, { ...result.meshes[0], bodyId: "body:fitted-solid" }].map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 100, solidCount: 1 } })) };
}
describe("bounded manufacturing screening", () => {
  it("reports authored fit thresholds, produces an immutable repair and leaves shared parameters alone", () => {
    const document = load(), settings = { ...COACH_PRESETS.fdm, minimumWall: 3, minimumClearance: 3 }, report = manufacturingReport(document, native(), settings);
    const finding = report.findings.find(finding => finding.id === "fitted-solid:wallThickness")!;
    expect(finding.bodyIds).toEqual(["body:fitted-solid"]); expect(finding.message).toContain("authored");
    const corrected = correctManufacturingFinding(document, finding.correction!);
    expect(corrected.features.at(-1)).toMatchObject({ wallThickness: { expression: "3mm" } }); expect(corrected.parameters).toEqual(document.parameters); expect(document.features.at(-1)).toMatchObject({ wallThickness: { expression: "2mm" } });
  });
  it("excludes the build plane, reports downward facets above it, and stops at its budget", () => {
    const mesh: RenderMesh = { id: "facet", bodyId: "body:facet", positions: [0, 0, 2, 0, 1, 2, 1, 0, 2], normals: [], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [1, 1, 2] } };
    expect(overhangArea(mesh, 45, { visits: 0 })).toEqual({ area: 0.5, complete: true });
    expect(overhangArea({ ...mesh, bounds: { ...mesh.bounds, min: [0, 0, 2] } }, 45, { visits: 0 }).area).toBe(0);
    expect(overhangArea(mesh, 45, { visits: COACH_TRIANGLE_LIMIT })).toEqual({ area: 0, complete: false });
  });
  it("rejects invalid thresholds and fallback/stale geometry instead of claiming a clear model", () => {
    expect(() => manufacturingReport(load(), native(), { ...COACH_PRESETS.cnc, toolDiameter: NaN })).toThrow(/finite/);
    expect(() => manufacturingReport(load(), { ...native(), documentId: "old" }, COACH_PRESETS.cnc)).toThrow(/current/);
    expect(() => manufacturingReport(load(), { ...native(), meshes: native().meshes.map(mesh => ({ ...mesh, geometrySource: "fallback" })) }, COACH_PRESETS.fdm)).toThrow(/native/);
  });
  it("reports actual native assembly collisions and explicit incomplete coverage", () => {
    const document = load(), result = native();
    const report = manufacturingReport({ ...document, assemblyJoints: [{} as never] }, { ...result, assemblyCollisions: [["body:first-solid", "body:second-solid"]], assemblyCollisionStatus: "incomplete" }, COACH_PRESETS.cnc);
    expect(report.complete).toBe(false); expect(report.findings).toContainEqual(expect.objectContaining({ title: "Native solid interference", bodyIds: ["body:first-solid", "body:second-solid"] }));
  });
  it("does not certify curved or modified laser stock based only on bounding dimensions", () => {
    expect(manufacturingReport(load(), native(), COACH_PRESETS.laser).findings.filter(finding => finding.title === "Sheet profile not verified")).toHaveLength(3);
  });
});
