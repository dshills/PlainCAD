import { describe, expect, it } from "vitest";
import type { CadDocument, ComponentPlacement, OriginPlane, Sketch } from "../cad/document/schema";
import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addComponent } from "../cad/document/components";
import { withComponentPlacement } from "../cad/document/componentPlacement";
import { addArc, addCircleAt, addLine, addPoint, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { planSketchProjection, materializeSketchProjections } from "../cad/sketch/sketchProjection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { nativeFeatureSignature } from "../cad/features/nativeFeatureSignature";
import { resolveDocumentPlanes } from "../cad/sketch/planes";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { validateDocument } from "../cad/document/validate";
import { placedProjectionConsumerBodies } from "../cad/features/placedProjectionDependencies";

function fixture(plane: OriginPlane = "XY", arc = false) {
  const sourceComponent = addComponent(createEmptyDocument("Placed projection"), "Source"), targetComponent = addComponent(sourceComponent.document, "Destination");
  let sketch: Sketch = { ...createSketchOnPlane("Source boundary", plane), componentId: sourceComponent.component.id };
  if (!arc) sketch = addCircleAt(sketch, "5mm", "7mm", "3mm");
  else {
    const center = addPoint(sketch, "5mm", "7mm"), start = addPoint(center.sketch, "8mm", "7mm"), end = addPoint(start.sketch, "2mm", "7mm");
    const curved = addArc(end.sketch, center.pointId, start.pointId, end.pointId, false);
    sketch = addLine(curved.sketch, end.pointId, start.pointId).sketch;
  }
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({ name: "Source extrusion", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
  const target = { ...createSketchOnPlane("Destination", { type: "offset" as const, base: plane, offset: { expression: "12mm", unit: "mm" } }), componentId: targetComponent.component.id };
  const document = upsertSketch(upsertFeature(upsertSketch(targetComponent.document, sketch), feature), target), result = rebuildDocument(document);
  // These unit fixtures check coordinate math, not native cap survival.
  result.availableEdges = [{ featureId: feature.id, bodyId: `body:${feature.id}`, role: "endCapPerimeter" }];
  const plan = planSketchProjection(document, target.id, feature.id, "endCapPerimeter", false, result);
  const materialize = (document: CadDocument) => materializeSketchProjections(document, document.sketches[target.id], new Map(Object.entries(result.solvedSketches!)), new Map(Object.entries(result.profiles!).map(([id, profiles]) => [id, { profiles }])), {});
  return { document, result, feature, target, sourceComponent: sourceComponent.component.id, targetComponent: targetComponent.component.id, plan, materialize };
}
const translation = (x: number, y: number, z: number): ComponentPlacement => ({ translation: [x, y, z], rotation: [0, 0, 0] });

describe("placed associative projection", () => {
  it.each([["XY", 7, 15], ["XZ", 7, 23], ["YZ", 15, 23]] as const)("projects translated %s analytic circles into target design coordinates", (plane, dx, dy) => {
    const f = fixture(plane), posed = withComponentPlacement(withComponentPlacement(f.plan.document, f.sourceComponent, translation(10, 20, 30)), f.targetComponent, translation(3, 5, 7));
    const solved = solveSketch(f.materialize(posed), {});
    expect(solved.errors).toEqual([]); expect(solved.circles).toHaveLength(1);
    expect(solved.circles[0].center.x).toBeCloseTo(5 + dx, 10); expect(solved.circles[0].center.y).toBeCloseTo(7 + dy, 10); expect(solved.circles[0].radius).toBe(3);
    expect(detectProfiles(solved).errors).toEqual([]); expect(detectProfiles(solved).profiles[0].outerLoop.type).toBe("circle");
  });
  it.each(["XY", "XZ", "YZ"] as const)("retains circular radius and arc winding under %s in-plane quarter-turns", (plane) => {
    const f = fixture(plane, true), rotation: ComponentPlacement["rotation"] = plane === "XY" ? [0, 0, Math.PI / 2] : plane === "XZ" ? [0, -Math.PI / 2, 0] : [Math.PI / 2, 0, 0];
    const posed = withComponentPlacement(f.plan.document, f.sourceComponent, { translation: [0, 0, 0], rotation });
    const solved = solveSketch(f.materialize(posed), {});
    expect(solved.errors).toEqual([]); expect(solved.arcs).toHaveLength(1); expect(solved.arcs[0].radius).toBe(3);
    expect(solved.arcs[0].center.x).toBeCloseTo(-7, 10); expect(solved.arcs[0].center.y).toBeCloseTo(5, 10); expect(solved.arcs[0].sweep).toBeCloseTo(Math.PI, 10);
    expect(detectProfiles(solved).errors).toEqual([]); expect(detectProfiles(solved).profiles[0].outerLoop.segments).toHaveLength(2);
  });
  it("accepts different authored planes when placed world normals become parallel and reverses opposite-normal arcs", () => {
    const f = fixture("XY", true);
    const destination = { ...f.plan.document, sketches: { ...f.plan.document.sketches, [f.target.id]: { ...f.plan.document.sketches[f.target.id], plane: { type: "origin" as const, plane: "XZ" as const } } } };
    const posed = withComponentPlacement(destination, f.sourceComponent, { translation: [0, 0, 0], rotation: [Math.PI / 2, 0, 0] });
    const solved = solveSketch(f.materialize(posed), {});
    expect(solved.errors).toEqual([]); expect(solved.arcs[0].center).toMatchObject({ x: 5, y: 7 }); expect(solved.arcs[0].sweep).toBeCloseTo(Math.PI, 10);
    const opposite = withComponentPlacement(f.plan.document, f.sourceComponent, { translation: [0, 0, 0], rotation: [Math.PI, 0, 0] });
    const reversed = solveSketch(f.materialize(opposite), {});
    expect(reversed.arcs[0].center).toMatchObject({ x: 5, y: -7 }); expect(reversed.arcs[0].sweep).toBeCloseTo(-Math.PI, 10);
    expect(detectProfiles(reversed).errors).toEqual([]); expect(detectProfiles(reversed).profiles[0].outerLoop.segments).toHaveLength(2);
  });
  it("diagnoses oblique motion and coordinate limits without guessing ellipse geometry", () => {
    const f = fixture();
    expect(() => f.materialize(withComponentPlacement(f.plan.document, f.sourceComponent, { translation: [0, 0, 0], rotation: [0.25, 0, 0] }))).toThrow(/parallel planes.*Oblique circles/);
    const excessive = withComponentPlacement(withComponentPlacement(f.plan.document, f.sourceComponent, translation(1e8, 0, 0)), f.targetComponent, translation(-1e8, 0, 0));
    expect(() => f.materialize(excessive)).toThrow("Projected coordinates");
  });
  it("rejects mismatched feature/sketch owners before applying a guessed component transform", () => {
    const f = fixture(), mismatch = { ...f.plan.document, features: f.plan.document.features.map(feature => feature.id === f.feature.id ? { ...feature, componentId: f.targetComponent } : feature) };
    expect(() => f.materialize(mismatch)).toThrow("same component");
    expect(validateDocument(mismatch).some(issue => issue.message.includes("Feature and source sketch must belong"))).toBe(true);
  });
  it("round trips world links and migrates legacy links without changing associations", () => {
    const f = fixture(), reopened = importProjectText(serializeProject(f.plan.document));
    expect(reopened.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(reopened.sketches[f.target.id].projections![0].coordinateSpace).toBe("world");
    expect(serializeProject(reopened)).toBe(serializeProject(f.plan.document));
    const legacy = importProjectText(JSON.stringify({ ...f.plan.document, schemaVersion: 16 }));
    expect(legacy.sketches[f.target.id].projections![0].coordinateSpace).toBeUndefined();
    expect(legacy.sketches[f.feature.sketchId].projections).toBeUndefined();
    const malformed = { ...f.plan.document, sketches: { ...f.plan.document.sketches, [f.target.id]: { ...f.plan.document.sketches[f.target.id], projections: [{ ...f.plan.projection, coordinateSpace: "unknown" }] } } };
    expect(validateDocument(malformed as CadDocument).some(issue => issue.message === "Malformed sketch projection.")).toBe(true);
    expect(() => importProjectText(JSON.stringify(malformed))).toThrow("Malformed sketch projection");
  });
  it("invalidates exact consumer signatures after source or destination motion", () => {
    const f = fixture();
    const signature = (document: CadDocument) => {
      const sketch = f.materialize(document), solved = solveSketch(sketch, {}), profiles = detectProfiles(solved);
      const feature = createExtrudeFeature({ name: "Consumer", sketchId: sketch.id, profileId: profiles.profiles[0].id, operation: "newBody", direction: "positive", distance: { expression: "2mm", unit: "mm" } });
      return nativeFeatureSignature({ ...feature, id: "consumer" }, document, new Map([[sketch.id, solved]]), new Map([[sketch.id, profiles]]), resolveDocumentPlanes(document, {}, new Map([[sketch.id, solved]]), true).transforms, {}, new Map());
    };
    const original = signature(f.plan.document);
    expect(signature(withComponentPlacement(f.plan.document, f.sourceComponent, translation(10, 0, 0)))).not.toBe(original);
    expect(signature(withComponentPlacement(f.plan.document, f.targetComponent, translation(10, 0, 0)))).not.toBe(original);
    expect(signature(withComponentPlacement(withComponentPlacement(f.plan.document, f.sourceComponent, translation(10, 0, 0)), f.targetComponent, translation(10, 0, 0)))).toBe(original);
  });
  it("traces only world-link consumer bodies, legacy dependents and subsequent boolean changes", () => {
    const f = fixture(), sketch = f.plan.document.sketches[f.target.id], profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const consumer = createExtrudeFeature({ name: "Consumer", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "2mm", unit: "mm" } });
    const document = upsertFeature(f.plan.document, consumer);
    expect([...placedProjectionConsumerBodies(document, f.sourceComponent)]).toEqual([`body:${consumer.id}`]);
    expect([...placedProjectionConsumerBodies(document, f.targetComponent)]).toEqual([`body:${consumer.id}`]);
    expect(placedProjectionConsumerBodies(document, document.rootComponentId).size).toBe(0);
    const legacy = { ...document, sketches: { ...document.sketches, [sketch.id]: { ...sketch, projections: [{ ...f.plan.projection, coordinateSpace: undefined }] } } };
    expect(placedProjectionConsumerBodies(legacy, f.sourceComponent).size).toBe(0);
    const cut = { ...consumer, id: "cut", operation: "cut" as const, targetBodyIds: [`body:${f.feature.id}`] };
    const cutDocument = upsertFeature(f.plan.document, cut);
    expect([...placedProjectionConsumerBodies(cutDocument, f.sourceComponent)]).toEqual([`body:${f.feature.id}`]);
  });
});
