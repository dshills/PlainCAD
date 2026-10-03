import { describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  addCircleAt,
  addCornerRectangle,
  createXySketch,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import type { KernelShape } from "../cad/kernel/KernelAdapter";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { validateDocument } from "../cad/document/validate";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";

function fixture() {
  let document = createEmptyDocument("Cut transaction");
  const ids: string[] = [];
  // Coincident fallback bodies intentionally isolate orchestration, not native geometry.
  for (const name of ["First", "Second", "Third"]) {
    const sketch = addCornerRectangle(createXySketch(name), "20mm", "10mm");
    const feature = createExtrudeFeature({
      name,
      sketchId: sketch.id,
      profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
      operation: "newBody",
      direction: "positive",
      distance: { expression: "10mm", unit: "mm" },
    });
    document = upsertFeature(upsertSketch(document, sketch), feature);
    ids.push(`body:${feature.id}`);
  }
  const baseline = rebuildDocument(document);
  const sketch = addCircleAt(createXySketch("Tool"), "5mm", "5mm", "2mm");
  const cut = createExtrudeFeature({
    name: "Cut",
    sketchId: sketch.id,
    profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
    operation: "cut",
    direction: "positive",
    targetBodyIds: ids,
    termination: { type: "throughAll" },
    distance: { expression: "10mm", unit: "mm" },
  });
  document = upsertFeature(upsertSketch(document, sketch), cut);
  return { document, baseline, cut, ids };
}
describe("multi-body cut transactions", () => {
  it.each(["boolean", "tessellation", "resource budget"] as const)(
    "retains original meshes and disposes partial outputs when a later %s fails",
    (phase) => {
      const { document, baseline, cut } = fixture();
      const cutMethod = OpenCascadeKernel.prototype.cut,
        tessellate = OpenCascadeKernel.prototype.tessellate;
      const outputs: KernelShape[] = [];
      let calls = 0,
        tessellations = 0;
      const booleanSpy = vi
        .spyOn(OpenCascadeKernel.prototype, "cut")
        .mockImplementation(function (this: OpenCascadeKernel, base, tool) {
          if (phase === "boolean" && ++calls === 2)
            throw new Error("Injected second boolean failure");
          const output = cutMethod.call(this, base, tool);
          outputs.push(output);
          return output;
        });
      const tessellationSpy = vi
        .spyOn(OpenCascadeKernel.prototype, "tessellate")
        .mockImplementation(function (this: OpenCascadeKernel, shape, options) {
          if (
            phase === "tessellation" &&
            outputs.includes(shape) &&
            ++tessellations === 2
          )
            throw new Error("Injected second tessellation failure");
          const mesh = tessellate.call(this, shape, options);
          // Three individually bounded replacement meshes exceed the aggregate budget.
          return phase === "resource budget" && outputs.includes(shape)
            ? { ...mesh, indices: Array(299997).fill(0) }
            : mesh;
        });
      const disposalSpy = vi.spyOn(OpenCascadeKernel.prototype, "disposeShape");
      try {
        const result = rebuildDocument(document);
        expect(result.success).toBe(false);
        expect(
          result.errors.find((e) => e.sourceId === cut.id)?.message,
        ).toContain(
          phase === "resource budget"
            ? "total triangle resource limit"
            : `second ${phase} failure`,
        );
        expect(result.meshes).toEqual(baseline.meshes);
        expect(outputs).toHaveLength(phase === "boolean" ? 1 : 3);
        for (const output of outputs)
          expect(
            disposalSpy.mock.calls.filter(([shape]) => shape === output),
          ).toHaveLength(1);
      } finally {
        booleanSpy.mockRestore();
        tessellationSpy.mockRestore();
        disposalSpy.mockRestore();
      }
    },
  );
  it("persists explicit cut IDs, bounds scopes, diagnoses duplicates and keeps joins single-target", () => {
    const { document, cut, ids } = fixture();
    expect(validateDocument(document)).toEqual([]);
    expect(
      importProjectText(serializeProject(document)).features.find(
        (f) => f.id === cut.id,
      ),
    ).toMatchObject({ targetBodyIds: ids });
    for (const type of ["extrude", "revolve"] as const) {
      const feature =
        type === "extrude"
          ? cut
          : {
              ...cut,
              type,
              angle: { expression: "360deg", unit: "deg" },
              axis: { type: "origin" as const, axis: "Y" as const },
            };
      expect(
        validateDocument(
          upsertFeature(document, {
            ...feature,
            targetBodyIds: [ids[0], ids[0]],
          }),
        ).some((e) => /duplicate body IDs/.test(e.message)),
      ).toBe(true);
      expect(
        validateDocument(
          upsertFeature(document, { ...feature, targetBodyIds: [] }),
        ).some((e) => /at least one target/.test(e.message)),
      ).toBe(true);
      expect(
        validateDocument(
          upsertFeature(document, { ...feature, operation: "join" }),
        ).some((e) => /exactly one target/.test(e.message)),
      ).toBe(true);
      expect(
        validateDocument(
          upsertFeature(document, {
            ...feature,
            targetBodyIds: Array.from({ length: 65 }, (_, i) => `body:${i}`),
          }),
          "storage",
        ).some((e) => /target body references/.test(e.message)),
      ).toBe(true);
    }
  });
});
