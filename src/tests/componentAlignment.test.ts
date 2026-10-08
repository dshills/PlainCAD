import { describe, expect, it, vi } from "vitest";
import * as measurements from "../cad/inspection/modelMeasurements";
import { alignComponentGeometry, placedAlignmentTarget, componentAlignmentTargets, type ComponentAlignmentTarget } from "../cad/inspection/componentAlignment";
import { IDENTITY_PLACEMENT, placementTransform } from "../cad/document/componentPlacement";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
const point = (componentId: string, x: number, y: number, z: number): ComponentAlignmentTarget => ({ id: componentId, label: componentId, componentId, bodyId: componentId, kind: "point", point: { x, y, z } });
const face = (componentId: string, p: [number, number, number], n: [number, number, number]): ComponentAlignmentTarget => ({ ...point(componentId, ...p), kind: "face", direction: { x: n[0], y: n[1], z: n[2] } });
describe("component native-reference alignment", () => {
  it("coincides exact endpoints while preserving an existing rotation", () => {
    const pose = { translation: [10, 20, 30] as [number, number, number], rotation: [0, 0, Math.PI / 2] as [number, number, number] };
    const result = alignComponentGeometry(point("source", 8, 21, 30), point("target", -5, 9, 12), pose, pose);
    expect(result.translation).toEqual([-3, 8, 12]); expect(result.rotation).toEqual(pose.rotation);
    expect(placedAlignmentTarget(point("source", 8, 21, 30), pose, result).point).toEqual({ x: -5, y: 9, z: 12 });
  });
  it("mates planar normals with signed clearance and preserves tangential position", () => {
    const result = alignComponentGeometry(face("source", [2, 3, 4], [0, 0, 1]), face("target", [100, 200, 20], [0, 0, 1]), IDENTITY_PLACEMENT, IDENTITY_PLACEMENT, 2, false);
    expect(result.translation).toEqual([0, 0, 18]); expect(result.rotation).toEqual([0, 0, 0]);
    expect(placedAlignmentTarget(face("source", [2, 3, 4], [0, 0, 1]), IDENTITY_PLACEMENT, result).point).toEqual({ x: 2, y: 3, z: 22 });
  });
  it("supports antiparallel normals without guessing a zero axis", () => {
    const source = face("source", [0, 0, 4], [0, 0, 1]), target = face("target", [0, 0, 20], [0, 0, 1]);
    const result = alignComponentGeometry(source, target, IDENTITY_PLACEMENT, IDENTITY_PLACEMENT, -1);
    const after = placedAlignmentTarget(source, IDENTITY_PLACEMENT, result);
    expect(after.direction!.z).toBeCloseTo(-1, 12); expect(after.point.z).toBeCloseTo(19, 12);
    expect(placementTransform(result).normal.z).toBeCloseTo(-1, 12);
  });
  it("aligns straight edges by midpoint and direction across a gimbal pose", () => {
    const source = { ...point("source", 4, 0, 0), kind: "edge" as const, direction: { x: 1, y: 0, z: 0 } };
    const target = { ...point("target", 10, 20, 30), kind: "edge" as const, direction: { x: 0, y: 0, z: 1 } };
    const result = alignComponentGeometry(source, target, IDENTITY_PLACEMENT, IDENTITY_PLACEMENT, 0, false);
    const after = placedAlignmentTarget(source, IDENTITY_PLACEMENT, result);
    expect(after.point.x).toBeCloseTo(10, 12); expect(after.point.y).toBeCloseTo(20, 12); expect(after.point.z).toBeCloseTo(30, 12);
    expect(after.direction!.z).toBeCloseTo(1, 12); expect(after.direction!.x).toBeCloseTo(0, 12);
  });
  it("recomputes the source from the current transient pose rather than the captured origin", () => {
    const current = { translation: [50, 60, 70] as [number, number, number], rotation: [0, 0, Math.PI / 2] as [number, number, number] };
    const result = alignComponentGeometry(point("source", 2, 3, 4), point("target", 10, 20, 30), IDENTITY_PLACEMENT, current);
    expect(result.translation).toEqual([13, 18, 26]); expect(result.rotation).toEqual(current.rotation);
  });
  it("refuses mismatched, degenerate and out-of-range references without mutating poses", () => {
    const source = point("source", 1, 2, 3), target = point("target", 4, 5, 6);
    expect(() => alignComponentGeometry(source, { ...target, componentId: "source" }, IDENTITY_PLACEMENT, IDENTITY_PLACEMENT)).toThrow("different components");
    expect(() => alignComponentGeometry(source, face("target", [0, 0, 0], [0, 0, 1]), IDENTITY_PLACEMENT, IDENTITY_PLACEMENT)).toThrow("matching");
    expect(() => alignComponentGeometry(source, target, IDENTITY_PLACEMENT, IDENTITY_PLACEMENT, 1)).toThrow("faces only");
    expect(() => alignComponentGeometry(face("source", [0, 0, 0], [0, 0, 0]), face("target", [0, 0, 0], [0, 0, 1]), IDENTITY_PLACEMENT, IDENTITY_PLACEMENT)).toThrow("degenerate");
    expect(() => alignComponentGeometry(source, point("target", Infinity, 0, 0), IDENTITY_PLACEMENT, IDENTITY_PLACEMENT)).toThrow("limits");
    const pose = { translation: [50, 60, 70] as [number, number, number], rotation: [0.1, 0.2, 0.3] as [number, number, number] }, snapshot = structuredClone(pose);
    expect(() => alignComponentGeometry(source, point("target", Infinity, 0, 0), IDENTITY_PLACEMENT, pose)).toThrow("limits");
    expect(pose).toEqual(snapshot); expect(IDENTITY_PLACEMENT).toEqual({ translation: [0, 0, 0], rotation: [0, 0, 0] });
  });
  it("never offers fallback meshes or unproven authored sketch entities as native alignment targets", () => {
    const document = createBoxTemplate(), result = rebuildDocument(document);
    expect(componentAlignmentTargets(document, result)).toEqual([]);
    expect(componentAlignmentTargets(document, { ...result, success: false })).toEqual([]);
  });
  it("skips a degenerate proved normal without losing other native reference choices", () => {
    const document = createBoxTemplate(), result = rebuildDocument(document), bodyId = result.meshes[0].bodyId;
    const model = { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 24000, surfaceArea: 10000, solidCount: 1 } })) };
    const spy = vi.spyOn(measurements, "modelMeasurementTargets").mockReturnValue([
      { id: "degenerate", label: "Bad normal", bodyId, kind: "face", paths: [], plane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } } },
      { id: "valid", label: "Good normal", bodyId, kind: "face", paths: [], plane: { origin: { x: 0, y: 0, z: 20 }, normal: { x: 0, y: 0, z: 1 } } },
    ]);
    try { expect(componentAlignmentTargets(document, model).map(target => target.id)).toEqual(["valid"]); }
    finally { spy.mockRestore(); }
  });
});
