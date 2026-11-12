import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { planSketchProjection } from "../cad/sketch/sketchProjection";
import { applyCadCommand, type CadCommandCall } from "../commands/cadCommandOperations";
import { placePlane } from "../cad/document/componentPlacement";
import type { ComponentPlacement } from "../cad/document/schema";
import { validateMesh } from "../fabrication/meshValidation";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import {
  addCircleAt,
  addCenterRectangle,
  addLine,
  addPoint,
  addCornerRectangle,
  createXySketch,
  createSketchOnPlane,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { faceOwnerModifiedBefore, resolveDocumentPlanes, sketchPlaneTransform, stableFaceId } from "../cad/sketch/planes";
import { clearNativeFeatureCache, rebuildDocument } from "../cad/features/rebuildGraph";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { TESSELLATION_LOD } from "../cad/kernel/tessellationCache";
import { getDisposableScopeMetrics } from "../cad/kernel/disposableScope";
import { resolveRevolveAxis } from "../cad/features/revolveAxis";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../cad/document/CadDocument";
import { faceReferenceBodyId, pocketFloorId } from "../cad/document/faceReferences";
import { stableBodyIdForFeature } from "../cad/document/ids";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/projectCodec";
import { appendProject } from "../persistence/appendProject";
import { expectedVolume, machinedReferenceFixture, pocketFloorRef, rimId, stockBodyId, trimPocketFloor } from "./fixtures/machinedReferences";

// Exercise the exact installed WASM bindings, with no geometry mocks.
vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const root = `${process.cwd()}/node_modules/opencascade.js/dist`;
  const filename = `${root}/opencascade.wasm.js`;
  const factory = new Function(
    "require",
    "__dirname",
    "__filename",
    readFileSync(filename, "utf8").replace(
      "export default opencascade;",
      "return opencascade;",
    ),
  )(createRequire(filename), root, filename);
  return {
    default: () =>
      factory({ wasmBinary: readFileSync(`${root}/opencascade.wasm.wasm`) }),
  };
});

