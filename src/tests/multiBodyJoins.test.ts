import { describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import {
  upstreamBodyOwners,
  timelineDependencyErrors,
} from "../cad/document/timelineEditing";
import {
  buildDependencyGraph,
  dependencyKey,
} from "../cad/document/dependencyGraph";

function fixture() {
  let document = createEmptyDocument("Join transaction");
  const sketch = addCornerRectangle(createXySketch("Section"), "10mm", "10mm");
  document = upsertSketch(document, sketch);
  const owners = ["First", "Second", "Third"].map((name) =>
    createExtrudeFeature({
      name,
      sketchId: sketch.id,
      profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
      operation: "newBody",
      direction: "positive",
      distance: { expression: "10mm", unit: "mm" },
    }),
  );
  for (const owner of owners) document = upsertFeature(document, owner);
  const baseline = rebuildDocument(document);
  const ids = owners.map((f) => `body:${f.id}`);
  const join = {
    ...owners[0],
    id: "join",
    name: "Join",
    timelineStep: undefined,
    operation: "join" as const,
    targetBodyIds: ids,
  };
  return {
    document: upsertFeature(document, join),
    baseline,
    join,
    owners,
    ids,
  };
}

describe("multi-body join transactions", () => {
  it.each(["tessellation", "resource budget"] as const)(
    "retains every upstream body and disposes the unpublished union on %s failure",
    (phase) => {
      const { document, baseline } = fixture();
      const output = { ...baseline.meshes[0], id: "joined" };
      const joinSpy = vi
        .spyOn(OpenCascadeKernel.prototype, "joinAll")
        .mockImplementation((targets) => ({ ...targets[0], id: output.id }));
      const tessellate = OpenCascadeKernel.prototype.tessellate;
      const tessSpy = vi
        .spyOn(OpenCascadeKernel.prototype, "tessellate")
        .mockImplementation(function (this: OpenCascadeKernel, shape, options) {
          if (shape.id === output.id && phase === "tessellation")
            throw new Error("Injected union tessellation failure");
          const mesh = tessellate.call(this, shape, options);
          return shape.id === output.id
            ? { ...mesh, indices: Array(750003).fill(0) }
            : mesh;
        });
      const disposal = vi.spyOn(OpenCascadeKernel.prototype, "disposeShape");
      try {
        const result = rebuildDocument(document);
        expect(result.success).toBe(false);
        expect(result.meshes).toEqual(baseline.meshes);
        expect(
          result.errors.find((e) => e.sourceId === "join")?.message,
        ).toMatch(
          phase === "tessellation"
            ? /union tessellation failure/
            : /triangle resource limit/,
        );
        expect(
          disposal.mock.calls.filter(([shape]) => shape.id === output.id),
        ).toHaveLength(1);
      } finally {
        joinSpy.mockRestore();
        tessSpy.mockRestore();
        disposal.mockRestore();
      }
    },
  );
  it("hides absorbed bodies from new scopes, diagnoses authored references and restores choices on suppression", () => {
    const { document, join, owners, ids } = fixture();
    const consumer = {
      ...owners[0],
      id: "consumer",
      name: "Later cut",
      timelineStep: undefined,
      operation: "cut" as const,
      targetBodyIds: [ids[1]],
    };
    const later = upsertFeature(document, consumer);
    expect(upstreamBodyOwners(later, consumer, true).map((f) => f.id)).toEqual([
      owners[0].id,
    ]);
    expect(timelineDependencyErrors(later).join(" ")).toContain(
      "absorbed by Join",
    );
    const graph = buildDependencyGraph(later);
    expect(graph.bodyWriters.has(ids[1])).toBe(false);
    expect(
      graph.inputs.get(dependencyKey("feature", consumer.id)),
    ).toContainEqual(
      expect.objectContaining({
        from: dependencyKey("feature", join.id),
        reasons: expect.arrayContaining([expect.stringContaining("absorbed")]),
      }),
    );
    const restored = upsertFeature(later, { ...join, suppressed: true });
    expect(
      upstreamBodyOwners(restored, consumer, true).map((f) => f.id),
    ).toEqual(owners.map((f) => f.id));
    expect(timelineDependencyErrors(restored)).toEqual([]);
  });
});
