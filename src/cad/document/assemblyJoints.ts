import type { AssemblyJoint, CadDocument, ComponentPlacement, ValidationIssue } from "./schema";
import { IDENTITY_PLACEMENT, placementTransform, placedPoint, placedVector, unplacePlane, validComponentPlacement, withComponentPlacement } from "./componentPlacement";
import { featureComponentId } from "./components";
import type { AvailableFace, Point3 } from "../sketch/planes";
import { alignComponentGeometry, placementEuler } from "../inspection/componentAlignment";

export const MAX_ASSEMBLY_JOINTS = 32;
export function assemblyJointIssues(document: CadDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const joints = document.assemblyJoints;
  if (joints === undefined) return issues;
  if (!Array.isArray(joints) || joints.length > MAX_ASSEMBLY_JOINTS) return [{ source: "document", message: "Assembly joints must be a list of at most 32 joints." }];
  const ids = new Set<string>(), children = new Set<string>();
  for (const joint of joints) {
    if (!joint || typeof joint.id !== "string" || !joint.id || ids.has(joint.id) || typeof joint.name !== "string" || !joint.name.trim() || joint.name.length > 120 ||
      !["rigid", "hinge", "slider"].includes(joint.type) || !Object.hasOwn(document.components, joint.parentComponentId) || !Object.hasOwn(document.components, joint.childComponentId) || joint.parentComponentId === joint.childComponentId || children.has(joint.childComponentId) ||
      typeof joint.sourceFaceId !== "string" || !joint.sourceFaceId || joint.sourceFaceId.length > 320 || typeof joint.targetFaceId !== "string" || !joint.targetFaceId || joint.targetFaceId.length > 320 || !validComponentPlacement(joint.parentRest) || !validComponentPlacement(joint.childRest) || typeof joint.opposite !== "boolean" ||
      ![joint.gap, joint.value, joint.minimum, joint.maximum].every(n => typeof n === "number" && Number.isFinite(n)) || Math.abs(joint.gap) > 1e8 || joint.minimum > joint.maximum || joint.value < joint.minimum || joint.value > joint.maximum ||
      Math.max(Math.abs(joint.minimum), Math.abs(joint.maximum)) > (joint.type === "hinge" ? 360 : 1e8) || (joint.type === "rigid" && (joint.value !== 0 || joint.minimum !== 0 || joint.maximum !== 0))) {
      issues.push({ source: "document", sourceId: joint?.id, message: "Invalid assembly joint. Use distinct components, one joint per moving component, valid poses and finite motion within its limits." }); continue;
    }
    ids.add(joint.id); children.add(joint.childComponentId);
  }
  if (issues.length) return issues;
  const parents = new Map(joints.map(joint => [joint.childComponentId, joint.parentComponentId]));
  for (const joint of joints) {
    const visited = new Set<string>(); let current: string | undefined = joint.childComponentId;
    while (current && parents.has(current)) {
      if (visited.has(current)) { issues.push({ source: "document", sourceId: joint.id, message: "Assembly joint cycle. Remove a joint so each mechanism has a fixed parent." }); break; }
      visited.add(current); current = parents.get(current);
    }
  }
  if (joints.length && Object.values(document.sketches).some(sketch => sketch && Array.isArray(sketch.projections) && sketch.projections.some(projection => projection?.coordinateSpace === "world")))
    issues.push({ source: "document", message: "Assembly motion currently cannot drive world-space projected sketches. Remove those projection links before adding joints." });
  return issues;
}
const subtract = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
function rotate(p: Point3, axis: Point3, angle: number): Point3 {
  const c = Math.cos(angle), s = Math.sin(angle), k = dot(axis, p) * (1 - c), v = cross(axis, p);
  return { x: p.x * c + v.x * s + axis.x * k, y: p.y * c + v.y * s + axis.y * k, z: p.z * c + v.z * s + axis.z * k };
}
/** Joint graph resolution is transient. Saved component design poses remain editable. */
export function resolveAssemblyPlacements(document: CadDocument, faces: readonly AvailableFace[]): CadDocument {
  const issues = assemblyJointIssues(document); if (issues.length) throw new Error(issues[0].message);
  let positioned = document;
  const pending = [...(document.assemblyJoints ?? [])], resolved = new Set<string>();
  const children = new Set(pending.map(joint => joint.childComponentId));
  while (pending.length) {
    const index = pending.findIndex(joint => !children.has(joint.parentComponentId) || resolved.has(joint.parentComponentId));
    if (index < 0) throw new Error("Assembly joint cycle. Remove a joint to restore a fixed parent.");
    const [joint] = pending.splice(index, 1);
    const face = (id: string, component: string) => faces.find(item => item.id === id && document.features.some(feature => feature.id === item.featureId && featureComponentId(document, feature) === component));
    const source = face(joint.sourceFaceId, joint.childComponentId), target = face(joint.targetFaceId, joint.parentComponentId);
    if (!source || !target) throw new Error(`${joint.name}: a mating face was lost or modified. Delete and recreate the joint using current supported faces.`);
    const parent = placementTransform(positioned.components[joint.parentComponentId].placement), rest = unplacePlane(placementTransform(joint.childRest), joint.parentRest);
    const candidate: ComponentPlacement = { translation: (["x", "y", "z"] as const).map(axis => placedPoint(parent, rest.origin)[axis]) as [number, number, number], rotation: placementEuler(placedVector(parent, rest.u), placedVector(parent, rest.v), placedVector(parent, rest.normal)) };
    const destination = { ...target, transform: { origin: placedPoint(parent, target.transform.origin), normal: placedVector(parent, target.transform.normal) } };
    let placement = alignComponentGeometry(
      { id: source.id, label: source.label, componentId: joint.childComponentId, bodyId: "", kind: "face", point: source.transform.origin, direction: source.transform.normal },
      { id: target.id, label: target.label, componentId: joint.parentComponentId, bodyId: "", kind: "face", point: destination.transform.origin, direction: destination.transform.normal },
      IDENTITY_PLACEMENT, candidate, joint.gap, joint.opposite,
    );
    const frame = placementTransform(placement), normal = destination.transform.normal, length = Math.hypot(normal.x, normal.y, normal.z), pivot = destination.transform.origin;
    if (!Number.isFinite(length) || length < 1e-12) throw new Error(`${joint.name}: mating face has no valid motion axis.`);
    const axis = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
    if (joint.type === "slider") placement = { ...placement, translation: placement.translation.map((n, i) => n + [axis.x, axis.y, axis.z][i] * joint.value) as [number, number, number] };
    if (joint.type === "hinge") {
      const angle = joint.value * Math.PI / 180, origin = rotate(subtract(frame.origin, pivot), axis, angle);
      placement = { translation: [origin.x + pivot.x, origin.y + pivot.y, origin.z + pivot.z], rotation: placementEuler(rotate(frame.u, axis, angle), rotate(frame.v, axis, angle), rotate(frame.normal, axis, angle)) };
    }
    positioned = withComponentPlacement(positioned, joint.childComponentId, placement); resolved.add(joint.childComponentId);
  }
  return positioned;
}
export function withAssemblyJoint(document: CadDocument, joint: AssemblyJoint): CadDocument {
  const next = { ...document, assemblyJoints: [...(document.assemblyJoints ?? []).filter(item => item.id !== joint.id), joint] };
  const issues = assemblyJointIssues(next); if (issues.length) throw new Error(issues[0].message);
  return next;
}
export function withJointMotion(document: CadDocument, id: string, value: number): CadDocument {
  const joint = document.assemblyJoints?.find(item => item.id === id); if (!joint) throw new Error("Joint was lost. Reopen Assembly motion.");
  return withAssemblyJoint(document, { ...joint, value });
}
