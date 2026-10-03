import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { addCenterRectangle, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { sketchPointToWorld, worldPointToSketch } from "../cad/sketch/planes";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { importProjectText } from "../persistence/importProject";

describe("sketch planes", () => {
  it("maps local sketch coordinates to origin planes and back", () => {
    expect(sketchPointToWorld({ type: "origin", plane: "XY" }, 2, 3, 4)).toEqual({ x: 2, y: 3, z: 4 });
    expect(sketchPointToWorld({ type: "origin", plane: "XZ" }, 2, 3, 4)).toEqual({ x: 2, y: -4, z: 3 });
    expect(sketchPointToWorld({ type: "origin", plane: "YZ" }, 2, 3, 4)).toEqual({ x: 4, y: 2, z: 3 });
    expect(worldPointToSketch({ type: "origin", plane: "XZ" }, { x: 2, y: -4, z: 3 })).toEqual({ x: 2, y: 3, z: 4 });
    expect(
      sketchPointToWorld(
        {
          type: "offset",
          base: "XY",
          offset: { expression: "5mm", unit: "mm" },
        },
        2,
        3,
      ),
    ).toEqual({ x: 2, y: 3, z: 5 });
  });

  it("blocks invalid or lost planes with source-linked diagnostics instead of rebuilding on an origin plane", () => {
    const sketch = addCenterRectangle(createSketchOnPlane("Unsupported", "XY"), "20mm", "10mm");
    for (const plane of [
      {
        type: "offset",
        base: "XY",
        offset: { expression: "5deg", unit: "deg" },
      },
      { type: "face", featureId: "owner", stableFaceId: "face" },
    ] as const) {
      const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
      const document = upsertFeature(upsertSketch(createEmptyDocument(), { ...sketch, plane }), createExtrudeFeature({
        name: "Blocked Extrude", sketchId: sketch.id, profileId: profile.id,
        operation: "newBody", distance: { expression: "5mm", unit: "mm" }, direction: "positive",
      }));
      const result = rebuildDocument(document);
      expect(result.success).toBe(false);
      expect(result.meshes).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          source: "sketch",
          sourceId: sketch.id,
          message: expect.stringContaining(plane.type === "offset" ? "length" : "reference lost"),
        }),
      );
    }
  });

  it("migrates legacy string planes to stable origin plane references", () => {
    const document = createEmptyDocument();
    const sketch = createSketchOnPlane("Legacy", "XZ");
    const legacyDocument = {
      ...document,
      schemaVersion: 2,
      sketches: { [sketch.id]: { ...sketch, plane: "XZ" } },
    };
    const imported = importProjectText(JSON.stringify(legacyDocument));

    expect(imported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(imported.sketches[sketch.id].plane).toEqual({ type: "origin", plane: "XZ" });
  });

  it("rebuilds extrusions on XZ and YZ origin planes", () => {
    for (const plane of ["XZ", "YZ"] as const) {
      let document = createEmptyDocument();
      const sketch = addCenterRectangle(
        createSketchOnPlane(`${plane} Sketch`, plane),
        "20mm",
        "10mm",
      );
      const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
      document = upsertSketch(document, sketch);
      const feature = createExtrudeFeature({
        name: `${plane} Extrude`,
        sketchId: sketch.id,
        profileId: profile.id,
        operation: "newBody",
        distance: { expression: "5mm", unit: "mm" },
        direction: "positive",
      });
      document = upsertFeature(document, feature);

      const result = rebuildDocument(document);

      expect(result.success).toBe(true);
      expect(result.meshes[0].bounds.max[2]).toBeGreaterThan(0);
    }
  });
});
