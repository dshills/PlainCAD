import { rebuildDocument } from "../cad/features/rebuildGraph";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { createSketchOnPlane } from "../cad/sketch/SketchModel";
import { resolveDocumentPlanes, stableFaceId } from "../cad/sketch/planes";
import {
  currentNativeFaces,
  nativeSketchPlaneValidator,
} from "../cad/features/nativeSketchPlanes";
import type { KernelAdapter, KernelShape } from "../cad/kernel/KernelAdapter";
import type { RebuildError } from "../cad/worker/workerProtocol";

function fixture() {
  const base = createBoxTemplate(),
    owner = base.features[0];
  if (owner.type !== "extrude") throw new Error("Expected extrusion");
  const ref = {
    type: "face" as const,
    featureId: owner.id,
    stableFaceId: stableFaceId(owner.id, "endCap"),
  };
  const early = { ...createSketchOnPlane("Before cut", ref), timelineStep: 3 };
  const cut = {
    ...owner,
    id: "cut",
    name: "Modifier",
    timelineStep: 4,
    operation: "cut" as const,
    targetBodyIds: [`body:${owner.id}`],
  };
  const late = {
    ...createSketchOnPlane("After cut", {
      type: "offset",
      base: ref,
      offset: { expression: "2mm", unit: "mm" },
    }),
    timelineStep: 5,
  };
  const document = upsertSketch(
    upsertFeature(upsertSketch(base, early), cut),
    late,
  );
  const planes = resolveDocumentPlanes(
    document,
    evaluateParameters(document.parameters).values,
    undefined,
    true,
  );
  expect(planes.errors.size).toBe(0);
  return {
    document,
    planes,
    early,
    late,
    cut,
    owner,
    bodyId: `body:${owner.id}`,
  };
}
function adapter(validate: KernelAdapter["validatePlanarFace"]) {
  // Unit checks cover scheduling/diagnostics; native browser tests prove geometry.
  return { validatePlanarFace: validate } as KernelAdapter;
}
describe("native face reference validation scheduling", () => {
  it("validates earlier sketches before a later modifier and standalone/offset sketches after it", () => {
    const f = fixture(),
      errors: RebuildError[] = [],
      bodies = new Map<string, { shape: KernelShape }>();
    const validate = vi.fn();
    const check = nativeSketchPlaneValidator(
      f.document,
      f.planes,
      adapter(validate),
      bodies,
      new Set(),
      errors,
    );
    check.beforeFeature(f.owner.id);
    expect(validate).not.toHaveBeenCalled();
    const base = { id: "base", kernelHandle: {} },
      modified = { id: "modified", kernelHandle: {} };
    bodies.set(f.bodyId, { shape: base });
    check.beforeFeature(f.cut.id);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0][0]).toBe(base);
    bodies.set(f.bodyId, { shape: modified });
    check.finish();
    expect(validate).toHaveBeenCalledTimes(2);
    expect(validate.mock.calls[1][0]).toBe(modified);
    // Validate the source face at z=20, not the offset sketch plane at z=22.
    expect(validate.mock.calls[1][1].origin.z).toBe(20);
    expect(f.planes.transforms.get(f.late.id)?.origin.z).toBe(22);
    expect(errors).toEqual([]);
  });
  it("invalidates lost/ambiguous planes with sketch-linked diagnostics while preserving an earlier valid sketch", () => {
    const f = fixture(),
      errors: RebuildError[] = [],
      bodies = new Map([
        [f.bodyId, { shape: { id: "base", kernelHandle: {} } }],
      ]);
    const validate = vi.fn((shape: KernelShape) => {
      if (shape.id === "modified")
        throw new Error("Face was split; reselect its plane.");
    });
    const check = nativeSketchPlaneValidator(
      f.document,
      f.planes,
      adapter(validate),
      bodies,
      new Set(),
      errors,
    );
    check.beforeFeature(f.cut.id);
    bodies.set(f.bodyId, { shape: { id: "modified", kernelHandle: {} } });
    check.finish();
    expect(check.invalidSketchIds).toEqual(new Set([f.late.id]));
    expect(f.planes.transforms.has(f.early.id)).toBe(true);
    expect(f.planes.transforms.has(f.late.id)).toBe(false);
    expect(errors).toEqual([
      expect.objectContaining({
        source: "sketch",
        sourceId: f.late.id,
        message: expect.stringContaining("split"),
      }),
    ]);
  });
  it("publishes only native-validated surviving faces, excluding failed or absorbed bodies", () => {
    const f = fixture(),
      bodies = new Map([
        [f.bodyId, { shape: { id: "modified", kernelHandle: {} } }],
      ]);
    const validate = vi.fn((_shape, plane) => {
      if (plane.normal.z !== -1) throw new Error("Lost or ambiguous");
    });
    const retained = currentNativeFaces(
      f.planes.faces,
      adapter(validate),
      bodies,
      new Set(),
    );
    expect(retained.map((face) => face.id)).toEqual([
      stableFaceId(f.owner.id, "startCap"),
    ]);
    expect(
      currentNativeFaces(
        f.planes.faces,
        adapter(validate),
        bodies,
        new Set([f.bodyId]),
      ),
    ).toEqual([]);
    expect(
      currentNativeFaces(
        f.planes.faces,
        adapter(validate),
        new Map(),
        new Set(),
      ),
    ).toEqual([]);
    // A fallback rebuild cannot accept a modified face based on metadata alone.
    expect(
      resolveDocumentPlanes(
        f.document,
        evaluateParameters(f.document.parameters).values,
      ).errors.get(f.late.id),
    ).toMatch(/modified/);
    const fallback = rebuildDocument(f.document);
    expect(fallback.success).toBe(false);
    expect(fallback.errors).toContainEqual(
      expect.objectContaining({
        source: "sketch",
        sourceId: f.late.id,
        message: expect.stringContaining("modified"),
      }),
    );
  });
});
