import { CadBody, RebuildError, RebuildResult, RebuildWarning } from "../worker/workerProtocol";
import { CadDocument, ExtrudeFeature } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { solveSketch } from "../sketch/SketchSolver";
import { detectProfiles } from "../sketch/profileDetection";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { validateDocument } from "../document/validate";
import { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";
import { sketchPlaneTransform } from "../sketch/planes";
import { planFeatureGraph, stableBodyIdForFeature } from "./featureGraph";

const kernel = new OpenCascadeKernel();

export function rebuildDocument(document: CadDocument): RebuildResult {
  const started = performance.now();
  const errors: RebuildError[] = [];
  const warnings: RebuildWarning[] = [];
  const validation = validateDocument(document);
  for (const issue of validation) {
    errors.push({ id: `validation:${issue.sourceId ?? issue.message}`, source: issue.source === "document" ? "feature" : issue.source, sourceId: issue.sourceId, message: issue.message });
  }
  const graphPlan = planFeatureGraph(document);
  for (const issue of graphPlan.errors) {
    errors.push({ id: issue.id, source: issue.source, sourceId: issue.sourceId, message: issue.message });
  }
  for (const issue of graphPlan.warnings) {
    warnings.push({ id: issue.id, source: issue.source, sourceId: issue.sourceId, message: issue.message });
  }

  const evaluated = evaluateParameters(document.parameters);
  for (const error of evaluated.errors) {
    errors.push({ id: `parameter:${error.parameterName}`, source: "parameter", sourceId: error.parameterName, message: error.message });
  }

  const solvedSketches = new Map<string, ReturnType<typeof solveSketch>>();
  const profilesBySketch = new Map<string, ReturnType<typeof detectProfiles>>();
  for (const sketch of Object.values(document.sketches)) {
    const solved = solveSketch(sketch, evaluated.values);
    solvedSketches.set(sketch.id, solved);
    for (const error of solved.errors) {
      errors.push({ id: `sketch:${error.entityId ?? error.constraintId ?? sketch.id}`, source: "sketch", sourceId: error.entityId ?? sketch.id, message: error.message });
    }
    const detected = detectProfiles(solved);
    profilesBySketch.set(sketch.id, detected);
    for (const message of detected.errors) {
      warnings.push({ id: `profile:${sketch.id}:${message}`, source: "sketch", sourceId: sketch.id, message });
    }
  }

  const bodies: CadBody[] = [];
  const meshes = [];
  const shapesToDispose = new Set<KernelShape>();
  const runtimeBodies = new Map<string, { shape: KernelShape; featureId: string; name: string; mesh?: RenderMesh }>();

  if (errors.length === 0) {
    for (const feature of graphPlan.orderedFeatures) {
      if (feature.suppressed) continue;
      if (feature.type !== "extrude") {
        warnings.push({ id: `feature:${feature.id}`, source: "feature", sourceId: feature.id, message: `${feature.type} is not implemented in the MVP rebuild path.` });
        continue;
      }
      if (feature.direction !== "positive") {
        errors.push({ id: `feature:${feature.id}:direction`, source: "feature", sourceId: feature.id, message: `Extrude direction "${feature.direction}" is not supported yet.` });
        continue;
      }
      const profileResult = profilesBySketch.get(feature.sketchId);
      const profile = profileResult?.profiles.find((item) => item.id === feature.profileId || item.alternateIds?.includes(feature.profileId));
      if (!profile) {
        errors.push({ id: `feature:${feature.id}:profile`, source: "feature", sourceId: feature.id, message: `Extrude failed: profile "${feature.profileId}" was not found in sketch "${feature.sketchId}".` });
        continue;
      }
      const sketch = document.sketches[feature.sketchId];
      if (!sketch) {
        errors.push({ id: `feature:${feature.id}:sketch`, source: "feature", sourceId: feature.id, message: "Extrude references a missing sketch." });
        continue;
      }
      const errorCountBeforeTargets = errors.length;
      const targetBodies = resolveTargetBodies(feature, runtimeBodies, errors);
      if (errors.length > errorCountBeforeTargets) continue;
      const distance = resolveExtrudeDistance(feature, evaluated.values, targetBodies.map((body) => body.mesh).filter((mesh): mesh is RenderMesh => Boolean(mesh)), sketch);
      if (distance.error || distance.value <= 0) {
        errors.push({ id: `feature:${feature.id}:distance`, source: "feature", sourceId: feature.id, message: distance.error ?? "Extrude distance must be greater than zero." });
        continue;
      }
      const distanceValue = distance.value;
      try {
        const shape = kernel.extrudeProfile(profile, distanceValue);
        shapesToDispose.add(shape);
        const bodyId = stableBodyIdForFeature(feature.id);
        const output = applyExtrudeOperation(kernel, feature, shape, targetBodies, bodyId);
        shapesToDispose.add(output.shape);
        const outputMesh = withStableBodyId(transformMeshToSketchPlane(kernel.tessellate(output.shape, { linearDeflection: 0.5, angularDeflection: 0.2 }), sketch), output.bodyId);
        output.mesh = outputMesh;
        runtimeBodies.set(output.bodyId, output);
      } catch (error) {
        errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  for (const body of runtimeBodies.values()) {
    if (!body.mesh) continue;
    meshes.push(body.mesh);
    bodies.push({ id: body.mesh.bodyId, name: body.name, featureId: body.featureId, triangleCount: Math.floor(body.mesh.indices.length / 3), bounds: body.mesh.bounds });
  }

  shapesToDispose.forEach((shape) => kernel.disposeShape?.(shape));

  return {
    documentId: document.id,
    success: errors.length === 0,
    bodies,
    meshes,
    errors,
    warnings,
    durationMs: performance.now() - started,
  };
}

function resolveTargetBodies(
  feature: ExtrudeFeature,
  runtimeBodies: Map<string, { shape: KernelShape; featureId: string; name: string; mesh?: RenderMesh }>,
  errors: RebuildError[],
): Array<{ bodyId: string; shape: KernelShape; featureId: string; name: string; mesh?: RenderMesh }> {
  if (feature.operation === "newBody") return [];
  if (!feature.targetBodyIds || feature.targetBodyIds.length === 0) {
    errors.push({ id: `feature:${feature.id}:target:none`, source: "feature", sourceId: feature.id, message: `${feature.operation} extrude requires a selected target body.` });
    return [];
  }
  if (feature.targetBodyIds.length > 1) {
    errors.push({ id: `feature:${feature.id}:target:multiple`, source: "feature", sourceId: feature.id, message: `${feature.operation} extrude currently supports exactly one target body.` });
    return [];
  }
  const targets = feature.targetBodyIds.map((bodyId) => ({ bodyId, body: runtimeBodies.get(bodyId) }));
  const missing = targets.find((target) => !target.body);
  if (missing) {
    errors.push({ id: `feature:${feature.id}:target:lost`, source: "feature", sourceId: feature.id, message: `Target body "${missing.bodyId}" was not found for ${feature.operation} extrude.` });
    return [];
  }
  return targets.map((target) => ({ bodyId: target.bodyId, ...target.body! }));
}

function resolveExtrudeDistance(
  feature: ExtrudeFeature,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  targetMeshes: RenderMesh[],
  sketch: CadDocument["sketches"][string],
): { value: number; error?: string } {
  const termination = feature.termination ?? { type: "distance" as const, distance: feature.distance };
  if (termination.type === "toFace") return { value: 0, error: "Extrude to face is not supported until stable face references are available." };
  if (termination.type === "throughAll") {
    if (targetMeshes.length === 0) return { value: 0, error: "Through-all termination requires a target body." };
    const throughAllDistances = targetMeshes.map((mesh) => projectedThroughAllDistance(mesh.bounds, sketch));
    if (throughAllDistances.some((distance) => distance === undefined)) return { value: 0, error: "Through-all termination requires the target body to be in the positive extrusion direction." };
    const targetDepth = throughAllDistances.filter((distance): distance is number => distance !== undefined).reduce((max, distance) => Math.max(max, distance), 0);
    if (targetDepth > 0) return { value: targetDepth };
    return { value: 0, error: "Through-all termination could not resolve a target distance." };
  }
  const expression = termination.type === "distance" ? (termination.distance ?? feature.distance) : feature.distance;
  const distance = evaluateExpression(expression.expression, { parameters });
  if (distance.error || !distance.quantity) return { value: 0, error: distance.error ?? "Extrude distance expression is invalid." };
  return { value: distance.quantity.value };
}

function projectedThroughAllDistance(bounds: RenderMesh["bounds"], sketch: CadDocument["sketches"][string]): number | undefined {
  // Callers reject negative and symmetric extrudes before this positive-direction calculation runs.
  const transform = sketchPlaneTransform(sketch.plane);
  const normalLength = Math.hypot(transform.normal.x, transform.normal.y, transform.normal.z);
  if (normalLength <= 1e-9) return undefined;
  const normal = { x: transform.normal.x / normalLength, y: transform.normal.y / normalLength, z: transform.normal.z / normalLength };
  const corners = [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]],
  ] as const;
  const projected = corners.map((corner) => corner[0] * normal.x + corner[1] * normal.y + corner[2] * normal.z);
  const planeOffset = transform.origin.x * normal.x + transform.origin.y * normal.y + transform.origin.z * normal.z;
  const distanceFromPlane = Math.max(...projected) - planeOffset + 1e-7;
  if (distanceFromPlane > 0) return distanceFromPlane;
  return undefined;
}

function applyExtrudeOperation(
  activeKernel: KernelAdapter,
  feature: ExtrudeFeature,
  tool: KernelShape,
  targets: Array<{ bodyId: string; shape: KernelShape; featureId: string; name: string; mesh?: RenderMesh }>,
  newBodyId: string,
): { bodyId: string; shape: KernelShape; featureId: string; name: string; mesh?: RenderMesh } {
  if (feature.operation === "newBody") return { bodyId: newBodyId, shape: tool, featureId: feature.id, name: feature.name };
  const target = targets[0];
  const shape = feature.operation === "join" ? activeKernel.fuse(target.shape, tool) : activeKernel.cut(target.shape, tool);
  return { bodyId: target.bodyId, shape, featureId: target.featureId, name: target.name };
}

function withStableBodyId(mesh: RenderMesh, bodyId: string): RenderMesh {
  return { ...mesh, id: bodyId, bodyId };
}

function transformMeshToSketchPlane(mesh: RenderMesh, sketch: CadDocument["sketches"][string]): RenderMesh {
  const transform = sketchPlaneTransform(sketch.plane);
  if (isIdentityTransform(transform)) return mesh;
  if (mesh.positions.length % 3 !== 0 || mesh.normals.length % 3 !== 0) {
    throw new Error("Mesh coordinate buffers must be divisible by 3.");
  }
  const positions = new Float32Array(mesh.positions.length);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index];
    const y = mesh.positions[index + 1];
    const z = mesh.positions[index + 2];
    const worldX = transform.origin.x + transform.u.x * x + transform.v.x * y + transform.normal.x * z;
    const worldY = transform.origin.y + transform.u.y * x + transform.v.y * y + transform.normal.y * z;
    const worldZ = transform.origin.z + transform.u.z * x + transform.v.z * y + transform.normal.z * z;
    positions[index] = worldX;
    positions[index + 1] = worldY;
    positions[index + 2] = worldZ;
    min[0] = Math.min(min[0], worldX);
    min[1] = Math.min(min[1], worldY);
    min[2] = Math.min(min[2], worldZ);
    max[0] = Math.max(max[0], worldX);
    max[1] = Math.max(max[1], worldY);
    max[2] = Math.max(max[2], worldZ);
  }
  const normals = new Float32Array(mesh.normals.length);
  for (let index = 0; index < mesh.normals.length; index += 3) {
    const x = mesh.normals[index];
    const y = mesh.normals[index + 1];
    const z = mesh.normals[index + 2];
    normals[index] = transform.u.x * x + transform.v.x * y + transform.normal.x * z;
    normals[index + 1] = transform.u.y * x + transform.v.y * y + transform.normal.y * z;
    normals[index + 2] = transform.u.z * x + transform.v.z * y + transform.normal.z * z;
  }
  return { ...mesh, positions, normals, bounds: { min, max } };
}

function isIdentityTransform(transform: ReturnType<typeof sketchPlaneTransform>): boolean {
  return (
    transform.origin.x === 0 &&
    transform.origin.y === 0 &&
    transform.origin.z === 0 &&
    transform.u.x === 1 &&
    transform.u.y === 0 &&
    transform.u.z === 0 &&
    transform.v.x === 0 &&
    transform.v.y === 1 &&
    transform.v.z === 0 &&
    transform.normal.x === 0 &&
    transform.normal.y === 0 &&
    transform.normal.z === 1
  );
}
