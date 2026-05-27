import { CadBody, RebuildError, RebuildResult, RebuildWarning } from "../worker/workerProtocol";
import { CadDocument, ChamferFeature, ExtrudeFeature, FilletFeature, HoleFeature, RevolveFeature } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { solveSketch } from "../sketch/SketchSolver";
import { detectProfiles } from "../sketch/profileDetection";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { validateDocument } from "../document/validate";
import { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";
import { TESSELLATION_LOD } from "../kernel/tessellationCache";
import { getDisposableScopeMetrics } from "../kernel/disposableScope";
import { sketchPlaneTransform } from "../sketch/planes";
import { planFeatureGraph, stableBodyIdForFeature } from "./featureGraph";
import { resolveSupportedEdgeRefs } from "./topologyRefs";

const kernel = new OpenCascadeKernel();

export function rebuildDocument(document: CadDocument): RebuildResult {
  const started = performance.now();
  const disposableMetricsStarted = getDisposableScopeMetrics();
  const errors: RebuildError[] = [];
  const warnings: RebuildWarning[] = [];
  let operationCount = 0;
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

  const parameterStarted = performance.now();
  const evaluated = evaluateParameters(document.parameters);
  const parameterEvaluationMs = performance.now() - parameterStarted;
  for (const error of evaluated.errors) {
    errors.push({ id: `parameter:${error.parameterName}`, source: "parameter", sourceId: error.parameterName, message: error.message });
  }

  const sketchStarted = performance.now();
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
  const sketchSolveMs = performance.now() - sketchStarted;

  const bodies: CadBody[] = [];
  const meshes = [];
  const shapesToDispose = new Set<KernelShape>();
  const runtimeBodies = new Map<string, RuntimeBody>();
  const featureStarted = performance.now();

  if (errors.length === 0) {
    for (const feature of graphPlan.orderedFeatures) {
      if (feature.suppressed) continue;
      operationCount += 1;
      if (feature.type === "revolve") {
        rebuildRevolveFeature(feature, document, profilesBySketch, evaluated.values, runtimeBodies, shapesToDispose, errors);
        continue;
      }
      if (feature.type === "hole") {
        rebuildHoleFeature(feature, document, solvedSketches, evaluated.values, runtimeBodies, shapesToDispose, errors);
        continue;
      }
      if (feature.type === "fillet") {
        rebuildEdgeTreatmentFeature(feature, document, evaluated.values, runtimeBodies, shapesToDispose, errors);
        continue;
      }
      if (feature.type === "chamfer") {
        rebuildEdgeTreatmentFeature(feature, document, evaluated.values, runtimeBodies, shapesToDispose, errors);
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
        const outputMesh = withStableBodyId(transformMeshToSketchPlane(kernel.tessellate(output.shape, TESSELLATION_LOD.default), sketch), output.bodyId);
        output.mesh = outputMesh;
        output.planeKey = feature.operation === "newBody" ? sketchPlaneKey(sketch) : output.planeKey;
        runtimeBodies.set(output.bodyId, output);
      } catch (error) {
        errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const featureRebuildMs = performance.now() - featureStarted;

  for (const body of runtimeBodies.values()) {
    if (!body.mesh) continue;
    const mesh = sanitizeTriangleMesh(body.mesh);
    if (mesh !== body.mesh) {
      warnings.push({ id: `mesh:${body.mesh.bodyId}:indices`, source: "kernel", sourceId: body.mesh.bodyId, message: "Mesh index buffer length is not divisible by 3." });
    }
    meshes.push(mesh);
    bodies.push({ id: mesh.bodyId, name: body.name, featureId: body.featureId, triangleCount: Math.floor(mesh.indices.length / 3), bounds: mesh.bounds });
  }

  let disposalFailures = 0;
  shapesToDispose.forEach((shape) => {
    try {
      kernel.disposeShape?.(shape);
    } catch {
      disposalFailures += 1;
    }
  });

  const disposableMetricsFinished = getDisposableScopeMetrics();

  return {
    documentId: document.id,
    success: errors.length === 0,
    bodies,
    meshes,
    errors,
    warnings,
    durationMs: performance.now() - started,
    metrics: {
      parameterEvaluationMs,
      sketchSolveMs,
      featureRebuildMs,
      operationCount,
      cacheSize: runtimeBodies.size,
      disposalFailures: disposalFailures + (disposableMetricsFinished.failures - disposableMetricsStarted.failures),
    },
  };
}

function rebuildRevolveFeature(
  feature: RevolveFeature,
  document: CadDocument,
  profilesBySketch: Map<string, ReturnType<typeof detectProfiles>>,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
) {
  if (feature.operation !== "newBody") {
    errors.push({ id: `feature:${feature.id}:operation`, source: "feature", sourceId: feature.id, message: `${feature.operation} revolve requires boolean support and is not enabled yet.` });
    return;
  }
  const sketch = document.sketches[feature.sketchId];
  const profile = profilesBySketch.get(feature.sketchId)?.profiles.find((item) => item.id === feature.profileId || item.alternateIds?.includes(feature.profileId));
  if (!sketch || !profile) {
    errors.push({ id: `feature:${feature.id}:profile`, source: "feature", sourceId: feature.id, message: "Revolve references a missing sketch profile." });
    return;
  }
  const angle = evaluateExpression(feature.angle.expression, { parameters });
  if (angle.error || !angle.quantity || angle.quantity.dimension !== "angle" || angle.quantity.value <= 0) {
    errors.push({ id: `feature:${feature.id}:angle`, source: "feature", sourceId: feature.id, message: angle.error ?? "Revolve angle must be a positive angle." });
    return;
  }
  const validation = validateRevolveProfile(feature, profile, angle.quantity.value);
  if (validation) {
    errors.push({ id: `feature:${feature.id}:validation`, source: "feature", sourceId: feature.id, message: validation });
    return;
  }
  try {
    const shape = kernel.revolveProfile(profile, feature.axis, angle.quantity.value);
    shapesToDispose.add(shape);
    const bodyId = stableBodyIdForFeature(feature.id);
    const mesh = withStableBodyId(transformMeshToSketchPlane(kernel.tessellate(shape, TESSELLATION_LOD.default), sketch), bodyId);
    runtimeBodies.set(bodyId, { shape, featureId: feature.id, name: feature.name, mesh, planeKey: sketchPlaneKey(sketch) });
  } catch (error) {
    errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
  }
}

function validateRevolveProfile(feature: RevolveFeature, profile: ReturnType<typeof detectProfiles>["profiles"][number], angleRadians: number): string | undefined {
  if (profile.outerLoop.type !== "polygon") return "Revolve requires a closed polygon profile.";
  if (!profile.alternateIds?.some((id) => id.endsWith(":profile:rectangle"))) return "Revolve fallback currently supports rectangular profiles only.";
  if (feature.axis.type !== "origin" || feature.axis.axis !== "Y") return "Only origin Y-axis revolve is supported in this phase.";
  if (Math.abs(angleRadians - Math.PI * 2) > 1e-6) return "Revolve fallback currently supports full 360 degree revolves only.";
  if (profile.bounds.maxX <= 0) return "Revolve profile must have non-zero radius from the axis.";
  if (profile.bounds.minX < -1e-7) return "Revolve profile must not cross the selected axis.";
  if (profile.bounds.maxY - profile.bounds.minY <= 1e-7) return "Revolve profile must have non-zero height.";
  return undefined;
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

function rebuildHoleFeature(
  feature: HoleFeature,
  document: CadDocument,
  solvedSketches: Map<string, ReturnType<typeof solveSketch>>,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
) {
  const targetBodyId = feature.targetBodyId ?? (feature.targetFeatureId ? stableBodyIdForFeature(feature.targetFeatureId) : undefined);
  const target = targetBodyId ? runtimeBodies.get(targetBodyId) : undefined;
  const sketch = document.sketches[feature.sketchId];
  const solved = solvedSketches.get(feature.sketchId);
  if (!targetBodyId || !target || !target.mesh) {
    errors.push({ id: `feature:${feature.id}:target`, source: "feature", sourceId: feature.id, message: "Hole target body was not found." });
    return;
  }
  if (!sketch || !solved) {
    errors.push({ id: `feature:${feature.id}:sketch`, source: "feature", sourceId: feature.id, message: "Hole references a missing sketch." });
    return;
  }
  if (target.planeKey !== sketchPlaneKey(sketch)) {
    errors.push({ id: `feature:${feature.id}:plane`, source: "feature", sourceId: feature.id, message: "Hole sketch plane must match the target body plane until transformed hole tools are supported." });
    return;
  }
  const diameter = evaluateExpression(feature.diameter.expression, { parameters });
  if (diameter.error || !diameter.quantity || diameter.quantity.dimension !== "length" || diameter.quantity.value <= 0) {
    errors.push({ id: `feature:${feature.id}:diameter`, source: "feature", sourceId: feature.id, message: diameter.error ?? "Hole diameter must be a positive length." });
    return;
  }
  const depth = feature.depth === "throughAll" ? projectedThroughAllDistance(target.mesh.bounds, sketch) : evaluateHoleDepth(feature.depth, parameters);
  if (!depth || depth <= 0) {
    errors.push({ id: `feature:${feature.id}:depth`, source: "feature", sourceId: feature.id, message: "Hole depth must resolve in the positive sketch normal direction." });
    return;
  }
  const tools: KernelShape[] = [];
  for (const pointId of feature.centerPointIds) {
    const point = solved.points[pointId];
    if (!point) {
      errors.push({ id: `feature:${feature.id}:center`, source: "feature", sourceId: feature.id, message: `Hole center point "${pointId}" was not found.` });
      return;
    }
    const profile = circleToolProfile(feature.id, pointId, point.x, point.y, diameter.quantity.value / 2);
    const tool = kernel.extrudeProfile(profile, depth);
    shapesToDispose.add(tool);
    tools.push(tool);
  }
  let current = target;
  try {
    const cut = kernel.cutAll(target.shape, tools);
    shapesToDispose.add(cut);
    current = { ...target, shape: cut };
  } catch (error) {
    errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
    return;
  }
  const mesh = withStableBodyId(transformMeshToSketchPlane(kernel.tessellate(current.shape, TESSELLATION_LOD.default), sketch), targetBodyId);
  runtimeBodies.set(targetBodyId, { ...current, mesh });
}

function rebuildEdgeTreatmentFeature(
  feature: FilletFeature | ChamferFeature,
  document: CadDocument,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
) {
  const resolved = resolveSupportedEdgeRefs(document, feature.targetEdgeRefs);
  if ("error" in resolved) {
    errors.push({ id: `feature:${feature.id}:edge-ref`, source: "feature", sourceId: feature.id, message: resolved.error });
    return;
  }
  const targetBodyId = stableBodyIdForFeature(resolved[0].feature.id);
  const target = runtimeBodies.get(targetBodyId);
  if (!target?.mesh) {
    errors.push({ id: `feature:${feature.id}:target`, source: "feature", sourceId: feature.id, message: "Edge treatment target body was not found." });
    return;
  }
  const expression = feature.type === "fillet" ? feature.radius : feature.distance;
  const evaluated = evaluateExpression(expression.expression, { parameters });
  if (evaluated.error || !evaluated.quantity || evaluated.quantity.dimension !== "length" || evaluated.quantity.value <= 0) {
    errors.push({ id: `feature:${feature.id}:size`, source: "feature", sourceId: feature.id, message: evaluated.error ?? `${feature.type} size must be a positive length.` });
    return;
  }
  const operation = feature.type === "fillet" ? kernel.fillet?.bind(kernel) : kernel.chamfer?.bind(kernel);
  if (!operation) {
    errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: `${feature.type} is not supported by the active kernel.` });
    return;
  }
  try {
    const shape = operation(target.shape, feature.targetEdgeRefs, evaluated.quantity.value);
    shapesToDispose.add(shape);
    const mesh = withStableBodyId(kernel.tessellate(shape, TESSELLATION_LOD.default), targetBodyId);
    runtimeBodies.set(targetBodyId, { ...target, shape, mesh, featureId: feature.id, name: feature.name });
  } catch (error) {
    errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
  }
}

function evaluateHoleDepth(depth: HoleFeature["depth"], parameters: Parameters<typeof evaluateExpression>[1]["parameters"]): number | undefined {
  if (depth === "throughAll") return undefined;
  const value = evaluateExpression(depth.expression, { parameters });
  return value.error || !value.quantity || value.quantity.dimension !== "length" ? undefined : value.quantity.value;
}

function circleToolProfile(featureId: string, pointId: string, x: number, y: number, radius: number): ReturnType<typeof detectProfiles>["profiles"][number] {
  const entityId = `${featureId}:circle:${pointId}`;
  return {
    id: `${featureId}:hole-tool:${pointId}`,
    sketchId: `${featureId}:hole-sketch`,
    outerLoop: { entityIds: [entityId], type: "circle", role: "outer", lineageIds: [entityId] },
    innerLoops: [],
    holes: [],
    bounds: { minX: x - radius, maxX: x + radius, minY: y - radius, maxY: y + radius },
    signature: `${featureId}:hole-tool`,
  };
}

interface RuntimeBody {
  shape: KernelShape;
  featureId: string;
  name: string;
  mesh?: RenderMesh;
  planeKey: string;
}

function resolveTargetBodies(
  feature: ExtrudeFeature,
  runtimeBodies: Map<string, RuntimeBody>,
  errors: RebuildError[],
): Array<{ bodyId: string } & RuntimeBody> {
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

function applyExtrudeOperation(
  activeKernel: KernelAdapter,
  feature: ExtrudeFeature,
  tool: KernelShape,
  targets: Array<{ bodyId: string } & RuntimeBody>,
  newBodyId: string,
): { bodyId: string } & RuntimeBody {
  if (feature.operation === "newBody") return { bodyId: newBodyId, shape: tool, featureId: feature.id, name: feature.name, planeKey: "" };
  const target = targets[0];
  const shape = feature.operation === "join" ? activeKernel.fuse(target.shape, tool) : activeKernel.cut(target.shape, tool);
  return { bodyId: target.bodyId, shape, featureId: target.featureId, name: target.name, planeKey: target.planeKey };
}

function withStableBodyId(mesh: RenderMesh, bodyId: string): RenderMesh {
  return { ...mesh, id: bodyId, bodyId };
}

function sanitizeTriangleMesh(mesh: RenderMesh): RenderMesh {
  const remainder = mesh.indices.length % 3;
  if (remainder === 0) return mesh;
  const end = mesh.indices.length - remainder;
  const indices = mesh.indices.slice(0, end);
  return { ...mesh, indices };
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

function sketchPlaneKey(sketch: CadDocument["sketches"][string]): string {
  const plane = sketch.plane;
  if (plane.type === "origin") return `origin:${plane.plane}`;
  if (plane.type === "offset") return `offset:${plane.base}:${plane.offset.expression}`;
  return `face:${plane.featureId}:${plane.stableFaceId}`;
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
