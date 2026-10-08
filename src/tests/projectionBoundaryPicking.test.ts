import { describe, expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addCircleAt, addCornerRectangle, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { projectionBoundaryTargets } from "../viewer/projectionBoundaryPicking";
import { placePlane } from "../cad/document/componentPlacement";
import type { OriginPlane } from "../cad/document/schema";
function fixture(plane: OriginPlane = "XY", direction: "positive" | "negative" | "symmetric" = "positive", round = false) {
  const sketch = round ? addCircleAt(createSketchOnPlane("Source", plane), "5mm", "7mm", "3mm") : addCornerRectangle(createSketchOnPlane("Source", plane), "30mm", "20mm");
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({ name: "Block", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction, distance: { expression: "8mm", unit: "mm" } });
  const target = createSketchOnPlane("Destination", { type: "offset", base: plane, offset: { expression: "12mm", unit: "mm" } });
  const document = upsertSketch(upsertFeature(upsertSketch(createEmptyDocument(), sketch), feature), target);
  const proof = rebuildDocument(document);
  // Coordinate unit fixture only; browser tests prove these capabilities using OC.
  proof.availableEdges = ["startCapPerimeter", "endCapPerimeter"].map((role) => ({ featureId: feature.id, bodyId: `body:${feature.id}`, role: role as "startCapPerimeter" | "endCapPerimeter" }));
  const choices = proof.availableEdges.map((edge) => ({ id: `${feature.id}:${edge.role}`, featureId: feature.id, role: edge.role, label: edge.role }));
  return { document, target, feature, proof, choices };
}
describe("native authored cap pick targets", () => {
  it.each(["XY", "XZ", "YZ"] as const)("places source boundaries on the correct %s world axes", (plane) => {
    const f = fixture(plane), targets = projectionBoundaryTargets(f.document, f.target.id, f.proof, f.choices);
    expect(targets).toHaveLength(2); expect(targets.map((t) => t.disabledReason)).toEqual([undefined, undefined]);
    expect(targets[1].curves).toHaveLength(4);
    const points = targets[1].curves.flat();
    if (plane === "XY") expect([...new Set(points.map((p) => p.z))]).toEqual([8]);
    if (plane === "XZ") expect([...new Set(points.map((p) => p.y))]).toEqual([-8]);
    if (plane === "YZ") expect([...new Set(points.map((p) => p.x))]).toEqual([8]);
    expect(points.some((p) => plane === "XY" ? p.x === 30 && p.y === 20 : plane === "XZ" ? p.x === 30 && p.z === 20 : p.y === 30 && p.z === 20)).toBe(true);
  });
  it.each([["negative", -8, 0], ["symmetric", -4, 4]] as const)("places %s cap groups at actual swept endpoints", (direction, start, end) => {
    const f = fixture("XY", direction), targets = projectionBoundaryTargets(f.document, f.target.id, f.proof, f.choices);
    expect(targets[0].curves.flat().every((p) => p.z === start)).toBe(true);
    expect(targets[1].curves.flat().every((p) => p.z === end)).toBe(true);
  });
  it("samples circular authored boundaries while retaining exact native group identity", () => {
    const f = fixture("YZ", "positive", true), targets = projectionBoundaryTargets(f.document, f.target.id, f.proof, f.choices);
    expect(targets[1].id).toBe(f.choices[1].id); expect(targets[1].curves).toHaveLength(1);
    expect(targets[1].curves[0]).toHaveLength(97);
    expect(targets[1].curves[0].every((p) => Math.abs(p.x - 8) < 1e-8 && Math.abs(Math.hypot(p.y - 5, p.z - 7) - 3) < 1e-8)).toBe(true);
  });
  it("diagnoses incompatible destination planes without advertising a compatible pick", () => {
    const f = fixture(), document = { ...f.document, sketches: { ...f.document.sketches, [f.target.id]: { ...f.target, plane: { type: "origin" as const, plane: "XZ" as const } } } };
    const targets = projectionBoundaryTargets(document, f.target.id, f.proof, f.choices);
    expect(targets.every((t) => t.disabledReason?.includes("parallel planes"))).toBe(true);
    expect(targets.every((t) => t.curves.length === 4)).toBe(true);
  });
  it("displays placed native boundaries while checking shared design-plane compatibility", () => {
    const f = fixture(), placement = { translation: [10, 20, 30] as [number, number, number], rotation: [Math.PI / 2, 0, 0] as [number, number, number] };
    const document = { ...f.document, components: { ...f.document.components, [f.document.rootComponentId]: { ...f.document.components[f.document.rootComponentId], placement } } };
    const proof = { ...f.proof, sketchPlanes: Object.fromEntries(Object.entries(f.proof.sketchPlanes!).map(([id, plane]) => [id, placePlane(plane, placement)])) };
    const targets = projectionBoundaryTargets(document, f.target.id, proof, f.choices);
    expect(targets[1].disabledReason).toBeUndefined();
    const points = targets[1].curves.flat();
    expect(points.every((point) => Math.abs(point.y - 12) < 1e-8)).toBe(true);
    expect(points.some((point) => Math.abs(point.x - 40) < 1e-8 && Math.abs(point.z - 50) < 1e-8)).toBe(true);
    const different = { ...document, components: { ...document.components, destination: { id: "destination", name: "Destination" } }, sketches: { ...document.sketches, [f.target.id]: { ...f.target, componentId: "destination" } } };
    const incompatible = projectionBoundaryTargets(different, f.target.id, proof, f.choices);
    expect(incompatible.every((target) => target.curves.length && target.disabledReason?.includes("parallel planes"))).toBe(true);
  });
  it("checks placed world normals for new links and preserves legacy design-mode repair compatibility", () => {
    const f = fixture(), sourcePose = { translation: [10, 20, 30] as [number, number, number], rotation: [Math.PI / 2, 0, 0] as [number, number, number] };
    const document = { ...f.document, components: { ...f.document.components, [f.document.rootComponentId]: { ...f.document.components[f.document.rootComponentId], placement: sourcePose }, destination: { id: "destination", name: "Destination" } }, sketches: { ...f.document.sketches, [f.target.id]: { ...f.target, componentId: "destination" } } };
    const incompatible = projectionBoundaryTargets(document, f.target.id, f.proof, f.choices);
    expect(incompatible).toHaveLength(2); expect(incompatible.every(target => target.disabledReason?.includes("parallel planes"))).toBe(true);
    const worldParallel = { ...document, sketches: { ...document.sketches, [f.target.id]: { ...document.sketches[f.target.id], plane: { type: "origin" as const, plane: "XZ" as const } } } };
    const worldTargets = projectionBoundaryTargets(worldParallel, f.target.id, f.proof, f.choices);
    expect(worldTargets).toHaveLength(2); expect(worldTargets.every(target => !target.disabledReason)).toBe(true);
    const legacy = { ...document, sketches: { ...document.sketches, [f.target.id]: { ...document.sketches[f.target.id], projections: [{ id: "legacy", sourceFeatureId: f.feature.id, role: "endCapPerimeter" as const, construction: false, members: [] }] } } };
    const legacyTargets = projectionBoundaryTargets(legacy, f.target.id, f.proof, f.choices, "legacy");
    expect(legacyTargets).toHaveLength(2); expect(legacyTargets.every(target => !target.disabledReason)).toBe(true);
    const missing = projectionBoundaryTargets(legacy, f.target.id, f.proof, f.choices, "removed");
    expect(missing).toHaveLength(2); expect(missing.every(target => !target.curves.length && target.disabledReason?.includes("link was lost"))).toBe(true);
  });
  it("reserves display capacity for compatible sources before incompatible diagnostic outlines", () => {
    const f = fixture("XY", "positive", true);
    let document = f.document;
    const proof = { ...f.proof, solvedSketches: { ...f.proof.solvedSketches }, profiles: { ...f.proof.profiles }, sketchPlanes: { ...f.proof.sketchPlanes }, availableEdges: [...f.proof.availableEdges!] };
    const incompatible = [] as typeof f.choices;
    for (let i = 0; i < 170; i++) {
      const sketch = addCircleAt(createSketchOnPlane(`Oblique ${i}`, "XZ"), "5mm", "7mm", "3mm");
      const solved = solveSketch(sketch, {}), profiles = detectProfiles(solved).profiles;
      const feature = createExtrudeFeature({ name: `Oblique body ${i}`, sketchId: sketch.id, profileId: profiles[0].id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
      document = upsertFeature(upsertSketch(document, sketch), feature);
      proof.solvedSketches[sketch.id] = solved; proof.profiles[sketch.id] = profiles;
      for (const role of ["startCapPerimeter", "endCapPerimeter"] as const) {
        proof.availableEdges.push({ featureId: feature.id, bodyId: `body:${feature.id}`, role });
        incompatible.push({ id: `${feature.id}:${role}`, featureId: feature.id, role, label: role });
      }
    }
    document = { ...document, sketches: { ...document.sketches, [f.target.id]: { ...document.sketches[f.target.id], timelineStep: 1000 } } };
    const choices = [...incompatible, ...f.choices], targets = projectionBoundaryTargets(document, f.target.id, proof, choices);
    expect(targets.map((target) => target.id)).toEqual(choices.map((choice) => choice.id));
    expect(targets.slice(-2).every((target) => !target.disabledReason && target.curves[0].length === 97)).toBe(true);
    expect(targets.reduce((total, target) => total + target.curves.reduce((sum, curve) => sum + curve.length, 0), 0)).toBeLessThanOrEqual(32768);
    expect(targets.slice(0, -2).every((target) => target.disabledReason?.includes("parallel planes"))).toBe(true);
  });
  it("refuses missing native group proof, failed results and foreign document proofs", () => {
    const f = fixture();
    expect(projectionBoundaryTargets(f.document, f.target.id, { ...f.proof, availableEdges: [] }, f.choices).every((t) => !t.curves.length && t.disabledReason?.includes("no longer available"))).toBe(true);
    expect(projectionBoundaryTargets(f.document, f.target.id, { ...f.proof, success: false }, f.choices)).toEqual([]);
    expect(projectionBoundaryTargets(f.document, f.target.id, { ...f.proof, documentId: "other" }, f.choices)).toEqual([]);
  });
});