const kernel = new OpenCascadeKernel();
const options = {
  ...TESSELLATION_LOD.default,
  linearDeflection: 0.05,
  angularDeflection: 0.1,
};
function rectangle(width = 20, height = 10) {
  const sketch = addCornerRectangle(
    createXySketch(),
    `${width}mm`,
    `${height}mm`,
  );
  const solved = solveSketch(sketch, {});
  return { sketch, solved, profile: detectProfiles(solved).profiles[0] };
}
function volume(shape: ReturnType<typeof kernel.createBox>, solidCount = 1) {
  const mesh = kernel.tessellate(shape, options);
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions?.valid).toBe(true);
  expect(mesh.geometryAssertions?.solidCount).toBe(solidCount);
  let signed = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3,
      b = mesh.indices[i + 1] * 3,
      c = mesh.indices[i + 2] * 3,
      p = mesh.positions;
    signed +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  expect(signed).toBeGreaterThan(0);
  expect(signed / mesh.geometryAssertions!.volume).toBeCloseTo(1, 2);
  return mesh.geometryAssertions!.volume;
}
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
beforeAll(async () => OpenCascadeKernel.initialize());
describe("native modeling geometry", () => {
  it("cuts a linked face region using its rebuilt profile and the current authored depth unit", () => {
    let document = createEmptyDocument("Linked face pocket");
    const execute = (call: CadCommandCall) => {
      const result = applyCadCommand(document, call);
      document = result.document;
      return result.result;
    };
    const stockSketch = execute({ command: "cad.sketch.create", arguments: { name: "Stock", plane: "XY" } }).id!;
    execute({ command: "cad.sketch.rectangle", arguments: { sketchId: stockSketch, width: "40mm", height: "30mm" } });
    const stock = execute({ command: "cad.feature.extrude", arguments: { sketchId: stockSketch, distance: "10mm" } });
    const center = execute({ command: "cad.parameter.add", arguments: { name: "center_x", expression: "30mm" } });
    const source = execute({ command: "cad.sketch.create", arguments: { name: "Projection source", plane: "XY", offset: "12mm" } }).id!;
    execute({ command: "cad.sketch.circle", arguments: { sketchId: source, center: { x: "center_x", y: "15mm" }, radius: "2mm" } });
    const cylinder = execute({ command: "cad.feature.extrude", arguments: { sketchId: source, distance: "2mm" } });
    const pocket = execute({ command: "cad.sketch.createOnFace", arguments: {
      name: "Pocket outline", featureId: stock.id!, stableFaceId: `extrude:${stock.id}:endCap`,
    } }).id!;
    execute({ command: "cad.sketch.rectangle", arguments: { sketchId: pocket, origin: { x: "10mm", y: "10mm" }, width: "10mm", height: "10mm" } });
    const rebuild = () => rebuildDocument(document, { reuseNativeFeatures: false });
    document = planSketchProjection(document, pocket, cylinder.id!, "endCapPerimeter", false, rebuild()).document;
    execute({ command: "cad.parameter.update", arguments: { parameterId: center.id!, expression: "15mm" } });
    const current = rebuild();
    expect(current.success, JSON.stringify(current.errors)).toBe(true);
    const region = current.profiles?.[pocket].find(profile => profile.innerLoops.length === 1);
    expect(region).toBeDefined();
    const raw = detectProfiles(solveSketch(document.sketches[pocket], evaluateParameters(document.parameters).values));
    expect(raw.profiles.some(profile => profile.id === region!.id)).toBe(false);
    const command = { command: "cad.feature.pocket", arguments: { sketchId: pocket, profileId: region!.id, targetBodyId: stock.bodyId!, distance: "2mm" } };
    expect(() => applyCadCommand(document, command)).toThrow(/current native rebuild/);
    const cut = applyCadCommand(document, command, { native: current });
    document = cut.document;
    const stockProof = () => {
      const result = rebuild();
      expect(result.success, JSON.stringify(result.errors)).toBe(true);
      const mesh = result.meshes.find(mesh => mesh.bodyId === stock.bodyId);
      expect(mesh).toMatchObject({ geometrySource: "opencascade", kernelOperation: "cut", geometryAssertions: { valid: true, solidCount: 1 } });
      return mesh!.geometryAssertions!.volume;
    };
    expect(stockProof()).toBeCloseTo(12000 - 2 * (100 - 4 * Math.PI), 6);
    document = { ...document, unitSettings: { ...document.unitSettings, length: "in" } };
    execute({ command: "cad.feature.update", arguments: { featureId: cut.result.id!, distance: "0.1" } });
    expect(stockProof()).toBeCloseTo(12000 - 2.54 * (100 - 4 * Math.PI), 6);
    document = { ...document, unitSettings: { ...document.unitSettings, length: "mm" } };
    execute({ command: "cad.feature.update", arguments: { featureId: cut.result.id!, distance: "0.1" } });
    expect(stockProof()).toBeCloseTo(12000 - 2.54 * (100 - 4 * Math.PI), 6);
  });

  it("hollows either authored rectangular cap with a valid solid and exact remaining wall volume", () => {
    const base = kernel.extrudeProfile(rectangle().profile, 8);
    const shapes = [base];
    const own = (shape: typeof base) => { shapes.push(shape); return shape; };
    try {
      const triangleAreaAt = (shape: typeof base, z: number) => {
        const mesh = kernel.tessellate(shape, options);
        let area = 0;
        for (let i = 0; i < mesh.indices.length; i += 3) {
          const [a, b, c] = mesh.indices.slice(i, i + 3).map(index => index * 3);
          const p = mesh.positions;
          if ([a, b, c].every(offset => Math.abs(p[offset + 2] - z) < 1e-7))
            area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])) / 2;
        }
        return area;
      };
      const startShell = own(kernel.shell(base, "startCap", 1));
      const endShell = own(kernel.shell(base, "endCap", 1));
      for (const [opening, shell] of [["startCap", startShell], ["endCap", endShell]] as const) {
        expect(volume(shell)).toBeCloseTo(1600 - 18 * 8 * 7, 6);
        const native = kernel.tessellate(shell, options);
        expect(native.kernelOperation).toBe("shell");
        expect(native.bounds).toEqual(kernel.tessellate(base, options).bounds);
        // The opened cap retains only its rim, with a complete floor one mm
        // inside the opposite cap. The removed cap must not be silently swapped.
        expect(triangleAreaAt(shell, opening === "startCap" ? 0 : 8)).toBeCloseTo(56, 6);
        expect(triangleAreaAt(shell, opening === "startCap" ? 7 : 1)).toBeCloseTo(144, 6);
      }
      expect(() => own(kernel.shell(base, "endCap", 5))).toThrow(/collapses the cavity/);
      expect(() => own(kernel.shell(base, "endCap", -1))).toThrow(/wall thickness/i);
      expect(() => own(kernel.shell(base, "side" as never, 1))).toThrow(/start or end cap/);
      expect(() => own(kernel.shell(startShell, "endCap", 1))).toThrow(/unmodified native/);
      const cloned = own(kernel.cloneShape(endShell));
      const placed = own(kernel.placeShape(cloned, { translation: [10, -5, 2], rotation: [0, 0, 0] }));
      expect(volume(placed)).toBeCloseTo(592, 6);
      expect(kernel.nativeBounds(placed)).toEqual({ min: [10, -5, 2], max: [30, 5, 10] });
      const cutter = own(kernel.extrudeProfile(rectangle(2, 2).profile, 2, {
        ...sketchPlaneTransform("XY"), origin: { x: 9, y: 4, z: 0 },
      }));
      expect(volume(own(kernel.cut(endShell, cutter)))).toBeCloseTo(588, 6);
      expect(volume(base)).toBeCloseTo(1600, 6);
    } finally {
      shapes.forEach(shape => kernel.disposeShape(shape));
    }
  });
  it("keeps Shell's source body ownership on cold and cached rebuilds and validates surviving native faces", () => {
    const { sketch, profile } = rectangle();
    let document = upsertSketch(createEmptyDocument("Shelled source"), sketch);
    const source = createExtrudeFeature({ name: "Original extrusion", sketchId: sketch.id, profileId: profile.id,
      operation: "newBody", distance: { expression: "8mm", unit: "mm" }, direction: "positive" });
    document = upsertFeature(document, source);
    const faceRef = { type: "face" as const, featureId: source.id, stableFaceId: stableFaceId(source.id, "startCap") };
    const earlier = createSketchOnPlane("Earlier face sketch", faceRef);
    document = upsertSketch(document, earlier);
    document = upsertFeature(document, { type: "shell", id: "box-shell", name: "Later Shell", sourceFeatureId: source.id,
      opening: "endCap", wallThickness: { expression: "1mm", unit: "mm" } });
    const later = createSketchOnPlane("Retained face sketch", faceRef);
    document = upsertSketch(document, later);
    expect(faceOwnerModifiedBefore(document, source.id, document.sketches[earlier.id])).toBe(false);
    expect(faceOwnerModifiedBefore(document, source.id, document.sketches[later.id])).toBe(true);
    expect(resolveDocumentPlanes(document, {}).errors.get(later.id)).toContain("owner body was modified");
    try {
      const first = rebuildDocument(document);
      const cached = rebuildDocument(document);
      for (const result of [first, cached]) {
        expect(result.errors).toEqual([]);
        expect(result.bodies).toMatchObject([{ id: `body:${source.id}`, name: source.name, featureId: source.id }]);
        expect(result.meshes[0].geometryAssertions?.volume).toBeCloseTo(592, 6);
        expect(result.sketchPlanes?.[later.id]).toBeDefined();
      }
      expect(cached.metrics!.nativeFeatureCacheHits).toBeGreaterThan(0);
    } finally { clearNativeFeatureCache(); }
  });

  it("proves placed pocket floors and complete native hole entrance rims through parameter edits and save/open", () => {
    const { document } = machinedReferenceFixture();
    const sketch = createSketchOnPlane("On the floor", pocketFloorRef);
    const initial = upsertSketch(document, sketch);
    expect(faceReferenceBodyId(initial, pocketFloorRef)).toBe(stockBodyId);
    try {
      const check = (source: typeof document, depth: number, diameter: number) => {
        const result = rebuildDocument(source);
        expect(result.errors).toEqual([]);
        expect(result.meshes).toHaveLength(1);
        expect(result.meshes[0]).toMatchObject({ bodyId: stockBodyId, geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
        expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume(depth, diameter), 5);
        const floor = result.availableFaces!.find(face => face.id === pocketFloorRef.stableFaceId);
        expect(floor).toMatchObject({ role: "pocketFloor", bodyId: stockBodyId, featureId: pocketFloorRef.featureId });
        expect(floor!.transform.origin.z).toBeCloseTo(25 - depth, 7);
        expect(result.sketchPlanes?.[sketch.id]?.origin.z).toBeCloseTo(25 - depth, 7);
        const rim = result.availableHoleRims?.find(item => item.id === rimId);
        expect(rim).toMatchObject({ bodyId: stockBodyId, featureId: "machined-hole" });
        expect(rim!.radius).toBeCloseTo(diameter / 2, 7);
        expect(rim!.plane.origin.x).toBeCloseTo(-18, 7);
        expect(rim!.plane.origin.y).toBeCloseTo(42, 7);
        expect(rim!.plane.origin.z).toBeCloseTo(25, 7);
      };
      check(initial, 6, 4);
      const edited = upsertParameter(upsertParameter(initial, { ...initial.parameters.pocketDepth, expression: "8mm" }), { ...initial.parameters.boreSize, expression: "6mm" });
      const restored = importProjectText(serializeProject(edited));
      expect(restored.sketches[sketch.id].plane).toEqual(pocketFloorRef);
      check(restored, 8, 6);
      const childSketch = addCircleAt(restored.sketches[sketch.id], "18mm", "16mm", "1mm");
      const child = createExtrudeFeature({ name: "Second pocket", sketchId: childSketch.id,
        profileId: detectProfiles(solveSketch(childSketch, {})).profiles[0].id, direction: "negative", operation: "cut",
        distance: { expression: "1mm", unit: "mm" }, targetBodyIds: [stockBodyId] });
      const cut = rebuildDocument(upsertFeature(upsertSketch(restored, childSketch), child));
      expect(cut.errors).toEqual([]);
      expect(cut.meshes[0].bodyId).toBe(stockBodyId);
      expect(cut.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume(8, 6) - Math.PI, 5);
      expect(cut.sketchPlanes?.[sketch.id]?.origin.z).toBeCloseTo(17, 7);
      expect(cut.availableFaces?.some(face => face.id === pocketFloorRef.stableFaceId)).toBe(false);
    } finally { clearNativeFeatureCache(); }
  });

  it("retains an earlier floor sketch but rejects a trimmed floor and a replaced entrance rim at later stages", () => {
    const { document, holeSketch, holePointId } = machinedReferenceFixture(false);
    const early = createSketchOnPlane("Before trimming", pocketFloorRef);
    const late = createSketchOnPlane("After trimming", pocketFloorRef);
    const trimmed = trimPocketFloor(upsertSketch(document, early));
    try {
      const result = rebuildDocument(trimmed);
      expect(result.errors).toEqual([]);
      expect(result.sketchPlanes?.[early.id]?.origin.z).toBeCloseTo(14, 7);
      expect(result.availableFaces?.some(face => face.id === pocketFloorRef.stableFaceId)).toBe(false);
      expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume() - Math.PI * 1.5 ** 2 * 14, 5);
      const lost = rebuildDocument(upsertSketch(trimmed, late));
      expect(lost.errors).toContainEqual(expect.objectContaining({ source: "sketch", sourceId: late.id, message: expect.stringMatching(/Pocket floor is missing, trimmed, split or ambiguous/) }));
      expect(lost.sketchPlanes?.[late.id]).toBeUndefined();
      expect(lost.sketchPlanes?.[early.id]?.origin.z).toBeCloseTo(14, 7);

      const counterbored = upsertFeature(document, { id: "counterbore", name: "Counterbore", type: "hole", sketchId: holeSketch.id,
        direction: "negative", centerPointIds: [holePointId], diameter: { expression: "6mm", unit: "mm" },
        depth: { expression: "1mm", unit: "mm" }, targetBodyIds: [stockBodyId] });
      const widened = rebuildDocument(counterbored);
      expect(widened.errors).toEqual([]);
      expect(widened.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume() - Math.PI * 5, 5);
      expect(widened.availableHoleRims?.some(rim => rim.id === rimId)).toBe(false);
      expect(widened.availableHoleRims?.find(rim => rim.id === "hole:counterbore:entrance")?.radius).toBeCloseTo(3, 7);
    } finally { clearNativeFeatureCache(); }
  });

  it("does not attribute a later joined plate to an earlier through-depth cut, even with native reuse", () => {
    const { document } = machinedReferenceFixture(false);
    // Leave one opening so the joined plate really does create a unique, full
    // face at the predicted plane; checking only final geometry would accept it.
    const pocketOnly = { ...document, features: document.features.filter(item => item.id !== "machined-hole") };
    const deep = upsertParameter(pocketOnly, { ...document.parameters.pocketDepth, expression: "20mm" });
    const plate = addCornerRectangle(createSketchOnPlane("Added lower plate", { type: "offset", base: "XY", offset: { expression: "-2mm", unit: "mm" } }), "60mm", "40mm");
    const join = createExtrudeFeature({ name: "Join lower plate", sketchId: plate.id,
      profileId: detectProfiles(solveSketch(plate, {})).profiles[0].id, direction: "positive", operation: "join",
      distance: { expression: "2mm", unit: "mm" }, targetBodyIds: [stockBodyId] });
    const joined = upsertFeature(upsertSketch(deep, plate), join);
    try {
      const check = (result: ReturnType<typeof rebuildDocument>) => {
        expect(result.errors).toEqual([]);
        expect(result.meshes[0]).toMatchObject({ bodyId: stockBodyId, geometryAssertions: { valid: true, solidCount: 1 } });
        expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume(20, 0) + 4800, 5);
        expect(result.meshes[0].bounds.min[2]).toBeCloseTo(-2, 7);
        expect(result.availableFaces?.some(face => face.id === pocketFloorRef.stableFaceId)).toBe(false);
      };
      check(rebuildDocument(joined));
      const warm = rebuildDocument(joined);
      check(warm);
      expect(warm.metrics?.nativeFeatureCacheHits).toBeGreaterThan(0);
      const late = createSketchOnPlane("Claim the later floor", pocketFloorRef);
      const lost = rebuildDocument(upsertSketch(joined, late));
      expect(lost.errors).toContainEqual(expect.objectContaining({ source: "sketch", sourceId: late.id, message: expect.stringMatching(/not created by its owner cut/) }));
      expect(lost.sketchPlanes?.[late.id]).toBeUndefined();
    } finally { clearNativeFeatureCache(); }
  });

  it("does not revive a destroyed pocket floor when an identical floor is later recut", () => {
    const { document } = machinedReferenceFixture(false);
    const early = createSketchOnPlane("Original floor consumer", pocketFloorRef);
    const blank = createSketchOnPlane("Pocket filler", { type: "offset", base: "XY", offset: { expression: "13mm", unit: "mm" } });
    const fill = addCanvasGeometry(blank, solveSketch(blank, {}), "rectangle", [{ x: 11, y: 11 }, { x: 25, y: 21 }]).sketch;
    const join = createExtrudeFeature({ name: "Fill the original pocket", sketchId: fill.id,
      profileId: detectProfiles(solveSketch(fill, {})).profiles[0].id, direction: "positive", operation: "join",
      distance: { expression: "7mm", unit: "mm" }, targetBodyIds: [stockBodyId] });
    const filled = upsertFeature(upsertSketch(upsertSketch(document, early), fill), join);
    const original = document.features.find(item => item.id === pocketFloorRef.featureId)!;
    const { timelineStep: _previousStep, ...settings } = original;
    const recut = upsertFeature(filled, { ...settings, id: "recut-pocket", name: "Recut the pocket" });
    const replacement = { ...pocketFloorRef, featureId: "recut-pocket", stableFaceId: pocketFloorId("recut-pocket") };
    const repaired = createSketchOnPlane("Replacement floor consumer", replacement);
    const candidate = upsertSketch(recut, repaired);
    try {
      const check = (result: ReturnType<typeof rebuildDocument>) => {
        expect(result.errors).toEqual([]);
        expect(result.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
        expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume(), 5);
        expect(result.sketchPlanes?.[early.id]?.origin.z).toBeCloseTo(14, 7);
        expect(result.sketchPlanes?.[repaired.id]?.origin.z).toBeCloseTo(14, 7);
        expect(result.availableFaces?.some(face => face.id === pocketFloorRef.stableFaceId)).toBe(false);
        expect(result.availableFaces).toContainEqual(expect.objectContaining({ id: replacement.stableFaceId, bodyId: stockBodyId }));
      };
      check(rebuildDocument(candidate));
      const warm = rebuildDocument(candidate);
      check(warm);
      expect(warm.metrics?.nativeFeatureCacheHits).toBeGreaterThan(0);
      const late = createSketchOnPlane("Stale floor consumer", pocketFloorRef);
      const lost = rebuildDocument(upsertSketch(candidate, late));
      expect(lost.errors).toContainEqual(expect.objectContaining({ source: "sketch", sourceId: late.id, message: expect.stringMatching(/Pocket floor is missing, trimmed, split or ambiguous/) }));
      expect(lost.sketchPlanes?.[late.id]).toBeUndefined();
      expect(lost.sketchPlanes?.[early.id]?.origin.z).toBeCloseTo(14, 7);
    } finally { clearNativeFeatureCache(); }
  });

  it("keeps the original floor identity when reopening a roof over an existing cavity", () => {
    const { document } = machinedReferenceFixture(false);
    const blank = createSketchOnPlane("Pocket roof", { type: "offset", base: "XY", offset: { expression: "18mm", unit: "mm" } });
    const roof = addCanvasGeometry(blank, solveSketch(blank, {}), "rectangle", [{ x: 11, y: 11 }, { x: 25, y: 21 }]).sketch;
    const join = createExtrudeFeature({ name: "Cover the pocket", sketchId: roof.id,
      profileId: detectProfiles(solveSketch(roof, {})).profiles[0].id, direction: "positive", operation: "join",
      distance: { expression: "2mm", unit: "mm" }, targetBodyIds: [stockBodyId] });
    const covered = upsertFeature(upsertSketch(document, roof), join);
    const original = document.features.find(item => item.id === pocketFloorRef.featureId)!;
    const { timelineStep: _previousStep, ...settings } = original;
    const reopened = upsertFeature(covered, { ...settings, id: "roof-recut", name: "Cut the pocket roof" });
    const existing = createSketchOnPlane("Use the original floor", pocketFloorRef);
    const candidate = upsertSketch(reopened, existing);
    try {
      const check = (result: ReturnType<typeof rebuildDocument>, volume: number) => {
        expect(result.errors).toEqual([]);
        expect(result.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
        expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 5);
        expect(result.availableFaces?.filter(face => face.role === "pocketFloor").map(face => face.id)).toEqual([pocketFloorRef.stableFaceId]);
      };
      check(rebuildDocument(covered), expectedVolume() + 192);
      check(rebuildDocument(candidate), expectedVolume());
      const warm = rebuildDocument(candidate);
      check(warm, expectedVolume());
      expect(warm.metrics?.nativeFeatureCacheHits).toBeGreaterThan(0);
      expect(warm.sketchPlanes?.[existing.id]?.origin.z).toBeCloseTo(14, 7);
      const duplicate = createSketchOnPlane("Claim the roof cut floor", { type: "face", featureId: "roof-recut", stableFaceId: pocketFloorId("roof-recut") });
      const lost = rebuildDocument(upsertSketch(candidate, duplicate));
      expect(lost.errors).toContainEqual(expect.objectContaining({ source: "sketch", sourceId: duplicate.id, message: expect.stringMatching(/already existed before its cut/) }));
      expect(lost.sketchPlanes?.[duplicate.id]).toBeUndefined();
    } finally { clearNativeFeatureCache(); }
  });

  it("copies a selected component's floor owner and target independently and rebuilds the remapped sketch", () => {
    const { document } = machinedReferenceFixture();
    const source = upsertSketch(document, createSketchOnPlane("Copied floor sketch", pocketFloorRef));
    const copied = appendProject(createEmptyDocument(), source, { componentId: source.rootComponentId }).document;
    const sketch = Object.values(copied.sketches).find(item => item.name === "Copied floor sketch")!;
    const cut = copied.features.find(item => item.name === "Blind pocket")!;
    const stock = copied.features.find(item => item.name === "Stock")!;
    const copiedBody = stableBodyIdForFeature(stock.id);
    expect(copiedBody).not.toBe(stockBodyId);
    expect(sketch.plane).toEqual({ type: "face", featureId: cut.id, stableFaceId: pocketFloorId(cut.id) });
    expect(cut).toMatchObject({ operation: "cut", targetBodyIds: [copiedBody] });
    try {
      const result = rebuildDocument(copied);
      expect(result.errors).toEqual([]);
      expect(result.availableFaces).toContainEqual(expect.objectContaining({ id: pocketFloorId(cut.id), featureId: cut.id, bodyId: copiedBody }));
      expect(result.sketchPlanes?.[sketch.id]?.origin.z).toBeCloseTo(19, 7);
      expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume(), 5);
    } finally { clearNativeFeatureCache(); }
  });

  it("does not offer an entrance rim when two authored holes claim an identically redrilled native circle", () => {
    const { document } = machinedReferenceFixture(false);
    const plug = addCircleAt(createXySketch("Bore plug"), "45mm", "25mm", "3mm");
    const join = createExtrudeFeature({ name: "Fill the bore", sketchId: plug.id,
      profileId: detectProfiles(solveSketch(plug, {})).profiles[0].id, direction: "positive", operation: "join",
      distance: { expression: "20mm", unit: "mm" }, targetBodyIds: [stockBodyId] });
    const plugged = upsertFeature(upsertSketch(document, plug), join);
    const original = document.features.find(item => item.id === "machined-hole")!;
    const { timelineStep: _previousStep, ...settings } = original;
    const redrilled = upsertFeature(plugged, { ...settings, id: "redrill", name: "Redrill the bore" });
    try {
      const result = rebuildDocument(redrilled);
      expect(result.errors).toEqual([]);
      expect(result.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(expectedVolume(), 5);
      expect(result.availableHoleRims ?? []).toEqual([]);
    } finally { clearNativeFeatureCache(); }
  });
  it("cuts and joins real solids and rejects disjoint, contained, and empty results", () => {
    const shapes = [kernel.createBox(20, 10, 10), kernel.createBox(10, 10, 5)];
    try {
      const cut = kernel.cut(shapes[0], shapes[1]);
      shapes.push(cut);
      expect(volume(cut)).toBeCloseTo(1500, 6);
      const taller = kernel.createBox(10, 10, 15);
      shapes.push(taller);
      const join = kernel.fuse(shapes[0], taller);
      shapes.push(join);
      expect(volume(join)).toBeCloseTo(2500, 6);
      expect(() => kernel.fuse(shapes[0], shapes[1])).toThrow(
        /added no volume/,
      );
      expect(() => kernel.cut(shapes[1], shapes[0])).toThrow(/no solid volume/);
      const plane = {
        ...sketchPlaneTransform("XY"),
        origin: { x: 100, y: 0, z: 0 },
      };
      const disjoint = kernel.extrudeProfile(rectangle().profile, 10, plane);
      shapes.push(disjoint);
      expect(() => kernel.cut(shapes[0], disjoint)).toThrow(
        /removed no volume/,
      );
      expect(() => kernel.fuse(shapes[0], disjoint)).toThrow(/connected/);
    } finally {
      shapes.forEach((s) => kernel.disposeShape(s));
    }
  });
  it("makes real fillets and symmetric chamfers with exact volume changes", () => {
    const profile = rectangle().profile;
    const base = kernel.extrudeProfile(profile, 10);
    const edge = createExtrudeEdgeRef(
      "owner",
      "endCapPerimeter",
      profile.outerLoop.segments![0].id,
    );
    const shapes = [base];
    try {
      const chamfer = kernel.chamfer(base, [edge], 1);
      shapes.push(chamfer);
      const length = Math.hypot(
        profile.outerLoop.segments![0].end.x -
          profile.outerLoop.segments![0].start.x,
        profile.outerLoop.segments![0].end.y -
          profile.outerLoop.segments![0].start.y,
      );
      expect(volume(chamfer)).toBeCloseTo(2000 - length / 2, 5);
      const fillet = kernel.fillet(base, [edge], 1);
      shapes.push(fillet);
      expect(volume(fillet)).toBeCloseTo(2000 - length * (1 - Math.PI / 4), 5);
      const metricsBefore = getDisposableScopeMetrics();
      expect(() => kernel.fillet(base, [edge], 100)).toThrow(/fillet failed/);
      const metricsAfter = getDisposableScopeMetrics();
      expect(metricsAfter.registered - metricsBefore.registered).toBe(
        metricsAfter.disposed - metricsBefore.disposed,
      );
      expect(metricsAfter.failures).toBe(metricsBefore.failures);
      expect(() =>
        kernel.chamfer(
          base,
          [{ ...edge, sourceEntityId: "missing-entity-xyz" }],
          1,
        ),
      ).toThrow(
        "Edge reference was lost or is ambiguous. Reselect the current feature-owned perimeter.",
      );
    } finally {
      shapes.forEach((s) => kernel.disposeShape(s));
    }
  });
  it("revolves around all coplanar world axes, partial angles, and an offset sketch line", () => {
    const { profile, solved } = rectangle(10, 5);
    for (const [axis, plane] of [
      ["Y", "XY"],
      ["X", "XY"],
      ["Z", "XZ"],
    ] as const) {
      const transform = sketchPlaneTransform(plane);
      const ref = { type: "origin" as const, axis };
      const resolved = resolveRevolveAxis(
        ref,
        solved,
        transform,
        profile,
        Math.PI,
      );
      const shape = kernel.revolveProfile(
        profile,
        ref,
        Math.PI,
        transform,
        resolved,
      );
      try {
        const bounds = kernel.tessellate(shape, options).bounds;
        const expected =
          axis === "X"
            ? { min: [0, -5, 0], max: [10, 5, 5] }
            : axis === "Z"
              ? { min: [-10, 0, 0], max: [10, 10, 5] }
              : { min: [-10, 0, -10], max: [10, 5, 0] };
        for (const end of ["min", "max"] as const)
          bounds[end].forEach((value, i) =>
            expect(Math.abs(value - expected[end][i])).toBeLessThan(0.05),
          );
        expect(volume(shape)).toBeCloseTo(
          axis === "X" ? (Math.PI * 25 * 10) / 2 : (Math.PI * 100 * 5) / 2,
          4,
        );
      } finally {
        kernel.disposeShape(shape);
      }
    }
  });
  it("terminates on a finite native face and rejects extension beyond its boundary", () => {
    const profile = rectangle(10, 5).profile,
      big = rectangle(30, 20).profile;
    const owner = kernel.extrudeProfile(big, 10);
    const plane = {
      ...sketchPlaneTransform("XY"),
      origin: { x: 0, y: 0, z: 10 },
    };
    try {
      const result = kernel.extrudeToFace(
        profile,
        sketchPlaneTransform("XY"),
        owner,
        plane,
      );
      try {
        expect(volume(result)).toBeCloseTo(500, 5);
      } finally {
        kernel.disposeShape(result);
      }
      expect(() =>
        kernel.extrudeToFace(
          rectangle(40, 20).profile,
          sketchPlaneTransform("XY"),
          owner,
          plane,
        ),
      ).toThrow(/outside the finite/);
    } finally {
      kernel.disposeShape(owner);
    }
  });
  it("uses stable sketch-line axes on offset planes and rejects crossing or noncoplanar axes", () => {
    const { profile, solved } = rectangle(10, 5);
    const transform = {
      ...sketchPlaneTransform("XY"),
      origin: { x: 0, y: 0, z: 20 },
    };
    const axisSketch = {
      ...solved,
      lines: [
        ...solved.lines,
        {
          id: "axis",
          construction: true,
          start: { id: "axisA", x: -5, y: 0 },
          end: { id: "axisB", x: -5, y: 10 },
        },
      ],
    };
    const ref = {
      type: "sketchLine" as const,
      sketchId: solved.id,
      lineId: "axis",
    };
    for (const angle of [Math.PI / 4, Math.PI * 1.5, Math.PI * 2]) {
      const axis = resolveRevolveAxis(
        ref,
        axisSketch,
        transform,
        profile,
        angle,
      );
      const shape = kernel.revolveProfile(profile, ref, angle, transform, axis);
      try {
        expect(volume(shape)).toBeCloseTo(
          ((15 ** 2 - 5 ** 2) * 5 * angle) / 2,
          4,
        );
      } finally {
        kernel.disposeShape(shape);
      }
    }
    expect(() =>
      resolveRevolveAxis(
        { type: "origin", axis: "Y" },
        solved,
        transform,
        profile,
        Math.PI,
      ),
    ).toThrow(/sketch plane/);
    expect(() =>
      resolveRevolveAxis(ref, axisSketch, transform, profile, Math.PI * 3),
    ).toThrow(/360/);
    const crossing = {
      ...axisSketch,
      lines: axisSketch.lines.map((l) =>
        l.id === "axis"
          ? { ...l, start: { ...l.start, x: 5 }, end: { ...l.end, x: 5 } }
          : l,
      ),
    };
    expect(() =>
      resolveRevolveAxis(ref, crossing, transform, profile, Math.PI),
    ).toThrow(/cross/);
    expect(() =>
      resolveRevolveAxis(
        { ...ref, lineId: "missing" },
        solved,
        transform,
        profile,
        Math.PI,
      ),
    ).toThrow(/lost/);
  });
  it("terminates on sloped planar faces and rejects finite face holes", () => {
    const profile = rectangle(10, 5).profile,
      big = rectangle(30, 20).profile;
    const c = Math.SQRT1_2;
    const slope = {
      origin: { x: 0, y: 0, z: 10 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: c, z: c },
      normal: { x: 0, y: -c, z: c },
    };
    const owner = kernel.extrudeProfile(big, 5, slope);
    try {
      const result = kernel.extrudeToFace(
        profile,
        sketchPlaneTransform("XY"),
        owner,
        slope,
      );
      try {
        expect(volume(result)).toBeCloseTo(625, 4);
      } finally {
        kernel.disposeShape(result);
      }
    } finally {
      kernel.disposeShape(owner);
    }
    const hole = { id: "hole", x: 5, y: 2.5, radius: 1 };
    const withHole = {
      ...big,
      holes: [hole],
      innerLoops: [{ type: "circle" as const, entityIds: [hole.id] }],
    };
    const perforated = kernel.extrudeProfile(withHole, 10);
    try {
      expect(() =>
        kernel.extrudeToFace(profile, sketchPlaneTransform("XY"), perforated, {
          ...sketchPlaneTransform("XY"),
          origin: { x: 0, y: 0, z: 10 },
        }),
      ).toThrow(
        "Extrude profile extends outside the finite target face or crosses a face hole. Reselect a covering planar face.",
      );
    } finally {
      kernel.disposeShape(perforated);
    }
  });
  it("retains valid split solids in a stable cut result", () => {
    const base = kernel.createBox(20, 10, 10),
      tool = kernel.createBox(10, 10, 10);
    try {
      const split = kernel.cut(base, tool);
      try {
        expect(volume(split, 2)).toBeCloseTo(1000, 5);
      } finally {
        kernel.disposeShape(split);
      }
    } finally {
      kernel.disposeShape(base);
      kernel.disposeShape(tool);
    }
  });
  it("revolves analytic circular profiles into real torus geometry", () => {
    const sketch = addCircleAt(createXySketch(), "10mm", "0mm", "2mm"),
      solved = solveSketch(sketch, {}),
      profile = detectProfiles(solved).profiles[0];
    const ref = { type: "origin" as const, axis: "Y" as const },
      transform = sketchPlaneTransform("XY");
    const axis = resolveRevolveAxis(
      ref,
      solved,
      transform,
      profile,
      Math.PI * 2,
    );
    const shape = kernel.revolveProfile(
      profile,
      ref,
      Math.PI * 2,
      transform,
      axis,
    );
    try {
      expect(volume(shape)).toBeCloseTo(2 * Math.PI ** 2 * 10 * 4, 4);
    } finally {
      kernel.disposeShape(shape);
    }
  });
  it("treats circular cap perimeters with real cylindrical fillet and chamfer geometry", () => {
    const sketch = addCircleAt(createXySketch(), "0mm", "0mm", "10mm"),
      profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const base = kernel.extrudeProfile(profile, 10),
      refs = [createExtrudeEdgeRef("owner", "endCapPerimeter")];
    const shapes = [base];
    try {
      const chamfer = kernel.chamfer(base, refs, 1);
      shapes.push(chamfer);
      expect(volume(chamfer)).toBeCloseTo(
        Math.PI * 1000 - Math.PI * (10 - 1 / 3),
        4,
      );
      const fillet = kernel.fillet(base, refs, 1);
      shapes.push(fillet);
      expect(volume(fillet)).toBeLessThan(Math.PI * 1000 - 10);
      expect(volume(fillet)).toBeGreaterThan(Math.PI * 1000 - 20);
    } finally {
      shapes.forEach((s) => kernel.disposeShape(s));
    }
  });
  it("rejects a mixed sharp/smooth source-corner group rather than partially treating it", () => {
    const profile = rectangle().profile,
      segment = profile.outerLoop.segments![0];
    const middle = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };
    const split = {
      ...profile,
      outerLoop: {
        ...profile.outerLoop,
        segments: [
          { ...segment, id: "partial-a", end: middle },
          { ...segment, id: "partial-b", start: middle },
          ...profile.outerLoop.segments!.slice(1),
        ],
      },
    };
    const base = kernel.extrudeProfile(split, 10);
    try {
      expect(() =>
        kernel.fillet(
          base,
          [createExtrudeEdgeRef("owner", "profileEdge", "partial-a")],
          1,
        ),
      ).toThrow(
        "Some selected edges are not sharp treatment contours. Reselect sharp edges.",
      );
    } finally {
      kernel.disposeShape(base);
    }
  });
  it("uses analytic circle extents for sloped termination instead of outside bounding-box corners", () => {
    const circle = addCircleAt(createXySketch(), "0mm", "0mm", "1mm"),
      profile = detectProfiles(solveSketch(circle, {})).profiles[0];
    const big = addCenterRectangle(createXySketch(), "20mm", "20mm"),
      targetProfile = detectProfiles(solveSketch(big, {})).profiles[0];
    const c = 1 / Math.sqrt(3),
      q = 1 / Math.sqrt(6);
    const plane = {
      origin: { x: 0, y: 0, z: 1.6 },
      u: { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 },
      v: { x: q, y: q, z: -2 * q },
      normal: { x: c, y: c, z: c },
    };
    const owner = kernel.extrudeProfile(targetProfile, 1, plane);
    try {
      const result = kernel.extrudeToFace(
        profile,
        sketchPlaneTransform("XY"),
        owner,
        plane,
      );
      try {
        expect(volume(result)).toBeCloseTo(Math.PI * 1.6, 5);
      } finally {
        kernel.disposeShape(result);
      }
    } finally {
      kernel.disposeShape(owner);
    }
  });
  it("models convex and concave corner pairs even when their volume changes cancel", () => {
    let sketch = createXySketch();
    const pointIds: string[] = [];
    for (const [x, y] of [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ]) {
      const result = addPoint(sketch, `${x}mm`, `${y}mm`);
      sketch = result.sketch;
      pointIds.push(result.pointId);
    }
    const lineIds: string[] = [];
    for (let i = 0; i < pointIds.length; i++) {
      const result = addLine(
        sketch,
        pointIds[i],
        pointIds[(i + 1) % pointIds.length],
      );
      sketch = result.sketch;
      lineIds.push(result.lineId);
    }
    const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const base = kernel.extrudeProfile(profile, 10),
      refs = [createExtrudeEdgeRef("owner", "profileEdge", lineIds[2])];
    const shapes = [base];
    try {
      const fillet = kernel.fillet(base, refs, 1);
      shapes.push(fillet);
      expect(volume(fillet)).toBeCloseTo(3000, 4);
      expect(
        kernel.tessellate(fillet, options).geometryAssertions!.surfaceArea,
      ).toBeCloseTo(1400 - 20 * (2 - Math.PI / 2), 4);
      const chamfer = kernel.chamfer(base, refs, 1);
      shapes.push(chamfer);
      expect(volume(chamfer)).toBeCloseTo(3000, 4);
      expect(
        kernel.tessellate(chamfer, options).geometryAssertions!.surfaceArea,
      ).toBeCloseTo(1400 - 20 * (2 - Math.SQRT2), 4);
    } finally {
      shapes.forEach((shape) => kernel.disposeShape(shape));
    }
  });
  it("rejects malformed circle holes and nonpositive extrusion depth explicitly", () => {
    const outline = rectangle().sketch;
    const sketch = addCircleAt(outline, "10mm", "5mm", "2mm");
    const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    expect(profile.innerLoops).toHaveLength(1);
    expect(() => kernel.extrudeProfile({ ...profile, holes: [] }, 10)).toThrow(
      /Inner circle profile is missing/,
    );
    for (const depth of [0, -10, NaN])
      expect(() => kernel.extrudeProfile(profile, depth)).toThrow(
        /positive finite/,
      );
  });
  it("validates native curved treatment meshes and export unions including contained solids", () => {
    const circle = addCircleAt(createXySketch(), "0mm", "0mm", "5mm");
    const profile = detectProfiles(solveSketch(circle, {})).profiles[0];
    const cylinder = kernel.extrudeProfile(profile, 10);
    const shapes = [cylinder];
    try {
      expect(validateMesh(kernel.tessellate(cylinder, options)).volume).toBeCloseTo(Math.PI * 250, 0);
      const round = kernel.fillet(cylinder, [createExtrudeEdgeRef("base", "endCapPerimeter")], 1);
      shapes.push(round);
      expect(validateMesh(kernel.tessellate(round, options)).volume).toBeGreaterThan(750);
      const base = kernel.extrudeProfile(rectangle().profile, 10);
      const inner = kernel.extrudeProfile(rectangle(10, 5).profile, 10);
      shapes.push(base, inner);
      const contained = kernel.unionForExport(base, inner);
      shapes.push(contained);
      expect(validateMesh(kernel.tessellate(contained, options)).volume).toBeCloseTo(2000, 4);
      const shift = { ...sketchPlaneTransform("XY"), origin: { x: 15, y: 0, z: 0 } };
      const tool = kernel.extrudeProfile(rectangle(10, 10).profile, 10, shift);
      const union = kernel.unionForExport(base, tool);
      shapes.push(tool, union);
      expect(validateMesh(kernel.tessellate(union, options)).volume).toBeCloseTo(2500, 4);
    } finally { shapes.forEach((shape) => kernel.disposeShape(shape)); }
  });

  it("keeps cloned native boolean geometry alive after every source shape is disposed", () => {
    const owned = new Set<ReturnType<OpenCascadeKernel["cloneShape"]>>();
    const own = (shape: ReturnType<OpenCascadeKernel["cloneShape"]>) => { owned.add(shape); return shape; };
    const dispose = (shape: ReturnType<OpenCascadeKernel["cloneShape"]>) => { if (owned.delete(shape)) kernel.disposeShape(shape); };
    try {
      const base = own(kernel.extrudeProfile(rectangle(20, 10).profile, 5));
      const tool = own(kernel.extrudeProfile(rectangle(5, 5).profile, 5, { ...sketchPlaneTransform("XY"), origin: { x: 5, y: 2, z: 0 } }));
      const cut = own(kernel.cut(base, tool));
      cut.metadata = { labels: ["authored"] };
      const sourceMesh = kernel.tessellate(cut, options), sourceProof = kernel.edgeProofSignature(cut);
      const copy = own(kernel.cloneShape(cut));
      (cut.metadata.labels as string[])[0] = "changed source metadata";
      dispose(cut); dispose(tool); dispose(base);
      expect(volume(copy)).toBeCloseTo(875, 6);
      expect(kernel.tessellate(copy, options).bounds).toEqual(sourceMesh.bounds);
      expect(kernel.edgeProofSignature(copy)).toBe(sourceProof);
      expect(copy.metadata).toEqual({ labels: ["authored"] });
      expect(kernel.availableExtrudeCapEdges(copy).some(edge => edge.role === "endCapPerimeter")).toBe(true);
      const second = own(kernel.cloneShape(copy));
      dispose(second);
      expect(volume(copy)).toBeCloseTo(875, 6);
    } finally {
      for (const shape of owned) dispose(shape);
    }
  });

  it("rejects noncloneable metadata before allocating native clone or placement handles", () => {
    const base = kernel.extrudeProfile(rectangle(20, 10).profile, 5);
    try {
      base.metadata = { unsupported: () => undefined };
      const before = getDisposableScopeMetrics();
      expect(() => kernel.cloneShape(base)).toThrow();
      expect(() => kernel.placeShape(base, { translation: [1, 2, 3], rotation: [0, 0, 0] })).toThrow();
      expect(getDisposableScopeMetrics()).toEqual(before);
      expect(volume(base)).toBeCloseTo(1000, 6);
    } finally { kernel.disposeShape(base); }
  });

  it("places real solids with X then Y then Z rotation and unchanged exact native volume", () => {
    const base = kernel.extrudeProfile(rectangle(20, 10).profile, 5);
    const placement: ComponentPlacement = { translation: [7, 11, -3], rotation: [Math.PI / 2, Math.PI / 2, Math.PI / 2] };
    const placed = kernel.placeShape(base, placement);
    try {
      expect(volume(base)).toBeCloseTo(1000, 6);
      expect(volume(placed)).toBeCloseTo(1000, 6);
      const source = kernel.tessellate(base, options), output = kernel.tessellate(placed, options);
      expect(source.bounds.min).toEqual([0, 0, 0]); expect(source.bounds.max).toEqual([20, 10, 5]);
      for (const [actual, expected] of output.bounds.min.map((n, i) => [n, [7, 11, -23][i]])) expect(actual).toBeCloseTo(expected, 6);
      for (const [actual, expected] of output.bounds.max.map((n, i) => [n, [12, 21, -3][i]])) expect(actual).toBeCloseTo(expected, 6);
      expect(output.geometryAssertions!.surfaceArea).toBeCloseTo(source.geometryAssertions!.surfaceArea, 6);
      kernel.disposeShape(base);
      expect(volume(placed)).toBeCloseTo(1000, 6);
    } finally { kernel.disposeShape(placed); kernel.disposeShape(base); }
  });

  it("preserves native planar cap and edge identity after component translation and rotation", () => {
    const profile = rectangle(20, 10).profile, base = kernel.extrudeProfile(profile, 5);
    const placement: ComponentPlacement = { translation: [30, -7, 4], rotation: [0, 0, Math.PI / 2] };
    const placed = kernel.placeShape(base, placement);
    try {
      const end = { ...sketchPlaneTransform("XY"), origin: { x: 0, y: 0, z: 5 } };
      expect(() => kernel.validatePlanarFace(placed, placePlane(end, placement))).not.toThrow();
      expect(kernel.availableExtrudeCapEdges(placed)).toEqual(kernel.availableExtrudeCapEdges(base));
      const treated = kernel.chamfer(placed, [createExtrudeEdgeRef("owner", "endCapPerimeter", profile.outerLoop.segments![0].id)], 1);
      try { expect(volume(treated)).toBeLessThan(1000); } finally { kernel.disposeShape(treated); }
      expect(volume(base)).toBeCloseTo(1000, 6);
      const output = kernel.tessellate(placed, options);
      expect(output.bounds.min[0]).toBeCloseTo(20, 6); expect(output.bounds.max[0]).toBeCloseTo(30, 6);
      expect(output.bounds.min[1]).toBeCloseTo(-7, 6); expect(output.bounds.max[1]).toBeCloseTo(13, 6);
      expect(output.bounds.min[2]).toBeCloseTo(4, 6); expect(output.bounds.max[2]).toBeCloseTo(9, 6);
    } finally { kernel.disposeShape(placed); kernel.disposeShape(base); }
  });

});

