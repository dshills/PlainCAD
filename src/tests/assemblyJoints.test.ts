import { appendProject } from "../persistence/appendProject";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { assemblyJointIssues, resolveAssemblyPlacements, withJointMotion } from "../cad/document/assemblyJoints";
import { resolveDocumentPlanes } from "../cad/sketch/planes";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { withComponentPlacement, positionedDocument } from "../cad/document/componentPlacement";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { assemblyCollisions } from "../cad/features/assemblyCollisions";
import type { KernelAdapter, RenderMesh } from "../cad/kernel/KernelAdapter";
const load = () => importProjectText(readFileSync("src/persistence/fixtures/schema-v18.pcaddoc", "utf8"));
function placed(document = load()) { return resolveAssemblyPlacements(document, resolveDocumentPlanes(document, evaluateParameters(document.parameters).values).faces); }
describe("durable native assemblies", () => {
  it("round trips joint identities, keeps authored poses, aligns mating faces and follows a parent", () => {
    const document = load(); expect(serializeProject(importProjectText(serializeProject(document)))).toBe(serializeProject(document));
    expect(placed(document).components["second-component"].placement!.translation).toEqual([0, 0, 5]);
    expect(document.components["second-component"].placement!.translation).toEqual([0, 0, 10]);
    const moved = withComponentPlacement(document, "first-component", { translation: [20, 30, 40], rotation: [0, 0, Math.PI / 2] });
    const pose = placed(moved).components["second-component"].placement!;
    [20, 30, 45].forEach((expected, axis) => expect(pose.translation[axis]).toBeCloseTo(expected, 8)); expect(pose.rotation[2]).toBeCloseTo(Math.PI / 2);
  });
  it("accepts only a successful matching result when reading transient poses", () => {
    const document = load(), componentPlacements = { "second-component": { translation: [50, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] } };
    expect(positionedDocument(document, { componentPlacements, success: false, documentId: document.id })).toBe(document);
    expect(positionedDocument(document, { componentPlacements, success: true, documentId: "old" })).toBe(document);
    expect(positionedDocument(document, { componentPlacements, success: true, documentId: document.id }).components["second-component"].placement!.translation).toEqual([50, 0, 0]);
  });
  it("does not dereference malformed sketch entries during assembly validation", () => {
    const document = load();
    expect(() => assemblyJointIssues({ ...document, sketches: { invalid: null } } as unknown as typeof document)).not.toThrow();
    expect(() => assemblyJointIssues({ ...document, sketches: { ...document.sketches, invalid: { projections: [null] } } } as unknown as typeof document)).not.toThrow();
  });
  it("copies complete assemblies with independent joints and refuses partial extraction", () => {
    const document = load(), copy = appendProject(createEmptyDocument("Inserted assembly"), document);
    expect(copy.document.assemblyJoints).toHaveLength(1);
    expect(copy.document.assemblyJoints![0].id).not.toBe(document.assemblyJoints![0].id);
    const joint = copy.document.assemblyJoints![0]; expect(placed(copy.document).components[joint.childComponentId].placement!.translation).toEqual([0, 0, 5]);
    expect(() => appendProject(createEmptyDocument("Part"), document, { componentId: "second-component" })).toThrow(/outside the selected component/);
  });
  it("drives signed slider and hinge motion about the parent mating face", () => {
    const slider = withJointMotion(load(), "fixture-joint", -3); expect(placed(slider).components["second-component"].placement!.translation).toEqual([0, 0, 2]);
    const document = load(), joint = document.assemblyJoints![0];
    const hinge = { ...document, assemblyJoints: [{ ...joint, type: "hinge" as const, value: 90, minimum: -180, maximum: 180 }] };
    const pose = placed(hinge).components["second-component"].placement!; expect(pose.translation).toEqual([0, 0, 5]); expect(pose.rotation[2]).toBeCloseTo(Math.PI / 2);
    const rigid = { ...document, assemblyJoints: [{ ...joint, type: "rigid" as const, minimum: 0, maximum: 0 }] }; expect(placed(rigid).components["second-component"].placement!.translation).toEqual([0, 0, 5]);
  });
  it("rejects unsafe imports, cycles, duplicate parents, invalid limits and lost faces", () => {
    const document = load(), joint = document.assemblyJoints![0];
    expect(() => withJointMotion(document, joint.id, 21)).toThrow(/limits/);
    expect(assemblyJointIssues({ ...document, assemblyJoints: [joint, { ...joint, id: "duplicate" }] })[0].message).toMatch(/one joint/);
    expect(assemblyJointIssues({ ...document, assemblyJoints: [joint, { ...joint, id: "reverse", childComponentId: joint.parentComponentId, parentComponentId: joint.childComponentId }] })[0].message).toMatch(/cycle/);
    expect(() => placed({ ...document, assemblyJoints: [{ ...joint, sourceFaceId: "lost" }] })).toThrow(/lost or modified/);
    expect(() => importProjectText(JSON.stringify({ ...document, assemblyJoints: [{ ...joint, value: "3" }] }))).toThrow(/joint/);
    expect(rebuildDocument(document)).toMatchObject({ success: false, errors: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("native OpenCascade") })]) });
  });
  it("reports incomplete collision analysis without claiming verified clearance at the probe limit", () => {
    const document = load(), original = document.features[0], native = vi.fn(() => false);
    const components = { ...document.components }, features = [], bodies = new Map();
    for (let i = 0; i < 25; i++) {
      const id = `probe-${i}`; components[id] = { id, name: id }; features.push({ ...original, id, componentId: id });
      bodies.set(`body:${id}`, { shape: { id, kernelHandle: {} }, mesh: { id, bodyId: `body:${id}`, geometrySource: "opencascade", positions: [], normals: [], indices: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] } } });
    }
    expect(assemblyCollisions({ ...document, components, features }, { hasCommonVolume: native } as unknown as KernelAdapter, bodies)).toEqual({ pairs: [], complete: false });
    expect(native).toHaveBeenCalledTimes(256);
  });
  it("never labels a broad-phase overlap as a native collision and skips touching boxes", () => {
    const document = load(), native = vi.fn(() => false);
    const mesh = (id: string, min: number[], max: number[]): RenderMesh => ({ id, bodyId: id, positions: [], normals: [], indices: [], bounds: { min: min as [number, number, number], max: max as [number, number, number] }, geometrySource: "opencascade" });
    const bodies = new Map([ ["body:first-solid", { shape: { id: "a", kernelHandle: {} }, mesh: mesh("a", [0, 0, 0], [20, 10, 5]) }], ["body:second-solid", { shape: { id: "b", kernelHandle: {} }, mesh: mesh("b", [0, 0, 2], [20, 10, 7]) }] ]);
    const kernel = { hasCommonVolume: native } as unknown as KernelAdapter;
    expect(assemblyCollisions(document, kernel, bodies)).toEqual({ pairs: [], complete: true }); expect(native).toHaveBeenCalledTimes(1);
    native.mockReturnValue(true); expect(assemblyCollisions(document, kernel, bodies)).toEqual({ pairs: [["body:first-solid", "body:second-solid"]], complete: true });
    bodies.get("body:second-solid")!.mesh.bounds.min[2] = 5; native.mockClear(); expect(assemblyCollisions(document, kernel, bodies)).toEqual({ pairs: [], complete: true }); expect(native).not.toHaveBeenCalled();
  });
});
