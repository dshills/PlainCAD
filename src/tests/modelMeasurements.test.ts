import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as operationGeometry from "../cad/features/operationTargetGeometry";
import { createExtrudeFeature, upsertFeature, createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCircleAt, addCornerRectangle, createSketchOnPlane, setConstruction } from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { modelMeasurementTargets, measureModelTargets, type ModelMeasurementTarget } from "../cad/inspection/modelMeasurements";
import { useInspectionState } from "../state/inspectionState";

function fixture() {
  let sketch = addCornerRectangle(createSketchOnPlane("Measure", { type: "offset", base: "XZ", offset: { expression: "7mm", unit: "mm" } }), "3mm", "4mm");
  sketch = addCircleAt(sketch, "12mm", "0mm", "2mm");
  const circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  sketch = setConstruction(sketch, circle.id, true);
  const document = upsertSketch(createEmptyDocument(), sketch), result = rebuildDocument(document);
  return { document, result, circle };
}
beforeEach(() => useInspectionState.setState(useInspectionState.getInitialState()));
afterEach(() => {
  useInspectionState.setState(useInspectionState.getInitialState());
  vi.restoreAllMocks();
});
describe("click measurements", () => {
  it("uses analytic curves and world coordinates with bounded display sampling", () => {
    const { document, result, circle } = fixture();
    const targets = modelMeasurementTargets(document, result);
    const points = targets.filter((target) => target.kind === "point");
    expect(measureModelTargets(points[0], points[2]).length).toBe(5);
    expect(points[0].point).toEqual({ x: 0, y: -7, z: 0 });
    const measured = measureModelTargets(targets.find((target) => target.id.endsWith(circle.id))!);
    expect(measured.curve?.diameter).toBe(4);
    expect(measured.curve?.length).toBeCloseTo(4 * Math.PI, 12);
    const lines = targets.filter((target) => target.direction);
    expect(measureModelTargets(lines[0], lines[1]).angle).toBe(90);
    expect(modelMeasurementTargets(document, result)).toBe(targets);
    expect(modelMeasurementTargets(document, { ...result, success: false })).toEqual([]);
  });
  it("only exposes individually proven native cap roles and never invents tessellated vertices", () => {
    const sketch = addCornerRectangle(createSketchOnPlane("Native role fixture", "XY"), "30mm", "20mm");
    const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const feature = createExtrudeFeature({ name: "Block", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "symmetric", distance: { expression: "8mm", unit: "mm" } });
    const document = upsertFeature(upsertSketch(createEmptyDocument(), sketch), feature);
    const fallback = rebuildDocument(document);
    const bodyId = fallback.meshes[0].bodyId;
    // This unit fixture supplies protocol metadata; native proof is separately exercised in Chromium.
    const result = { ...fallback, meshes: fallback.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 4800, surfaceArea: 2000, solidCount: 1 } })), availableFaces: [], availableEdges: [] };
    expect(modelMeasurementTargets(document, result).every((target) => !target.bodyId)).toBe(true);
    const source = Object.values(sketch.entities).find((entity) => entity.type === "line")!;
    const proven = { ...result, availableEdges: [{ featureId: feature.id, bodyId, role: "endCapPerimeter" as const, sourceEntityId: source.id }] };
    const native = modelMeasurementTargets(document, proven).filter((target) => target.bodyId);
    expect(native).toHaveLength(3);
    vi.spyOn(operationGeometry, "individualCapOperationGeometry").mockImplementation(() => { throw new ReferenceError("Unexpected placement bug"); });
    expect(() => modelMeasurementTargets(document, { ...proven })).toThrow(ReferenceError);
    expect(native[0].curve?.length).toBe(30);
    expect(native.slice(1).map((target) => target.point?.z)).toEqual([4, 4]);
    expect(measureModelTargets(native[1], native[2]).length).toBe(30);
    expect(modelMeasurementTargets(document, { ...proven, availableEdges: [] }).every((target) => !target.bodyId)).toBe(true);
  });
  it("reports infinite plane separation honestly and rejects curved or mixed distances", () => {
    const face = (id: string, z: number, normal = { x: 0, y: 0, z: 1 }): ModelMeasurementTarget => ({ id, label: id, kind: "face", paths: [], plane: { origin: { x: 20, y: 30, z }, normal }, direction: normal });
    expect(measureModelTargets(face("a", 2), face("b", 9))).toMatchObject({ label: "Parallel plane separation", length: 7, angle: 0 });
    expect(measureModelTargets(face("a", 2), face("b", 9, { x: 1, y: 0, z: 0 }))).toMatchObject({ angle: 90 });
    const tilted = { x: 1e-9, y: 0, z: 3 };
    expect(measureModelTargets(face("a", 2, { x: 0, y: 0, z: 2 }), face("b", 9, tilted))).toMatchObject({ label: "Parallel plane separation", length: 7 });
    expect(measureModelTargets(face("a", 2), face("b", 9, { x: 1e-5, y: 0, z: 1 })).angle).toBeCloseTo(0.0005729578, 10);
    expect(() => measureModelTargets(face("a", 0), { id: "circle", label: "circle", kind: "curve", paths: [], curve: { length: Math.PI * 4, diameter: 4 } })).toThrow(/Mixed and curved/);
  });
  it("captures the exact rebuild and restarts pairs when the document/result changes", () => {
    const { document, result } = fixture();
    const state = useInspectionState.getState();
    state.setPicking(17, true);
    state.pick(17, document, result, "one"); state.pick(17, document, result, "two");
    expect(useInspectionState.getState().targetIds).toEqual(["one", "two"]);
    state.pick(17, document, result, "three");
    expect(useInspectionState.getState().targetIds).toEqual(["three"]);
    state.pick(17, { ...document }, result, "four");
    expect(useInspectionState.getState().targetIds).toEqual(["four"]);
    state.clearModel();
    expect(useInspectionState.getState().document).toBeUndefined();
    expect(useInspectionState.getState().result).toBeUndefined();
    expect(useInspectionState.getState().picking).toBe(true);
    state.setPicking(18, false);
  });
  it("resets units, legacy references and picking when a direct pick enters a new session", () => {
    const { document, result } = fixture(), state = useInspectionState.getState();
    state.setPicking(10, true); state.setUnit(10, "in");
    state.setReference(10, "first", { sketchId: "old", entityId: "old-point" });
    state.setReference(10, "entity", { sketchId: "old", entityId: "old-curve" });
    state.pick(11, document, result, "fresh");
    expect(useInspectionState.getState()).toMatchObject({ session: 11, unit: undefined, picking: false, first: undefined, second: undefined, entity: undefined, targetIds: ["fresh"], document, result });
  });

});
