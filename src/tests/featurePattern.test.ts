import { afterEach, describe, expect, it } from "vitest";
import schema14Fixture from "../persistence/fixtures/schema-v14.pcaddoc?raw";
import schema13Fixture from "../persistence/fixtures/schema-v13.pcaddoc?raw";
import { featurePatternTransforms, patternToolBounds, patternBoundsMayOverlap } from "../cad/features/featurePattern";
import { extrusionSweep } from "../cad/features/extrusionSweep";
import type { SketchProfile } from "../cad/sketch/profileDetection";
import { sketchPlaneTransform, transformPoint } from "../cad/sketch/planes";
import { createBoxTemplate } from "../templates/templates";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import type { CadDocument, FeaturePatternFeature, FeaturePatternSettings } from "../cad/document/schema";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { validateDocument } from "../cad/document/validate";
import { planFeatureGraph } from "../cad/features/featureGraph";
import { buildDependencyGraph, dependencyKey } from "../cad/document/dependencyGraph";
import { bindDocumentExpressions, refreshBoundNames } from "../cad/parameters/expressionBindings";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { beginFeaturePattern, beginFeaturePatternEditing, cancelFeaturePattern, currentPatternFrame, stageFeaturePattern, applyFeaturePattern, useFeaturePattern } from "../ui/commands/featurePatternCommand";
import { useTargetScopeCapture } from "../ui/commands/targetScopeCaptureCommand";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";