describe("native modeled thread", () => {
  it("builds a maximum-length Unified inch thread in a cold rebuild and rejects an oversize request", () => {
    const sketch = addCircleAt(createXySketch("Inch shaft"), "0mm", "0mm", "0.056in");
    const stock = createExtrudeFeature({ name: "Inch shaft", sketchId: sketch.id,
      profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id, direction: "positive",
      operation: "newBody", distance: { expression: "0.4in", unit: "mm" } });
    const document = upsertFeature(upsertSketch(createEmptyDocument(), sketch), stock);
    const args = { targetBodyId: stableBodyIdForFeature(stock.id), size: "4-40", side: "external", hand: "right" } as const;
    expect(() => applyCadCommand(document, { command: "cad.feature.thread", arguments: { ...args, threadLength: "0.325in" } })).toThrow(/1–12 pitches/);
    const { document: threaded } = applyCadCommand(document, { command: "cad.feature.thread", arguments: { ...args, threadLength: "0.3in" } });
    const result = rebuildDocument(importProjectText(serializeProject(threaded)), { reuseNativeFeatures: false });
    expect(result.errors).toEqual([]);
    expect(result.meshes[0]).toMatchObject({ bodyId: args.targetBodyId, kernelOperation: "thread", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(result.meshes[0].geometryAssertions!.volume).toBeLessThan(58);
    expect(() => validateMesh(result.meshes[0])).not.toThrow();
  });

  it("rejects a lead-in that would remove the full end of a thin bore", () => {
    let sketch = addCircleAt(createXySketch("Thin sleeve"), "0mm", "0mm", "1.505mm");
    sketch = addCircleAt(sketch, "0mm", "0mm", "1.25mm");
    const stock = createExtrudeFeature({ name: "Thin sleeve", sketchId: sketch.id,
      profileId: detectProfiles(solveSketch(sketch, {})).profiles.find(profile => profile.holes.length === 1)!.id,
      direction: "positive", operation: "newBody", distance: { expression: "4mm", unit: "mm" } });
    const { document, result } = applyCadCommand(upsertFeature(upsertSketch(createEmptyDocument(), sketch), stock), {
      command: "cad.feature.thread", arguments: { targetBodyId: stableBodyIdForFeature(stock.id),
        size: "m3", side: "internal", hand: "right", threadLength: "3mm" },
    });
    const rebuild = rebuildDocument(document, { reuseNativeFeatures: false });
    expect(rebuild.success).toBe(false);
    expect(rebuild.errors).toContainEqual(expect.objectContaining({ sourceId: result.id, message: expect.stringMatching(/retained material|surrounding wall/) }));
    expect(rebuild.meshes.every(mesh => mesh.kernelOperation !== "thread")).toBe(true);
  });

  it.each([["external", "right"], ["external", "left"], ["internal", "right"], ["internal", "left"]] as const)(
    "cuts a valid %s %s-hand thread and retains its body ID",
    (side, hand) => {
      const before = createEmptyDocument();
      const shaft = addCircleAt(createXySketch("Thread stock"), "0mm", "0mm", side === "internal" ? "3mm" : "1.5mm");
      const sketch = side === "internal" ? addCircleAt(shaft, "0mm", "0mm", "1.25mm") : shaft;
      const profile = detectProfiles(solveSketch(sketch, {})).profiles.find(item => item.holes.length === (side === "internal" ? 1 : 0))!;
      const stock = createExtrudeFeature({ name: "Thread stock", sketchId: sketch.id, profileId: profile.id,
        direction: "positive", operation: "newBody", distance: { expression: "4mm", unit: "mm" } });
      const targetBodyId = stableBodyIdForFeature(stock.id);
      const base = upsertFeature(upsertSketch(before, sketch), stock);
      const { document } = applyCadCommand(base, { command: "cad.feature.thread",
        arguments: { side, hand, targetBodyId, size: "m3", threadLength: "3mm", threadOffset: "0.1mm" } });
      try {
        const rebuilt = rebuildDocument(document, { reuseNativeFeatures: false });
        expect(rebuilt.errors).toEqual([]);
        expect(rebuilt.meshes).toHaveLength(1);
        const [mesh] = rebuilt.meshes;
        expect(mesh).toMatchObject({ bodyId: targetBodyId, geometrySource: "opencascade", kernelOperation: "thread", geometryAssertions: { valid: true, solidCount: 1 } });
        const baseVolume = 4 * Math.PI * (side === "internal" ? 9 - 1.25 ** 2 : 1.5 ** 2);
        const removed = baseVolume - mesh.geometryAssertions!.volume;
        expect(removed).toBeCloseTo(side === "internal" ? 3.598 : 5.273, 2);
        expect(() => validateMesh(mesh)).not.toThrow();
      } finally { clearNativeFeatureCache(); }
    },
  );
});
