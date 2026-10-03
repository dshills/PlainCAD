import { describe, expect, it, vi } from "vitest";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import type { KernelShape } from "../cad/kernel/KernelAdapter";
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature } from "../cad/document/CadDocument";
import { validateDocument } from "../cad/document/validate";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { targetBodyIds } from "../cad/document/bodyScopes";
import { faceOwnerModifiedBefore } from "../cad/sketch/planes";
import { planFeatureGraph } from "../cad/features/featureGraph";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";

const shape = (id: string): KernelShape => ({ id, kernelHandle: {} });
describe("hole scope ownership and durability", () => {
  it.each(["center", "target", "success"] as const)(
    "owns intermediate unions and partial cuts through %s paths",
    (phase) => {
      const kernel = new OpenCascadeKernel(),
        targets = [shape("body1"), shape("body2")],
        tools = [shape("center1"), shape("center2")];
      const created: KernelShape[] = [];
      const union = vi
        .spyOn(
          kernel as unknown as {
            unionSolids: (a: KernelShape, b: KernelShape) => KernelShape;
          },
          "unionSolids",
        )
        .mockImplementation((a, b) => {
          const output = shape(`${a.id}+${b.id}`);
          created.push(output);
          return output;
        });
      const cut = vi.spyOn(kernel, "cut").mockImplementation((base, tool) => {
        if (
          (phase === "center" && tool === tools[1]) ||
          (phase === "target" && base === targets[1])
        )
          throw new Error("Injected no volume");
        const output = shape(`${base.id}-${tool.id}`);
        created.push(output);
        return output;
      });
      const disposal = vi
        .spyOn(kernel, "disposeShape")
        .mockImplementation(() => {});
      try {
        let outputs: KernelShape[] = [];
        if (phase === "success") outputs = kernel.cutScope(targets, tools);
        else
          expect(() => kernel.cutScope(targets, tools)).toThrow(
            phase === "center" ? /Hole center 2/ : /Hole target 2/,
          );
        for (const output of created)
          expect(
            disposal.mock.calls.filter(([s]) => s === output),
          ).toHaveLength(outputs.includes(output) ? 0 : 1);
        for (const input of [...targets, ...tools])
          expect(disposal.mock.calls.filter(([s]) => s === input)).toHaveLength(
            0,
          );
        expect(outputs.length).toBe(phase === "success" ? 2 : 0);
      } finally {
        union.mockRestore();
        cut.mockRestore();
        disposal.mockRestore();
      }
    },
  );
  it("migrates old single IDs, honors empty/new scopes, rejects malformed arrays and diagnoses duplicated intent", () => {
    const base = createBoxTemplate();
    const hole = {
      id: "hole",
      name: "Hole",
      type: "hole" as const,
      sketchId: Object.keys(base.sketches)[0],
      centerPointIds: ["point"],
      targetBodyId: `body:${base.features[0].id}`,
      diameter: { expression: "2mm", unit: "mm" },
      depth: "throughAll" as const,
    };
    const old = { ...upsertFeature(base, hole), schemaVersion: 10 };
    const migrated = importProjectText(serializeProject(old));
    expect(targetBodyIds(migrated.features[1])).toEqual([hole.targetBodyId]);
    const scoped = upsertFeature(migrated, {
      ...hole,
      targetBodyIds: [hole.targetBodyId, "body:lost"],
    });
    expect(
      targetBodyIds(importProjectText(serializeProject(scoped)).features[1]),
    ).toEqual([hole.targetBodyId, "body:lost"]);
    expect(targetBodyIds({ ...hole, targetBodyIds: [] })).toEqual([]);
    expect(
      validateDocument(
        upsertFeature(base, { ...hole, targetBodyIds: [] }),
      ).some((e) => /at least one target/.test(e.message)),
    ).toBe(true);
    expect(
      validateDocument(
        upsertFeature(base, { ...hole, targetBodyIds: ["x", "x"] }),
      ).some((e) => /duplicate body/.test(e.message)),
    ).toBe(true);
    expect(
      validateDocument(
        upsertFeature(base, { ...hole, centerPointIds: ["point", "point"] }),
      ).some((e) => /duplicate center/.test(e.message)),
    ).toBe(true);
    for (const value of [null, "body:bad", [12], Array(65).fill("body:bad")]) {
      const raw = { ...base, features: [{ ...hole, targetBodyIds: value }] };
      for (const schemaVersion of [10, 11])
        expect(() =>
          importProjectText(JSON.stringify({ ...raw, schemaVersion })),
        ).toThrow(/Malformed hole references/);
    }
    expect(
      faceOwnerModifiedBefore(scoped, base.features[0].id, {
        timelineStep: 999,
      }),
    ).toBe(true);
  });
  it("counts multi-target hole dependencies against the deepest upstream body chain", () => {
    const base = createBoxTemplate(),
      owner = base.features[0];
    const second = { ...owner, id: "second", timelineStep: undefined };
    let document = upsertFeature(base, second);
    for (let i = 0; i < MODEL_RESOURCE_LIMITS.maxFeatureDependencyDepth; i++)
      document = upsertFeature(document, {
        id: `hole${i}`,
        name: `Hole ${i}`,
        type: "hole",
        sketchId: Object.keys(base.sketches)[0],
        centerPointIds: ["point"],
        targetBodyIds: [`body:${owner.id}`, `body:${second.id}`],
        diameter: { expression: "1mm", unit: "mm" },
        depth: "throughAll",
      });
    expect(
      planFeatureGraph(document).errors.some((e) =>
        /dependency chain/.test(e.message),
      ),
    ).toBe(true);
  });
});
