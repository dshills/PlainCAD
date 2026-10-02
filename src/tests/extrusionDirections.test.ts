import { describe, expect, it } from "vitest";
import {
  extrusionSweep,
  throughAllDistance,
} from "../cad/features/extrusionSweep";
import { sketchPlaneTransform } from "../cad/sketch/planes";
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { importProjectText } from "../persistence/projectCodec";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";

describe("directional extrusions and hole intent", () => {
  it.each(["XY", "XZ", "YZ"] as const)(
    "retains the %s coordinate basis and computes positive, negative and symmetric spans",
    (plane) => {
      const transform = sketchPlaneTransform(plane);
      const negative = extrusionSweep(transform, 12, "negative"),
        symmetric = extrusionSweep(transform, 12, "symmetric");
      for (const axis of ["x", "y", "z"] as const) {
        expect(negative.origin[axis]).toBeCloseTo(-12 * transform.normal[axis]);
        expect(symmetric.origin[axis]).toBeCloseTo(-6 * transform.normal[axis]);
      }
      expect(negative.normal).toEqual(transform.normal);
      expect(negative.u).toEqual(transform.u);
      expect(negative.v).toEqual(transform.v);
    },
  );
  it("projects through-all ranges relative to the plane in each requested direction", () => {
    const transform = {
        ...sketchPlaneTransform("XY"),
        origin: { x: 0, y: 0, z: 2 },
      },
      bounds = {
        min: [-3, -4, -8] as [number, number, number],
        max: [3, 4, 12] as [number, number, number],
      };
    expect(throughAllDistance(bounds, transform, "positive")).toBeCloseTo(10);
    expect(throughAllDistance(bounds, transform, "negative")).toBeCloseTo(10);
    expect(throughAllDistance(bounds, transform, "symmetric")).toBeCloseTo(20);
    expect(
      throughAllDistance(
        { min: [0, 0, -8], max: [1, 1, -1] },
        transform,
        "positive",
      ),
    ).toBeUndefined();
    expect(() => extrusionSweep(transform, Infinity, "negative")).toThrow(
      /finite/,
    );
  });
  it("diagnoses unsupported to-face directions and empty hole center selections", () => {
    const document = createBoxTemplate(),
      base = document.features[0];
    if (base.type !== "extrude") throw new Error("Expected extrusion");
    const bad = upsertFeature(document, {
      ...base,
      direction: "negative",
      termination: {
        type: "toFace",
        faceRef: { featureId: base.id, kind: "face", transientId: "end" },
      },
    });
    expect(
      rebuildDocument(bad).errors.some((e) =>
        /requires positive extrusion/.test(e.message),
      ),
    ).toBe(true);
    const hole = {
      id: "hole",
      name: "Hole",
      type: "hole" as const,
      targetBodyId: `body:${base.id}`,
      sketchId: base.sketchId,
      centerPointIds: [],
      diameter: { expression: "3mm", unit: "mm" },
      depth: "throughAll" as const,
    };
    const result = rebuildDocument(upsertFeature(document, hole));
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) => /explicit center point/.test(e.message)),
    ).toBe(true);
    expect(result.meshes[0].bounds).toEqual(
      rebuildDocument(document).meshes[0].bounds,
    );
    expect(() =>
      importProjectText(
        JSON.stringify(
          upsertFeature(document, {
            ...hole,
            centerPointIds: Array(
              MODEL_RESOURCE_LIMITS.maxHoleCenters + 1,
            ).fill("center"),
          }),
        ),
      ),
    ).toThrow(/center resource limit/);
  });
});
