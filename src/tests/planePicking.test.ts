import { withComponentPlacement } from "../cad/document/componentPlacement";
import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  addCenterRectangle,
  addCircleAt,
  createXySketch,
} from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { faceChoiceAt, sketchPlaneChoices } from "../cad/sketch/planePicking";
function fixture() {
  const sketch = addCenterRectangle(createXySketch(), "20mm", "10mm"),
    profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({
    name: "Base",
    sketchId: sketch.id,
    profileId: profile.id,
    operation: "newBody",
    distance: { expression: "10mm", unit: "mm" },
    direction: "positive",
  });
  const document = upsertFeature(
      upsertSketch(createEmptyDocument(), sketch),
      feature,
    ),
    result = rebuildDocument(document);
  return { document, feature, result };
}
describe("supported sketch-plane picking", () => {
  it("offers origin planes without claiming fallback bodies have native faces", () => {
    const { document, result } = fixture();
    expect(
      sketchPlaneChoices(document, result).map((choice) => choice.id),
    ).toEqual(["XY", "XZ", "YZ"]);
  });
  it("matches one feature-owned face by body, outward normal and plane distance", () => {
    const { document, feature, result } = fixture();
    result.meshes.forEach((mesh) => {
      mesh.geometrySource = "opencascade";
      mesh.geometryAssertions = {
        valid: true,
        volume: 2000,
        surfaceArea: 1000,
        solidCount: 1,
      };
    });
    const choices = sketchPlaneChoices(document, result),
      bodyId = `body:${feature.id}`;
    const choice = faceChoiceAt(
      choices,
      bodyId,
      { x: 0, y: 0, z: 10 },
      { x: 0, y: 0, z: 1 },
    );
    expect(choice?.label).toBe("Base — end cap");
    expect(choice?.reference).toMatchObject({
      featureId: feature.id,
      stableFaceId: `extrude:${feature.id}:endCap`,
    });
    expect(
      faceChoiceAt(
        choices,
        bodyId,
        { x: 0, y: 0, z: 10 },
        { x: 0, y: 0, z: -1 },
      ),
    ).toBeUndefined();
    expect(
      faceChoiceAt(
        [...choices, { ...choice!, id: "ambiguous" }],
        bodyId,
        { x: 0, y: 0, z: 10 },
        { x: 0, y: 0, z: 1 },
      ),
    ).toBeUndefined();
  });
  it("does not offer the original faces after a modifying cut", () => {
    const { document, feature } = fixture();
    const tool = addCircleAt(createXySketch(), "0mm", "0mm", "2mm"),
      profile = detectProfiles(solveSketch(tool, {})).profiles[0];
    const cut = createExtrudeFeature({
      name: "Cut",
      sketchId: tool.id,
      profileId: profile.id,
      operation: "cut",
      targetBodyIds: [`body:${feature.id}`],
      distance: { expression: "10mm", unit: "mm" },
      direction: "positive",
    });
    const modified = upsertFeature(upsertSketch(document, tool), cut),
      result = rebuildDocument(modified);
    expect(result.success).toBe(true);
    result.meshes.forEach((mesh) => {
      mesh.geometrySource = "opencascade";
      mesh.geometryAssertions = {
        valid: true,
        volume: 1800,
        surfaceArea: 1000,
        solidCount: 1,
      };
    });
    expect(sketchPlaneChoices(modified, result)).toHaveLength(3);
  });
  it("picks a posed cap in displayed coordinates when native face metadata is absent", () => {
    const { document, feature } = fixture();
    const posed = withComponentPlacement(document, document.rootComponentId, { translation: [30, -7, 4], rotation: [Math.PI / 2, 0, 0] });
    const result = rebuildDocument(posed);
    result.meshes.forEach(mesh => { mesh.geometrySource = "opencascade"; mesh.geometryAssertions = { valid: true, volume: 2000, surfaceArea: 1000, solidCount: 1 }; });
    const choices = sketchPlaneChoices(posed, result), bodyId = `body:${feature.id}`;
    const selected = faceChoiceAt(choices, bodyId, { x: 30, y: -17, z: 4 }, { x: 0, y: -1, z: 0 });
    expect(selected?.label).toBe("Base — end cap");
    expect(selected?.transform.origin).toEqual({ x: 30, y: -17, z: 4 });
    expect(selected?.transform.normal).toEqual({ x: 0, y: -1, z: 0 });
    expect(faceChoiceAt(choices, bodyId, { x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 1 })).toBeUndefined();
  });

});
