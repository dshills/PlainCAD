import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addComponent } from "../cad/document/components";
import { componentPlacementsEqual, IDENTITY_PLACEMENT, MAX_COMPONENT_ROTATION, MAX_COMPONENT_TRANSLATION, placedPoint, placedVector, placePlane, unplacePlane, placementTransform, validComponentPlacement, withComponentPlacement } from "../cad/document/componentPlacement";
import type { CadDocument, ComponentPlacement } from "../cad/document/schema";
import { validateDocument } from "../cad/document/validate";
import { applyComponentPlacements, placedComponentMesh } from "../cad/features/componentPlacement";
import type { KernelAdapter, KernelShape, RenderMesh } from "../cad/kernel/KernelAdapter";
import { createXySketch } from "../cad/sketch/SketchModel";
import { placeDocumentPlanes, sketchPlaneTransform } from "../cad/sketch/planes";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";

const pose: ComponentPlacement = { translation: [30, -7, 4], rotation: [0, 0, Math.PI / 2] };
function mesh(): RenderMesh { return { id: "mesh", bodyId: "body:solid", positions: [0, 0, 0, 20, 0, 0, 0, 10, 5], normals: [1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [20, 10, 5] } }; }
function documentWithBodies() {
  const first = addComponent(createEmptyDocument("Placed project"), "First");
  const second = addComponent(first.document, "Second");
  let document = second.document;
  for (const [id, componentId] of [["solid", first.component.id], ["other", second.component.id]]) {
    const sketch = { ...createXySketch(), id: `sketch:${id}`, componentId };
    document = upsertSketch(document, sketch);
    document = upsertFeature(document, { ...createExtrudeFeature({ name: id, sketchId: sketch.id, profileId: "profile", operation: "newBody", distance: { expression: "5mm", unit: "mm" }, direction: "positive" }), id, componentId });
  }
  return { document, first: first.component.id, second: second.component.id };
}

