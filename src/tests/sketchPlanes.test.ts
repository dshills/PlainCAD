import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { addCenterRectangle, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { resolveDocumentPlanes, stableFaceId, sketchPointToWorld, worldPointToSketch } from "../cad/sketch/planes";
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
  it.each(["XY", "XZ", "YZ"] as const)(
    "publishes signed distance faces in %s with outward, right-handed frames",
    (plane) => {
      for (const direction of ["positive", "negative", "symmetric"] as const) {
        const sketch = addCenterRectangle(
          createSketchOnPlane("Owner", plane),
          "20mm",
          "10mm",
        );
        const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
        const feature = createExtrudeFeature({
          name: "Signed owner",
          sketchId: sketch.id,
          profileId: profile.id,
          operation: "newBody",
          distance: { expression: "10mm", unit: "mm" },
          direction,
        });
        const document = upsertFeature(
          upsertSketch(createEmptyDocument(), sketch),
          feature,
        );
        const faces = resolveDocumentPlanes(document, {}).faces;
        expect(faces).toHaveLength(6);
        const normal = sketchPointToWorld({ type: "origin", plane }, 0, 0, 1);
        const start =
          direction === "negative" ? -10 : direction === "symmetric" ? -5 : 0;
        for (const role of ["startCap", "endCap"] as const) {
          const face = faces.find(
            (f) => f.id === stableFaceId(feature.id, role),
          )!.transform;
          const distance = role === "startCap" ? start : start + 10;
          const expectedOrigin = sketchPointToWorld(
            { type: "origin", plane },
            0,
            0,
            distance,
          );
          for (const axis of ["x", "y", "z"] as const)
            expect(face.origin[axis]).toBeCloseTo(expectedOrigin[axis]);
          for (const axis of ["x", "y", "z"] as const)
            expect(face.normal[axis]).toBeCloseTo(
              normal[axis] * (role === "startCap" ? -1 : 1),
            );
          const cross = {
            x: face.u.y * face.v.z - face.u.z * face.v.y,
            y: face.u.z * face.v.x - face.u.x * face.v.z,
            z: face.u.x * face.v.y - face.u.y * face.v.x,
          };
          for (const axis of ["x", "y", "z"] as const)
            expect(cross[axis]).toBeCloseTo(face.normal[axis]);
        }
        for (const side of faces.filter((f) => f.id.includes(":side:"))) {
          const local = worldPointToSketch(
            { type: "origin", plane },
            side.transform.origin,
          );
          expect(local.z).toBeCloseTo(start);
          // Side frames begin at their oriented source segment on the shifted start cap.
          const segment = profile.outerLoop.segments?.find(
            (source) => side.id === stableFaceId(feature.id, "side", source.id),
          );
          expect(segment).toBeDefined();
          if (!segment) throw new Error("Expected side source segment");
          expect(local.x).toBeCloseTo(segment.start.x);
          expect(local.y).toBeCloseTo(segment.start.y);
          const { u, v, normal: sideNormal } = side.transform;
          expect(u.y * v.z - u.z * v.y).toBeCloseTo(sideNormal.x);
          expect(u.z * v.x - u.x * v.z).toBeCloseTo(sideNormal.y);
          expect(u.x * v.y - u.y * v.x).toBeCloseTo(sideNormal.z);
          const center = sketchPointToWorld(
            { type: "origin", plane },
            0,
            0,
            start,
          );
          const outward =
            (side.transform.origin.x - center.x) * side.transform.normal.x +
            (side.transform.origin.y - center.y) * side.transform.normal.y +
            (side.transform.origin.z - center.z) * side.transform.normal.z;
          expect(outward).toBeGreaterThan(0);
        }
        const suppressed = upsertFeature(document, {
          ...feature,
          suppressed: true,
        });
        expect(resolveDocumentPlanes(suppressed, {}).faces).toEqual([]);
      }
    },
  );

});
