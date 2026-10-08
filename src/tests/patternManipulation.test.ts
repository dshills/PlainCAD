import { describe, expect, it } from "vitest";
import { createEmptyDocument, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addPoint, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { sketchPlaneTransform } from "../cad/sketch/planes";
import { draggedPatternLiteral, draggedPatternSweep, patternControlModel, patternFieldIsLiteral, type PatternControlInput } from "../cad/features/patternManipulation";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { SketchProfile } from "../cad/sketch/profileDetection";

function fixture() {
  const center = addPoint(createSketchOnPlane("Center", "YZ"), "12mm", "0mm");
  const document = upsertFeature(upsertSketch(createEmptyDocument(), center.sketch), { id: "source", type: "hole", name: "Hole", sketchId: center.sketch.id, centerPointIds: [center.pointId], diameter: { expression: "4mm", unit: "mm" }, depth: "throughAll", targetBodyIds: ["body:base"] });
  const plane = sketchPlaneTransform({ type: "offset", base: "YZ", offset: { expression: "5mm", unit: "mm" } });
  const result: RebuildResult = { documentId: document.id, success: true, meshes: [], bodies: [], errors: [], warnings: [], durationMs: 0, parameterValues: {}, solvedSketches: { [center.sketch.id]: solveSketch(center.sketch, {}) }, sketchPlanes: { [center.sketch.id]: plane } };
  const input: PatternControlInput = { sourceFeatureId: "source", type: "linear", count: "3", direction: "Y", spacing: "-7mm", centerX: "0mm", centerY: "0mm", angle: "-180deg" };
  return { document, result, input };
}
describe("source-plane pattern manipulation", () => {
  it("shows copies in local XY while preserving signed YZ offset placement", () => {
    const { document, result, input } = fixture(), model = patternControlModel(document, input, result);
    expect(model.centers).toEqual([{ x: 12, y: 0 }, { x: 12, y: -7 }, { x: 12, y: -14 }]);
    expect(model.worldCenters).toEqual([{ x: 5, y: 12, z: 0 }, { x: 5, y: 12, z: -7 }, { x: 5, y: 12, z: -14 }]);
    expect(model.outlines).toHaveLength(3);
    expect(model.outlines[1][0][0]).toEqual({ x: 14, y: -7 });
  });
  it("uses the authoritative placed basis and preserves negative circular sweeps", () => {
    const { document, result, input } = fixture();
    const sketchId = Object.keys(result.sketchPlanes!)[0];
    result.sketchPlanes![sketchId] = { origin: { x: 100, y: 200, z: 300 }, u: { x: 0, y: 0, z: 1 }, v: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    const model = patternControlModel(document, { ...input, type: "circular" }, result);
    expect(model.worldCenters[0]).toEqual({ x: 100, y: 200, z: 312 });
    expect(model.worldCenters[1].x).toBeCloseTo(88);
    expect(model.worldCenters[1].z).toBeCloseTo(300);
    expect(model.worldCenters[2].z).toBeCloseTo(288);
    expect(model.sweep).toBeCloseTo(-Math.PI);
  });
  it("keeps retained authored units and diagnoses stale/invalid source or settings", () => {
    const { document, result, input } = fixture();
    document.unitSettings.length = "in";
    const model = patternControlModel(document, { ...input, spacing: "2" }, result, { type: "linear", count: { expression: "3", unit: "", authoredUnit: "" }, spacing: { expression: "2", unit: "mm", authoredUnit: "mm" }, direction: "Y" });
    expect(model.spacing).toBe(2);
    expect(() => patternControlModel(document, input, { ...result, documentId: "other" })).toThrow("stale");
    expect(() => patternControlModel(document, { ...input, count: "33" }, result)).toThrow("whole number");
    expect(() => patternControlModel(document, { ...input, sourceFeatureId: "lost" }, result)).toThrow("lost");
    expect(() => patternControlModel(document, input, { ...result, sketchPlanes: {} })).toThrow("resolved source");
  });
  it("rejects multi-center hole sources instead of drawing an incomplete plan", () => {
    const { document, result, input } = fixture();
    const source = document.features[0];
    if (source.type !== "hole") throw new Error("Expected hole fixture");
    const multiple = { ...document, features: [{ ...source, centerPointIds: [...source.centerPointIds, "second-center"] }] };
    expect(() => patternControlModel(multiple, input, result)).toThrow("single-center Hole");
  });
  it("preserves circular authored units and ignores fields from another retained pattern type", () => {
    const { document, result, input } = fixture();
    document.unitSettings.length = "in";
    document.unitSettings.angle = "rad";
    const circular = patternControlModel(document, { ...input, type: "circular", angle: "-180", centerX: "2", centerY: "0" }, result, { type: "circular", count: { expression: "3", unit: "" }, angle: { expression: "-180", unit: "deg", authoredUnit: "deg" }, centerX: { expression: "2", unit: "mm", authoredUnit: "mm" }, centerY: { expression: "0", unit: "mm", authoredUnit: "mm" } });
    expect(circular.center).toEqual({ x: 2, y: 0 });
    expect(circular.sweep).toBeCloseTo(-Math.PI);
    const linear = patternControlModel(document, { ...input, spacing: "2" }, result, { type: "circular", count: { expression: "3", unit: "" }, angle: { expression: "180", unit: "deg" }, centerX: { expression: "2", unit: "mm" }, centerY: { expression: "0", unit: "mm" } });
    expect(linear.spacing).toBeCloseTo(50.8);
  });
  it("bounds total cut outline vertices before generating repeated geometry", () => {
    const { document, result, input } = fixture();
    const source = document.features[0];
    if (source.type !== "hole") throw new Error("Expected hole fixture");
    const cut = { ...document, features: [{ id: source.id, type: "extrude" as const, name: "Cut", sketchId: source.sketchId, profileId: "profile", operation: "cut" as const, distance: { expression: "2mm", unit: "mm" }, direction: "positive" as const, targetBodyIds: source.targetBodyIds }] };
    const profile: SketchProfile = { id: "profile", sketchId: source.sketchId, signature: "boundary", bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, innerLoops: [], holes: [], outerLoop: { type: "polygon", entityIds: [], segments: Array.from({ length: 512 }, (_, index) => ({ type: "line", id: `line-${index}`, start: { x: Math.cos(index * Math.PI / 256), y: Math.sin(index * Math.PI / 256) }, end: { x: Math.cos((index + 1) * Math.PI / 256), y: Math.sin((index + 1) * Math.PI / 256) } })) } };
    const prepared = { ...result, profiles: { [source.sketchId]: [profile] } };
    expect(patternControlModel(cut, { ...input, count: "32" }, prepared).outlines.flat(2)).toHaveLength(16384);
    const oversized = { ...profile, outerLoop: { ...profile.outerLoop, segments: [...profile.outerLoop.segments!, profile.outerLoop.segments![0]] } };
    expect(() => patternControlModel(cut, { ...input, count: "32" }, { ...prepared, profiles: { [source.sketchId]: [oversized] } })).toThrow("too complex");
  });
  it("protects formulas and writes explicit canonical literals", () => {
    for (const expression of ["10mm", " -1.2in ", ".25", "360deg", "-3rad"]) expect(patternFieldIsLiteral(expression)).toBe(true);
    for (const expression of ["spacing", "2 * pitch", "sin(45deg)", "10mm + 1mm", ""]) expect(patternFieldIsLiteral(expression)).toBe(false);
    expect(draggedPatternLiteral(25.4)).toBe("25.400000mm");
    expect(draggedPatternLiteral(-Math.PI, true)).toBe("-180.000000deg");
    expect(() => draggedPatternLiteral(Infinity)).toThrow("supported range");
  });
  it("unwraps both sweep directions at the pointer angle branch and clamps one revolution", () => {
    expect(draggedPatternSweep(3, -3, 3)).toBeCloseTo(2 * Math.PI - 3);
    expect(draggedPatternSweep(-3, 3, -3)).toBeCloseTo(3 - 2 * Math.PI);
    expect(draggedPatternSweep(2 * Math.PI, .5, 0)).toBe(2 * Math.PI);
    expect(draggedPatternSweep(-2 * Math.PI, -.5, 0)).toBe(-2 * Math.PI);
  });
});