describe("rigid component placements", () => {
  it("applies translation to points, rotation to vectors, and right handed axes", () => {
    const frame = placementTransform(pose);
    expect(placedPoint(frame, { x: 20, y: 10, z: 5 })).toEqual({ x: 20, y: 13, z: 9 });
    expect(placedVector(frame, { x: 1, y: 0, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
    expect(placedVector(frame, { x: 0, y: 1, z: 0 })).toEqual({ x: -1, y: 0, z: 0 });
    expect(frame.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("composes design X then Y then Z rotations, without rotating the translation", () => {
    const frame = placementTransform({ translation: [7, 11, -3], rotation: [Math.PI / 2, Math.PI / 2, Math.PI / 2] });
    expect(frame.origin).toEqual({ x: 7, y: 11, z: -3 });
    expect(frame.u).toEqual({ x: 0, y: 0, z: -1 });
    expect(frame.v).toEqual({ x: 0, y: 1, z: 0 });
    expect(frame.normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(placedPoint(frame, { x: 20, y: 10, z: 5 })).toEqual({ x: 12, y: 21, z: -23 });
  });

  it("transforms a plane's complete frame and leaves the authored frame untouched", () => {
    const original = { ...sketchPlaneTransform("XZ"), origin: { x: 2, y: 3, z: 4 } };
    const before = structuredClone(original), frame = placementTransform(pose), placed = placePlane(original, pose);
    expect(placed.origin).toEqual(placedPoint(frame, original.origin));
    expect(placed.u).toEqual(placedVector(frame, original.u));
    expect(placed.v).toEqual(placedVector(frame, original.v));
    expect(placed.normal).toEqual(placedVector(frame, original.normal));
    expect(original).toEqual(before);
    expect(placePlane(original)).toBe(original);
  });

  it("accepts finite inclusive bounds and rejects malformed, excessive, and nonfinite poses", () => {
    expect(validComponentPlacement({ translation: [MAX_COMPONENT_TRANSLATION, -MAX_COMPONENT_TRANSLATION, 0], rotation: [MAX_COMPONENT_ROTATION, -MAX_COMPONENT_ROTATION, 0] })).toBe(true);
    for (const invalid of [null, [], {}, { translation: [0, 0], rotation: [0, 0, 0] }, { translation: [0, 0, 0], rotation: [0, 0, 0, 0] }, { translation: ["1", 0, 0], rotation: [0, 0, 0] }, { translation: [Infinity, 0, 0], rotation: [0, 0, 0] }, { translation: [MAX_COMPONENT_TRANSLATION + 1, 0, 0], rotation: [0, 0, 0] }, { translation: [0, 0, 0], rotation: [NaN, 0, 0] }, { translation: [0, 0, 0], rotation: [MAX_COMPONENT_ROTATION + 0.001, 0, 0] }]) expect(validComponentPlacement(invalid)).toBe(false);
    expect(() => placementTransform({ translation: [Infinity, 0, 0], rotation: [0, 0, 0] })).toThrow(/placement is invalid/);
  });

  it("edits immutably, clones numeric inputs and removes an explicit identity pose", () => {
    const { document, first } = documentWithBodies(), input = structuredClone(pose);
    const updated = withComponentPlacement(document, first, input);
    input.translation[0] = 99;
    expect(updated.components[first].placement).toEqual(pose);
    expect(document.components[first].placement).toBeUndefined();
    expect(withComponentPlacement(updated, first, pose)).toBe(updated);
    expect(withComponentPlacement(updated, first, IDENTITY_PLACEMENT).components[first].placement).toBeUndefined();
    expect(() => withComponentPlacement(document, "missing", pose)).toThrow(/lost/);
  });

  it("compares equivalent rigid frames instead of treating a full turn as different", () => {
    const { document, first, second } = documentWithBodies();
    expect(componentPlacementsEqual(document, first, second)).toBe(true);
    const fullTurn = withComponentPlacement(document, second, { translation: [0, 0, 0], rotation: [0, 0, Math.PI * 2] });
    expect(componentPlacementsEqual(fullTurn, first, second)).toBe(true);
    expect(componentPlacementsEqual(withComponentPlacement(fullTurn, first, pose), first, second)).toBe(false);
  });

  it("rotates mesh positions and normals, recomputes bounds, and preserves winding and analytic assertions", () => {
    const original = { ...mesh(), geometryAssertions: { valid: true as const, volume: 1000, solidCount: 1, surfaceArea: 700 } }, before = structuredClone(original);
    const placed = placedComponentMesh(original, pose);
    expect(placed.positions).toEqual([30, -7, 4, 30, 13, 4, 20, -7, 9]);
    expect(placed.normals).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
    expect(placed.bounds).toEqual({ min: [20, -7, 4], max: [30, 13, 9] });
    expect(placed.indices).toEqual(original.indices);
    expect(placed.geometryAssertions).toEqual(original.geometryAssertions);
    expect(original).toEqual(before);
  });

  it("publishes all body placements atomically and registers native copies for disposal on later failure", () => {
    const { document, first, second } = documentWithBodies();
    const posed = withComponentPlacement(withComponentPlacement(document, first, pose), second, pose);
    const a = { shape: { id: "a", kernelHandle: {} }, mesh: { ...mesh(), geometrySource: "opencascade" as const } }, b = { shape: { id: "b", kernelHandle: {} }, mesh: { ...mesh(), bodyId: "body:other", geometrySource: "opencascade" as const } };
    const bodies = new Map([["body:solid", a], ["body:other", b]]), owned = new Set<KernelShape>();
    const positioned = { id: "placed:a", kernelHandle: {} };
    const place = vi.fn().mockReturnValueOnce(positioned).mockImplementationOnce(() => { throw new Error("native placement failed"); });
    expect(() => applyComponentPlacements(posed, { placeShape: place } as unknown as KernelAdapter, bodies, owned)).toThrow("native placement failed");
    expect(bodies.get("body:solid")).toBe(a);
    expect(bodies.get("body:other")).toBe(b);
    expect(owned.has(positioned)).toBe(true);
  });

  it("positions fallback meshes without fabricating native shapes and preserves unrelated bodies", () => {
    const { document, first } = documentWithBodies(), posed = withComponentPlacement(document, first, pose);
    const a = { shape: { id: "a", kernelHandle: {} }, mesh: { ...mesh(), geometrySource: "fallback" as const } }, b = { shape: { id: "b", kernelHandle: {} }, mesh: { ...mesh(), bodyId: "body:other", geometrySource: "fallback" as const } };
    const bodies = new Map([["body:solid", a], ["body:other", b]]), owned = new Set<KernelShape>();
    applyComponentPlacements(posed, {} as KernelAdapter, bodies, owned);
    expect(bodies.get("body:solid")!.mesh.bounds.min).toEqual([20, -7, 4]);
    expect(bodies.get("body:solid")!.shape).toBe(a.shape);
    expect(bodies.get("body:other")).toBe(b);
    expect(owned.size).toBe(0);
  });

  it("positions only the owning component's sketch and face frames", () => {
    const { document, first } = documentWithBodies(), posed = withComponentPlacement(document, first, pose);
    const plane = sketchPlaneTransform("XY");
    const planes = { transforms: new Map([["sketch:solid", plane], ["sketch:other", plane]]), faces: [{ id: "face", featureId: "solid", label: "End cap", transform: plane }], errors: new Map<string, string>() };
    const result = placeDocumentPlanes(posed, planes);
    expect(result.transforms.get("sketch:solid")).toEqual(placePlane(plane, pose));
    expect(result.transforms.get("sketch:other")).toBe(plane);
    expect(result.faces[0].transform).toEqual(placePlane(plane, pose));
    expect(planes.transforms.get("sketch:solid")).toBe(plane);
  });

  it("round trips current placements, migrates legacy placements and rejects imported poses outside bounds", () => {
    const document = createEmptyDocument("Placement schema"), placed = withComponentPlacement(document, document.rootComponentId, pose);
    const serialized = serializeProject(placed), imported = importProjectText(serialized);
    expect(imported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(imported.components[document.rootComponentId].placement).toEqual(pose);
    expect(validateDocument(placed)).toEqual([]);
    const malformed: CadDocument = { ...placed, components: { ...placed.components, [placed.rootComponentId]: { ...placed.components[placed.rootComponentId], placement: { translation: [1e9, 0, 0], rotation: [0, 0, 0] } } } };
    expect(validateDocument(malformed).some(issue => issue.message.includes("Component placement"))).toBe(true);
    expect(() => importProjectText(JSON.stringify(malformed))).toThrow(/Component placement/);
    const legacy = importProjectText(JSON.stringify({ ...document, schemaVersion: 15 }));
    expect(legacy.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(legacy.components[document.rootComponentId].placement).toBeUndefined();
  });
});

describe("positioned plane and mesh guards", () => {
  it("recovers authored axes from a positioned native plane without solving again", () => {
    const placement: ComponentPlacement = { translation: [-12, 45, 7], rotation: [0.4, -0.7, 1.1] };
    const authored = sketchPlaneTransform("YZ"), recovered = unplacePlane(placePlane(authored, placement), placement);
    for (const key of ["origin", "u", "v", "normal"] as const)
      for (const axis of ["x", "y", "z"] as const) expect(recovered[key][axis]).toBeCloseTo(authored[key][axis], 12);
  });
  it("rejects incomplete vertices and nonfinite normals before publishing positioned meshes", () => {
    expect(() => placedComponentMesh({ ...mesh(), positions: [], normals: [] }, pose)).toThrow("nonempty complete mesh");
    expect(() => placedComponentMesh({ ...mesh(), normals: [NaN, 0, 0, 0, 1, 0, 0, 0, 1] }, pose)).toThrow("nonfinite normals");
  });
  it("does not record an identical numeric placement because its property order differs", () => {
    const { document, first } = documentWithBodies(), placed = withComponentPlacement(document, first, pose);
    expect(withComponentPlacement(placed, first, { rotation: [...pose.rotation], translation: [...pose.translation] })).toBe(placed);
  });
});
