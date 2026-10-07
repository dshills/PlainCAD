import { describe, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { upsertSketch } from "../cad/document/CadDocument";
import { createSketchOnPlane } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { planSketchProjection, materializeSketchProjections, breakSketchProjection, deleteSketchProjection } from "../cad/sketch/sketchProjection";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { validateDocument } from "../cad/document/validate";
import { nativeProjectionValidator } from "../cad/features/nativeProjectionValidator";
import type { KernelAdapter } from "../cad/kernel/KernelAdapter";
import { deleteSketchEntities } from "../cad/sketch/entityDeletion";

function fixture() {
  const base = createBoxTemplate(), owner = base.features[0];
  if (owner.type !== "extrude") throw new Error("Expected extrusion");
  const target = createSketchOnPlane("Matching cover", { type: "offset", base: "XY", offset: { expression: "25mm", unit: "mm" } });
  const document = upsertSketch(base, target), result = rebuildDocument(document);
  // Scheduling/coordinate unit proof only. Native acceptance independently proves cap survival.
  result.availableEdges = [{ featureId: owner.id, bodyId: `body:${owner.id}`, role: "endCapPerimeter" }];
  return { document, result, target: document.sketches[target.id], owner, plan: planSketchProjection(document, target.id, owner.id, "endCapPerimeter", false, result) };
}

describe("linked complete cap sketch projections", () => {
  it("keeps generated IDs and follows upstream dimensions instead of saved copied coordinates", () => {
    const f = fixture(), document = { ...f.plan.document, parameters: { ...f.document.parameters, width: { ...f.document.parameters.width, expression: "100mm" } } };
    const parameters = evaluateParameters(document.parameters).values;
    const source = solveSketch(document.sketches[f.owner.sketchId], parameters);
    const materialized = materializeSketchProjections(document, document.sketches[f.target.id], new Map([[f.owner.sketchId, source]]), new Map([[f.owner.sketchId, detectProfiles(source)]]), parameters);
    const solved = solveSketch(materialized, parameters);
    expect(solved.errors).toEqual([]);
    expect(Math.max(...Object.values(solved.points).map((p) => p.x))).toBeCloseTo(50, 8);
    expect(Math.min(...Object.values(solved.points).map((p) => p.x))).toBeCloseTo(-50, 8);
    expect(Object.keys(materialized.entities)).toEqual(Object.keys(f.plan.document.sketches[f.target.id].entities));
    expect(materialized.constraints.some((c) => c.type === "fixed")).toBe(true);
    expect(validateDocument(f.plan.document)).toEqual([]);
    const reopened = importProjectText(serializeProject(f.plan.document));
    expect(reopened.sketches[f.target.id].projections).toEqual(f.plan.document.sketches[f.target.id].projections);
  });

  it("breaks into current ordinary editable geometry and safely deletes generated supports", () => {
    const f = fixture(), solved = solveSketch(f.plan.document.sketches[f.target.id], f.result.parameterValues ?? {});
    const broken = breakSketchProjection(f.plan.document, f.target.id, f.plan.projection.id, { ...f.result, solvedSketches: { ...f.result.solvedSketches, [f.target.id]: solved } });
    expect(broken.sketches[f.target.id].projections).toEqual([]);
    expect(broken.sketches[f.target.id].constraints).toEqual([]);
    expect(Object.keys(broken.sketches[f.target.id].entities)).toEqual(Object.keys(f.plan.document.sketches[f.target.id].entities));
    expect(solveSketch(broken.sketches[f.target.id], f.result.parameterValues ?? {}).points).toEqual(solved.points);
    const deleted = deleteSketchProjection(f.plan.document, f.target.id, f.plan.projection.id);
    expect(deleted.sketches[f.target.id].entities).toEqual({});
    expect(deleted.sketches[f.target.id].constraints).toEqual([]);
    const all = deleteSketchEntities(f.plan.document.sketches[f.target.id], Object.keys(f.plan.document.sketches[f.target.id].entities), f.plan.document);
    expect(all.projections).toEqual([]);
  });

  it("rejects tilted projection, reordered source and changed or missing authored membership", () => {
    const f = fixture();
    expect(() => planSketchProjection({ ...f.document, sketches: { ...f.document.sketches, [f.target.id]: { ...f.target, plane: { type: "origin", plane: "XZ" } } } }, f.target.id, f.owner.id, "endCapPerimeter", false, f.result)).toThrow("parallel");
    expect(() => planSketchProjection({ ...f.document, sketches: { ...f.document.sketches, [f.target.id]: { ...f.target, timelineStep: 0 } } }, f.target.id, f.owner.id, "endCapPerimeter", false, f.result)).toThrow("earlier");
    const s = f.plan.document.sketches[f.target.id], projection = s.projections![0];
    const wrong = { ...s, projections: [{ ...projection, members: projection.members.slice(1) }] };
    expect(() => materializeSketchProjections(f.plan.document, wrong, new Map(Object.entries(f.result.solvedSketches!)), new Map(Object.entries(f.result.profiles!).map(([id, profiles]) => [id, { profiles }])), f.result.parameterValues!)).toThrow("boundary changed");
  });

  it("checks surviving native boundaries at the sketch timeline and blocks lost references", () => {
    const f = fixture(), errors: Parameters<typeof nativeProjectionValidator>[4] = [];
    const kernel = { availableExtrudeCapEdges: () => [] } as unknown as KernelAdapter;
    const bodies = new Map([[`body:${f.owner.id}`, { shape: { id: "native", kernelHandle: {} } }]]);
    const validator = nativeProjectionValidator(f.plan.document, kernel, bodies, new Set(), errors, true);
    validator.finish();
    expect(validator.invalidSketchIds.has(f.target.id)).toBe(true);
    expect(errors[0]).toMatchObject({ source: "sketch", sourceId: f.target.id, message: expect.stringContaining("split or lost") });
    const fallback = rebuildDocument(f.plan.document);
    expect(fallback.success).toBe(false);
    expect(fallback.errors.some((error) => error.message.includes("native OpenCascade"))).toBe(true);
  });

  it("preserves well-typed lost owners for repair while diagnosing modeling and refusing failed break-link results", () => {
    const f = fixture(), missing = { ...f.plan.document, features: [] };
    expect(validateDocument(missing, "storage")).toEqual([]);
    expect(validateDocument(missing).some((issue) => issue.sourceId === f.target.id && issue.message.includes("owner is missing"))).toBe(true);
    expect(importProjectText(serializeProject(missing)).sketches[f.target.id].projections).toEqual(missing.sketches[f.target.id].projections);
    expect(() => breakSketchProjection(f.plan.document, f.target.id, f.plan.projection.id, { ...f.result, success: false })).toThrow("successful current");
    expect(() => breakSketchProjection(f.plan.document, f.target.id, f.plan.projection.id, { ...f.result, documentId: "another-project" })).toThrow("successful current");
  });
});