const scalar = (expression: string) => ({ expression, unit: "", authoredUnit: "" });
const length = (expression: string) => ({ expression, unit: "mm", authoredUnit: "mm" });
const linear = (count = "3", spacing = "20mm"): FeaturePatternSettings => ({ type: "linear", count: scalar(count), spacing: length(spacing), direction: "X" });
function fixture() {
  let document = createBoxTemplate();
  const center = addPoint(createXySketch("Drill center"), "-20mm", "0mm");
  document = upsertSketch(document, center.sketch);
  document = upsertFeature(document, { id: "seed", type: "hole", name: "Seed drill", sketchId: center.sketch.id, centerPointIds: [center.pointId], targetBodyIds: [`body:${document.features[0].id}`], diameter: length("4mm"), depth: "throughAll" });
  const pattern: FeaturePatternFeature = { id: "pattern", type: "pattern", name: "Repeating holes", sourceFeatureId: "seed", targetBodyIds: [`body:${document.features[0].id}`], pattern: linear() };
  return { document: upsertFeature(document, pattern), pattern };
}
afterEach(() => { cancelFeaturePattern(); useTargetScopeCapture.setState({ busy: false }); useCadStore.setState(useCadStore.getInitialState(), true); });
describe("associative subtractive feature patterns", () => {
  it("skips native overlap proof only for conservatively disjoint analytic envelopes", () => {
    const profile: SketchProfile = { id: "tool", sketchId: "section", signature: "circle", outerLoop: { type: "circle", entityIds: ["circle"] }, innerLoops: [], holes: [], bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } };
    const planes = featurePatternTransforms(linear("32", "8mm"), sketchPlaneTransform("YZ"), {});
    const boxes = planes.map(plane => patternToolBounds(profile, extrusionSweep(plane, 5, "negative"), 5));
    expect(boxes[0]!.min[0]).toBeCloseTo(-5);
    expect(boxes[0]!.max[0]).toBeCloseTo(0);
    let candidatePairs = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) if (patternBoundsMayOverlap(boxes[i], boxes[j])) candidatePairs++;
    expect(candidatePairs).toBe(0);
    expect(patternBoundsMayOverlap(undefined, boxes[0])).toBe(true);
    const touching = patternToolBounds(profile, extrusionSweep(featurePatternTransforms(linear("2", "4mm"), sketchPlaneTransform("YZ"), {})[1], 5, "negative"), 5);
    expect(patternBoundsMayOverlap(boxes[0], touching)).toBe(true);
    const arcProfile: SketchProfile = { ...profile, outerLoop: { type: "polygon", entityIds: ["arc"], segments: [{ type: "arc", id: "arc", start: { x: 0, y: -10 }, end: { x: 0, y: 10 }, center: { x: 0, y: 0 }, radius: 10, startAngle: -Math.PI / 2, sweep: Math.PI }] } };
    // The conservative box must enclose the semicircle's real extrema,
    // even though the sampled profile bounds are deliberately too narrow.
    const arcBox = patternToolBounds(arcProfile, sketchPlaneTransform("XY"), 5);
    expect(arcBox!.min[0]).toBeLessThanOrEqual(0);
    expect(arcBox!.max[0]).toBeGreaterThanOrEqual(10);
    expect(arcBox!.min[1]).toBeLessThanOrEqual(-10);
    expect(arcBox!.max[1]).toBeGreaterThanOrEqual(10);
    expect(patternToolBounds({ ...arcProfile, outerLoop: { type: "polygon", entityIds: [] } }, sketchPlaneTransform("XY"), 5)).toBeUndefined();
  });
  it("migrates the schema 14 pattern regression fixture without losing associative fields", () => {
    const restored = importProjectText(schema14Fixture);
    expect(restored.features.at(-1)).toMatchObject({ id: "hole-pattern", type: "pattern", sourceFeatureId: "hole", targetBodyIds: ["body:base"], pattern: { type: "linear", count: { expression: "2", authoredUnit: "" } } });
    expect(serializeProject(importProjectText(serializeProject(restored)))).toBe(serializeProject(restored));
    const legacy = importProjectText(schema13Fixture);
    expect(legacy.features.some(feature => feature.type === "pattern")).toBe(false);
  });
  it("places signed linear instances in the actual source sketch coordinate frame", () => {
    const plane = sketchPlaneTransform({ type: "offset", base: "YZ", offset: length("5mm") });
    const placements = featurePatternTransforms(linear("3", "-7mm"), plane, {});
    placements.forEach((placement, index) => {
      const point = transformPoint(placement, 0, 0);
      expect(point.x).toBeCloseTo(5);
      expect(point.y).toBeCloseTo(-7 * index);
      expect(point.z).toBeCloseTo(0);
    });
    expect(placements.every(p => p.normal === plane.normal)).toBe(true);
  });
  it("distributes a full circle without duplicating the last instance and includes partial sweep endpoints", () => {
    const settings: FeaturePatternSettings = { type: "circular", count: scalar("4"), angle: { expression: "360deg", unit: "deg" }, centerX: length("2mm"), centerY: length("3mm") };
    const full = featurePatternTransforms(settings, sketchPlaneTransform("XY"), {});
    const coordinates = full.map(plane => transformPoint(plane, 12, 3));
    expect(coordinates[0].x).toBeCloseTo(12);
    expect(coordinates[1].y).toBeCloseTo(13);
    expect(coordinates[2].x).toBeCloseTo(-8);
    expect(coordinates[3].y).toBeCloseTo(-7);
    const partial = featurePatternTransforms({ ...settings, count: scalar("3"), angle: { expression: "-180deg", unit: "deg" } }, sketchPlaneTransform("XY"), {});
    expect(transformPoint(partial[1], 12, 3).y).toBeCloseTo(-7);
    expect(transformPoint(partial[2], 12, 3).x).toBeCloseTo(-8);
  });
  it("rejects fractional, excessive and dimensional counts, zero spacing, and excessive sweeps", () => {
    for (const settings of [linear("1"), linear("33"), linear("2.5"), linear("3mm"), linear("3", "0mm"), linear("3", "2deg"), { type: "circular" as const, count: scalar("3"), angle: { expression: "361deg", unit: "deg" }, centerX: length("0mm"), centerY: length("0mm") }])
      expect(() => featurePatternTransforms(settings, sketchPlaneTransform("XY"), {})).toThrow();
  });
  it("round trips the seed reference, scope, arrangement and stable parameter bindings", () => {
    let { document } = fixture();
    document = { ...document, parameters: { ...document.parameters, copies: { id: "copies-param", name: "copies", expression: "3", authoredUnit: "", value: 3, unit: "" } }, features: document.features.map(f => f.type === "pattern" ? { ...f, pattern: linear("copies") } : f) };
    document = bindDocumentExpressions(document);
    const text = serializeProject(document), restored = importProjectText(text);
    expect(serializeProject(restored)).toBe(text);
    expect(restored.features.at(-1)).toMatchObject({ sourceFeatureId: "seed", pattern: { count: { parameterRefs: { copies: "copies-param" } } } });
    const renamed: CadDocument = { ...restored, parameters: { ...restored.parameters, repetitions: { ...restored.parameters.copies, name: "repetitions" } } };
    delete renamed.parameters.copies;
    expect(refreshBoundNames(renamed).features.at(-1)).toMatchObject({ pattern: { count: { expression: "repetitions" } } });
    const graph = buildDependencyGraph(restored);
    expect(graph.inputs.get(dependencyKey("feature", "pattern"))?.some(edge => edge.from === dependencyKey("feature", "seed") && edge.reasons.includes("Pattern source feature"))).toBe(true);
    expect(graph.inputs.get(dependencyKey("feature", "pattern"))?.some(edge => edge.from === dependencyKey("parameter", "copies-param"))).toBe(true);
  });
  it("preserves well-typed lost sources for repair, but rejects malformed pattern imports and downstream sources", () => {
    const { document, pattern } = fixture();
    const missing = { ...document, features: document.features.filter(f => f.id !== "seed") };
    expect(importProjectText(serializeProject(missing)).features.at(-1)?.id).toBe("pattern");
    expect(validateDocument(missing).some(issue => issue.sourceId === "pattern" && issue.message.includes("source was lost"))).toBe(true);
    const early: CadDocument = { ...document, features: document.features.map(f => f.id === "pattern" ? { ...pattern, timelineStep: 0 } : f) };
    expect(planFeatureGraph(early).errors.some(issue => issue.sourceId === "pattern")).toBe(true);
    for (const patch of [{ targetBodyIds: "body:bad" }, { pattern: null }, { pattern: { type: "linear", count: scalar("3"), spacing: length("5mm"), direction: "Z" } }]) {
      const bad = { ...document, features: document.features.map(f => f.id === "pattern" ? { ...f, ...patch } : f) };
      expect(() => importProjectText(JSON.stringify(bad))).toThrow();
    }
    expect(rebuildDocument(document).errors.some(error => error.sourceId === "pattern" && error.message.includes("native OpenCascade"))).toBe(true);
  });
  it("locks shared commands, requires issued current previews, and retains history on stale submissions", () => {
    const { document: patterned } = fixture(), document = { ...patterned, features: patterned.features.filter(f => f.type !== "pattern") };
    const result = rebuildDocument(document);
    result.meshes = result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 79748.7, surfaceArea: 13000, solidCount: 1 } }));
    useCadStore.setState(state => ({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { ...state.rebuild, kernelReady: true, status: "succeeded", result }, selection: { selectedIds: [{ kind: "feature", id: "seed", documentId: document.id }] } }));
    expect(selectCommandEnablement(useCadStore.getState()).createFeaturePattern).toBe(true);
    useTargetScopeCapture.setState({ busy: true });
    expect(selectCommandEnablement(useCadStore.getState()).createFeaturePattern).toBe(false);
    expect(() => beginFeaturePattern()).toThrow();
    useTargetScopeCapture.setState({ busy: false });
    beginFeaturePattern();
    const frame = useFeaturePattern.getState().frame!;
    const input = { name: "Row", sourceFeatureId: "seed", type: "linear" as const, count: "3", spacing: "20mm", direction: "X" as const, angle: "360deg", centerX: "0mm", centerY: "0mm" };
    const staged = stageFeaturePattern(frame, input);
    expect(staged.feature.pattern.count.authoredUnit).toBe("");
    const enabled = selectCommandEnablement(useCadStore.getState());
    expect(enabled.undo).toBe(false);
    expect(enabled.createExtrude).toBe(false);
    expect(enabled.exportStl).toBe(false);
    expect(() => applyFeaturePattern({ ...staged, frame, input, result, operation: result }, input)).toThrow(/latest valid native/);
    expect(useCadStore.getState().history.past).toHaveLength(0);
    useCadStore.setState({ documentSession: frame.session + 1 });
    expect(currentPatternFrame(frame)).toBe(false);
    expect(() => stageFeaturePattern(frame, input)).toThrow(/changed/);
  });
  it("retains authored units and bindings when only input whitespace changes", () => {
    const { document: original } = fixture();
    const document = bindDocumentExpressions({ ...original, features: original.features.map(feature => feature.type === "pattern" ? { ...feature, pattern: { ...linear("2"), spacing: { expression: " 1 ", unit: "mm", authoredUnit: "in" } } } : feature) });
    useCadStore.setState(state => ({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { ...state.rebuild, kernelReady: true, status: "failed" }, selection: { selectedIds: [{ kind: "feature", id: "pattern", documentId: document.id }] } }));
    beginFeaturePatternEditing();
    const frame = useFeaturePattern.getState().frame!;
    const staged = stageFeaturePattern(frame, { name: "Repeating holes", sourceFeatureId: "seed", type: "linear", count: " 2 ", spacing: " 1 ", direction: "X", angle: "360deg", centerX: "0mm", centerY: "0mm" });
    expect(staged.feature.pattern).toMatchObject({ spacing: { expression: " 1 ", authoredUnit: "in" }, count: { expression: "2", authoredUnit: "" } });
  });
});
