import { MODEL_RESOURCE_LIMITS } from "../resourceLimits";
import { assertProjectJsonShape } from "../../persistence/importSafety";
import { refreshBoundNames, validateParameterBindings } from "../parameters/expressionBindings";
import {
  CadBody,
  RebuildError,
  RebuildResult,
  RebuildWarning,
} from "../worker/workerProtocol";
import {
  CadDocument,
  ChamferFeature,
  ExtrudeFeature,
  FilletFeature,
  HoleFeature,
  RevolveFeature,
} from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { solveSketch } from "../sketch/SketchSolver";
import { detectProfiles } from "../sketch/profileDetection";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { validateDocument } from "../document/validate";
import {
  KernelAdapter,
  KernelShape,
  RenderMesh,
} from "../kernel/KernelAdapter";
import { TESSELLATION_LOD } from "../kernel/tessellationCache";
import { getDisposableScopeMetrics } from "../kernel/disposableScope";
import { resolveDocumentPlanes, SketchPlaneTransform } from "../sketch/planes";
import { planFeatureGraph, stableBodyIdForFeature } from "./featureGraph";
import { resolveRevolveAxis } from "./revolveAxis";
import { resolveSupportedEdgeRefs } from "./topologyRefs";

const kernel = new OpenCascadeKernel();
let seedDocumentId: string | undefined;
const sketchSeeds = new Map<
  string,
  { signature: string; solved: ReturnType<typeof solveSketch> }
>();

export function rebuildDocument(
  document: CadDocument,
  options: { exportUnion?: boolean } = {},
): RebuildResult {
  const started = performance.now();
  const disposableMetricsStarted = getDisposableScopeMetrics();
  const errors: RebuildError[] = [];
  const warnings: RebuildWarning[] = [];
  let operationCount = 0;
  try {
    assertProjectJsonShape(document);
  } catch (error) {
    return {
      documentId: document.id,
      success: false,
      bodies: [],
      meshes: [],
      errors: [
        {
          id: "document:limits",
          source: "feature",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      warnings: [],
      durationMs: performance.now() - started,
    };
  }
  const validation = validateDocument(document);
  if (!validation.length) validation.push(...validateParameterBindings(document, true));
  for (const issue of validation) {
    errors.push({
      id: `validation:${issue.sourceId ?? issue.message}`,
      source: issue.source === "document" ? "feature" : issue.source,
      sourceId: issue.sourceId,
      message: issue.message,
    });
  }
  if (validation.length)
    return {
      documentId: document.id,
      success: false,
      bodies: [],
      meshes: [],
      errors,
      warnings,
      durationMs: performance.now() - started,
    };
  document = refreshBoundNames(document);
  const graphPlan = planFeatureGraph(document);
  for (const issue of graphPlan.errors) {
    errors.push({
      id: issue.id,
      source: issue.source,
      sourceId: issue.sourceId,
      message: issue.message,
    });
  }
  for (const issue of graphPlan.warnings) {
    warnings.push({
      id: issue.id,
      source: issue.source,
      sourceId: issue.sourceId,
      message: issue.message,
    });
  }

  const parameterStarted = performance.now();
  const evaluated = evaluateParameters(document.parameters);
  const parameterEvaluationMs = performance.now() - parameterStarted;
  for (const error of evaluated.errors) {
    errors.push({
      id: `parameter:${error.parameterName}`,
      source: "parameter",
      sourceId: error.parameterName,
      message: error.message,
    });
  }

  if (seedDocumentId !== document.id) {
    sketchSeeds.clear();
    seedDocumentId = document.id;
  }
  for (const id of sketchSeeds.keys())
    if (!document.sketches[id]) sketchSeeds.delete(id);
  const sketchStarted = performance.now();

  const solvedSketches = new Map<string, ReturnType<typeof solveSketch>>();
  const profilesBySketch = new Map<string, ReturnType<typeof detectProfiles>>();
  for (const sketch of Object.values(document.sketches)) {
    const signature = JSON.stringify([
      sketch.solveRevision ?? 0,
      sketch.entities,
    ]);
    const previous = sketchSeeds.get(sketch.id);
    const solved = solveSketch(sketch, evaluated.values, {
      seed: previous?.signature === signature ? previous.solved : undefined,
    });
    if (!solved.errors.length)
      sketchSeeds.set(sketch.id, { signature, solved });
    solvedSketches.set(sketch.id, solved);
    for (const [index, error] of solved.errors.entries()) {
      errors.push({
        id: `sketch:${sketch.id}:${error.entityId ?? error.constraintId ?? sketch.id}:${index}`,
        source: "sketch",
        sourceId: sketch.id,
        details: { entityId: error.entityId, constraintId: error.constraintId },
        message: error.message,
      });
    }
    if (solved.errors.length) continue;
    if (sketch.solveMode !== "validate" && solved.degreesOfFreedom > 0)
      warnings.push({
        id: `sketch:${sketch.id}:dof`,
        source: "sketch",
        sourceId: sketch.id,
        message: `Underconstrained sketch: ${solved.degreesOfFreedom} degrees of freedom remain.`,
      });
    const detected = detectProfiles(solved);
    profilesBySketch.set(sketch.id, detected);
    for (const message of detected.errors) {
      warnings.push({
        id: `profile:${sketch.id}:${message}`,
        source: "sketch",
        sourceId: sketch.id,
        message,
      });
    }
  }
  const planes = resolveDocumentPlanes(
    document,
    evaluated.values,
    solvedSketches,
  );
  for (const [id, message] of planes.errors)
    errors.push({
      id: `sketch:${id}:plane`,
      source: "sketch",
      sourceId: id,
      message,
    });
  const sketchSolveMs = performance.now() - sketchStarted;

  const bodies: CadBody[] = [];
  const meshes = [];
  const shapesToDispose = new Set<KernelShape>();
  const runtimeBodies = new Map<string, RuntimeBody>();
  const featureStarted = performance.now();
  const failedBodies = new Set<string>();

  // Any sketch/parameter/validation error blocks feature execution, including unsupported planes.
  if (errors.length === 0) {
    for (const feature of graphPlan.orderedFeatures) {
      if (feature.suppressed) continue;
      // Supported edge roles belong to a new-body extrusion, so this is the
      // same stable target ID used by rebuildEdgeTreatmentFeature below.
      const affectedIds =
        feature.type === "hole"
          ? feature.targetBodyId
            ? [feature.targetBodyId]
            : feature.targetFeatureId
              ? [stableBodyIdForFeature(feature.targetFeatureId)]
              : []
          : feature.type === "fillet" || feature.type === "chamfer"
            ? feature.targetEdgeRefs.map((r) =>
                stableBodyIdForFeature(r.featureId),
              )
            : feature.operation === "newBody"
              ? [stableBodyIdForFeature(feature.id)]
              : (feature.targetBodyIds ?? []);
      const errorsBefore = errors.length;
      try {
        if (affectedIds.some((id) => id && failedBodies.has(id))) {
          errors.push({
            id: `feature:${feature.id}:upstream`,
            source: "feature",
            sourceId: feature.id,
            message:
              "An upstream operation on this body failed. Repair or suppress it before rebuilding downstream features.",
          });
          continue;
        }
        if ("sketchId" in feature) {
          const plane = document.sketches[feature.sketchId]?.plane;
          const owner =
            plane?.type === "face"
              ? plane
              : plane?.type === "offset" && typeof plane.base !== "string"
                ? plane.base
                : undefined;
          if (
            owner &&
            (!runtimeBodies.has(stableBodyIdForFeature(owner.featureId)) ||
              failedBodies.has(stableBodyIdForFeature(owner.featureId)))
          ) {
            errors.push({
              id: `feature:${feature.id}:plane-owner`,
              source: "sketch",
              sourceId: feature.sketchId,
              message:
                "Sketch plane owner failed to build. Repair the upstream feature before rebuilding this sketch.",
            });
            continue;
          }
        }
        if (
          feature.type !== "hole" &&
          feature.type !== "fillet" &&
          feature.type !== "chamfer" &&
          feature.operation === "newBody" &&
          runtimeBodies.size >= MODEL_RESOURCE_LIMITS.maxBodies
        ) {
          errors.push({
            id: `feature:${feature.id}:body-limit`,
            source: "kernel",
            sourceId: feature.id,
            message:
              "Model exceeds the body resource limit. Suppress bodies before rebuilding.",
          });
          continue;
        }
        operationCount += 1;
        if (feature.type === "revolve") {
          rebuildRevolveFeature(
            feature,
            document,
            profilesBySketch,
            solvedSketches,
            planes.transforms,
            evaluated.values,
            runtimeBodies,
            shapesToDispose,
            errors,
          );
          continue;
        }
        if (feature.type === "hole") {
          rebuildHoleFeature(
            feature,
            document,
            solvedSketches,
            planes.transforms,
            evaluated.values,
            runtimeBodies,
            shapesToDispose,
            errors,
          );
          continue;
        }
        if (feature.type === "fillet" || feature.type === "chamfer") {
          rebuildEdgeTreatmentFeature(
            feature,
            document,
            evaluated.values,
            runtimeBodies,
            shapesToDispose,
            errors,
          );
          continue;
        }
        if (feature.direction !== "positive") {
          errors.push({
            id: `feature:${feature.id}:direction`,
            source: "feature",
            sourceId: feature.id,
            message: `Extrude direction "${feature.direction}" is not supported yet.`,
          });
          continue;
        }
        const profileResult = profilesBySketch.get(feature.sketchId);
        const profile = profileResult?.profiles.find(
          (item) =>
            item.id === feature.profileId ||
            item.alternateIds?.includes(feature.profileId),
        );
        if (!profile) {
          errors.push({
            id: `feature:${feature.id}:profile`,
            source: "feature",
            sourceId: feature.id,
            message: `Extrude failed: profile "${feature.profileId}" was not found in sketch "${feature.sketchId}".`,
          });
          continue;
        }
        const sketch = document.sketches[feature.sketchId];
        if (!sketch) {
          errors.push({
            id: `feature:${feature.id}:sketch`,
            source: "feature",
            sourceId: feature.id,
            message: "Extrude references a missing sketch.",
          });
          continue;
        }
        const errorCountBeforeTargets = errors.length;
        const targetBodies = resolveTargetBodies(
          feature,
          runtimeBodies,
          errors,
        );
        if (errors.length > errorCountBeforeTargets) continue;
        const distance =
          feature.termination?.type === "toFace"
            ? undefined
            : resolveExtrudeDistance(
                feature,
                evaluated.values,
                targetBodies
                  .map((body) => body.mesh)
                  .filter((mesh): mesh is RenderMesh => Boolean(mesh)),
                planes.transforms.get(sketch.id)!,
              );
        if (distance && (distance.error || distance.value <= 0)) {
          errors.push({
            id: `feature:${feature.id}:distance`,
            source: "feature",
            sourceId: feature.id,
            message:
              distance.error ?? "Extrude distance must be greater than zero.",
          });
          continue;
        }
        try {
          let shape: KernelShape;
          if (feature.termination?.type === "toFace") {
            const ref = feature.termination.faceRef;
            const face = planes.faces.find(
              (f) =>
                f.featureId === ref.featureId &&
                f.id === (ref.stableHint ?? ref.transientId),
            );
            const owner = runtimeBodies.get(
              stableBodyIdForFeature(ref.featureId),
            );
            if (
              ref.kind !== "face" ||
              ref.repairRequired ||
              !face ||
              !owner ||
              failedBodies.has(stableBodyIdForFeature(ref.featureId))
            )
              throw new Error(
                "Extrude to face reference was lost, failed, or is not upstream. Reselect a supported feature-owned planar face.",
              );
            shape = kernel.extrudeToFace(
              profile,
              planes.transforms.get(sketch.id)!,
              owner.shape,
              face.transform,
            );
          } else {
            if (!distance)
              throw new Error("Extrude distance could not be resolved.");
            shape = kernel.extrudeProfile(
              profile,
              distance.value,
              planes.transforms.get(sketch.id),
            );
          }
          shapesToDispose.add(shape);
          const bodyId = stableBodyIdForFeature(feature.id);
          const output = applyExtrudeOperation(
            kernel,
            feature,
            shape,
            targetBodies,
            bodyId,
          );
          shapesToDispose.add(output.shape);
          const outputMesh = withStableBodyId(
            kernel.tessellate(output.shape, TESSELLATION_LOD.default),
            output.bodyId,
          );
          output.mesh = outputMesh;
          output.planeKey =
            feature.operation === "newBody"
              ? sketchPlaneKey(sketch)
              : output.planeKey;
          setRuntimeBody(runtimeBodies, output.bodyId, output);
        } catch (error) {
          errors.push({
            id: `kernel:${feature.id}`,
            source: "kernel",
            sourceId: feature.id,
            message: kernelErrorMessage(feature.type, error),
          });
        }
      } finally {
        if (errors.length > errorsBefore)
          for (const id of affectedIds) if (id) failedBodies.add(id);
      }
    }
  }
  if (options.exportUnion && !errors.length && runtimeBodies.size > 1) {
    try {
      const current = [...runtimeBodies.values()];
      let merged = current[0].shape;
      for (const body of current.slice(1)) {
        merged = kernel.unionForExport(merged, body.shape);
        shapesToDispose.add(merged);
      }
      const mesh = withStableBodyId(
        kernel.tessellate(merged, TESSELLATION_LOD.default),
        "body:export-union",
      );
      const replacement = new Map<string, RuntimeBody>();
      setRuntimeBody(replacement, mesh.bodyId, {
        shape: merged,
        mesh,
        name: document.name,
        featureId: current[0].featureId,
        planeKey: current[0].planeKey,
      });
      runtimeBodies.clear();
      for (const [id, body] of replacement) runtimeBodies.set(id, body);
    } catch (error) {
      errors.push({
        id: "export:union",
        source: "export",
        message: `Native export union failed: ${error instanceof Error ? error.message : String(error)}. Use separate STL files instead.`,
      });
    }
  }
  const featureRebuildMs = performance.now() - featureStarted;

  for (const body of runtimeBodies.values()) {
    if (!body.mesh) continue;
    const mesh = sanitizeTriangleMesh(body.mesh);
    if (mesh !== body.mesh) {
      warnings.push({
        id: `mesh:${body.mesh.bodyId}:indices`,
        source: "kernel",
        sourceId: body.mesh.bodyId,
        message: "Mesh index buffer length is not divisible by 3.",
      });
    }
    meshes.push(mesh);
    bodies.push({
      id: mesh.bodyId,
      name: body.name,
      featureId: body.featureId,
      triangleCount: Math.floor(mesh.indices.length / 3),
      bounds: mesh.bounds,
    });
  }

  if (
    meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0) >
    MODEL_RESOURCE_LIMITS.maxTriangles
  )
    errors.push({
      id: "model:triangles",
      source: "kernel",
      message:
        "Model exceeds the total triangle resource limit. Simplify or suppress bodies.",
    });
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
    solvedSketches: Object.fromEntries(solvedSketches),
    profiles: Object.fromEntries(
      [...profilesBySketch].map(([id, detected]) => [id, detected.profiles]),
    ),
    sketchPlanes: Object.fromEntries(planes.transforms),
    metrics: {
      parameterEvaluationMs,
      sketchSolveMs,
      featureRebuildMs,
      operationCount,
      cacheSize: runtimeBodies.size,
      disposalFailures:
        disposalFailures +
        (disposableMetricsFinished.failures -
          disposableMetricsStarted.failures),
    },
  };
}

function rebuildRevolveFeature(
  feature: RevolveFeature,
  document: CadDocument,
  profilesBySketch: Map<string, ReturnType<typeof detectProfiles>>,
  solvedSketches: Map<string, ReturnType<typeof solveSketch>>,
  transforms: Map<string, SketchPlaneTransform>,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
) {
  const sketch = document.sketches[feature.sketchId];
  const profile = profilesBySketch
    .get(feature.sketchId)
    ?.profiles.find(
      (item) =>
        item.id === feature.profileId ||
        item.alternateIds?.includes(feature.profileId),
    );
  if (!sketch || !profile) {
    errors.push({
      id: `feature:${feature.id}:profile`,
      source: "feature",
      sourceId: feature.id,
      message: "Revolve references a missing sketch profile.",
    });
    return;
  }
  const angle = evaluateExpression(feature.angle.expression, { parameters });
  if (
    angle.error ||
    !angle.quantity ||
    angle.quantity.dimension !== "angle" ||
    angle.quantity.value <= 0
  ) {
    errors.push({
      id: `feature:${feature.id}:angle`,
      source: "feature",
      sourceId: feature.id,
      message: angle.error ?? "Revolve angle must be a positive angle.",
    });
    return;
  }
  try {
    const transform = transforms.get(sketch.id),
      solved = solvedSketches.get(sketch.id);
    if (!transform || !solved)
      throw new Error(
        "Revolve sketch or plane could not be resolved. Repair its sketch and plane references.",
      );
    const resolvedAxis = resolveRevolveAxis(
      feature.axis,
      solved,
      transform,
      profile,
      angle.quantity.value,
    );
    const errorsBefore = errors.length;
    const targets = resolveTargetBodies(feature, runtimeBodies, errors);
    if (errors.length > errorsBefore) return;
    const shape = kernel.revolveProfile(
      profile,
      feature.axis,
      angle.quantity.value,
      transform,
      resolvedAxis,
    );
    shapesToDispose.add(shape);
    const output = applyExtrudeOperation(
      kernel,
      feature,
      shape,
      targets,
      stableBodyIdForFeature(feature.id),
    );
    shapesToDispose.add(output.shape);
    const mesh = withStableBodyId(
      kernel.tessellate(output.shape, TESSELLATION_LOD.default),
      output.bodyId,
    );
    setRuntimeBody(runtimeBodies, output.bodyId, {
      ...output,
      mesh,
      planeKey:
        feature.operation === "newBody"
          ? sketchPlaneKey(sketch)
          : output.planeKey,
    });
  } catch (error) {
    errors.push({
      id: `kernel:${feature.id}`,
      source: "kernel",
      sourceId: feature.id,
      message: kernelErrorMessage(feature.type, error),
    });
  }
}

function projectedThroughAllDistance(
  bounds: RenderMesh["bounds"],
  transform: SketchPlaneTransform,
): number | undefined {
  // Callers reject negative and symmetric extrudes before this positive-direction calculation runs.
  const normalLength = Math.hypot(
    transform.normal.x,
    transform.normal.y,
    transform.normal.z,
  );
  if (normalLength <= 1e-9) return undefined;
  const normal = {
    x: transform.normal.x / normalLength,
    y: transform.normal.y / normalLength,
    z: transform.normal.z / normalLength,
  };
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
  const projected = corners.map(
    (corner) =>
      corner[0] * normal.x + corner[1] * normal.y + corner[2] * normal.z,
  );
  const planeOffset =
    transform.origin.x * normal.x +
    transform.origin.y * normal.y +
    transform.origin.z * normal.z;
  const distanceFromPlane = Math.max(...projected) - planeOffset + 1e-7;
  if (distanceFromPlane > 0) return distanceFromPlane;
  return undefined;
}

function rebuildHoleFeature(
  feature: HoleFeature,
  document: CadDocument,
  solvedSketches: Map<string, ReturnType<typeof solveSketch>>,
  planeTransforms: Map<string, SketchPlaneTransform>,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
) {
  const targetBodyId =
    feature.targetBodyId ??
    (feature.targetFeatureId
      ? stableBodyIdForFeature(feature.targetFeatureId)
      : undefined);
  const target = targetBodyId ? runtimeBodies.get(targetBodyId) : undefined;
  const sketch = document.sketches[feature.sketchId];
  const solved = solvedSketches.get(feature.sketchId);
  if (!targetBodyId || !target || !target.mesh) {
    errors.push({
      id: `feature:${feature.id}:target`,
      source: "feature",
      sourceId: feature.id,
      message: "Hole target body was not found.",
    });
    return;
  }
  if (!sketch || !solved) {
    errors.push({
      id: `feature:${feature.id}:sketch`,
      source: "feature",
      sourceId: feature.id,
      message: "Hole references a missing sketch.",
    });
    return;
  }
  const diameter = evaluateExpression(feature.diameter.expression, {
    parameters,
  });
  if (
    diameter.error ||
    !diameter.quantity ||
    diameter.quantity.dimension !== "length" ||
    diameter.quantity.value <= 0
  ) {
    errors.push({
      id: `feature:${feature.id}:diameter`,
      source: "feature",
      sourceId: feature.id,
      message: diameter.error ?? "Hole diameter must be a positive length.",
    });
    return;
  }
  const planeTransform = planeTransforms.get(sketch.id);
  if (!planeTransform) {
    errors.push({
      id: `feature:${feature.id}:plane`,
      source: "sketch",
      sourceId: sketch.id,
      message:
        "Hole sketch plane could not be resolved. Repair its reference first.",
    });
    return;
  }
  const depth =
    feature.depth === "throughAll"
      ? projectedThroughAllDistance(target.mesh.bounds, planeTransform)
      : evaluateHoleDepth(feature.depth, parameters);
  if (!depth || depth <= 0) {
    errors.push({
      id: `feature:${feature.id}:depth`,
      source: "feature",
      sourceId: feature.id,
      message:
        "Hole depth must resolve in the positive sketch normal direction.",
    });
    return;
  }
  const tools: KernelShape[] = [];
  let current = target;
  try {
    for (const pointId of feature.centerPointIds) {
      const point = solved.points[pointId];
      if (!point) {
        errors.push({
          id: `feature:${feature.id}:center`,
          source: "feature",
          sourceId: feature.id,
          message: `Hole center point "${pointId}" was not found.`,
        });
        return;
      }
      const profile = circleToolProfile(
        feature.id,
        pointId,
        point.x,
        point.y,
        diameter.quantity.value / 2,
      );
      const tool = kernel.extrudeProfile(profile, depth, planeTransform);
      shapesToDispose.add(tool);
      tools.push(tool);
    }
    const cut = kernel.cutAll(target.shape, tools);
    shapesToDispose.add(cut);
    current = { ...target, shape: cut };
    const mesh = withStableBodyId(
      kernel.tessellate(current.shape, TESSELLATION_LOD.default),
      targetBodyId,
    );
    setRuntimeBody(runtimeBodies, targetBodyId, { ...current, mesh });
  } catch (error) {
    errors.push({
      id: `kernel:${feature.id}`,
      source: "kernel",
      sourceId: feature.id,
      message: kernelErrorMessage(feature.type, error),
    });
    return;
  }
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
    errors.push({
      id: `feature:${feature.id}:edge-ref`,
      source: "feature",
      sourceId: feature.id,
      message: resolved.error,
    });
    return;
  }
  const targetBodyId = stableBodyIdForFeature(resolved[0].feature.id);
  const target = runtimeBodies.get(targetBodyId);
  if (!target?.mesh) {
    errors.push({
      id: `feature:${feature.id}:target`,
      source: "feature",
      sourceId: feature.id,
      message: "Edge treatment target body was not found.",
    });
    return;
  }
  const expression =
    feature.type === "fillet" ? feature.radius : feature.distance;
  const evaluated = evaluateExpression(expression.expression, { parameters });
  if (
    evaluated.error ||
    !evaluated.quantity ||
    evaluated.quantity.dimension !== "length" ||
    evaluated.quantity.value <= 0
  ) {
    errors.push({
      id: `feature:${feature.id}:size`,
      source: "feature",
      sourceId: feature.id,
      message:
        evaluated.error ?? `${feature.type} size must be a positive length.`,
    });
    return;
  }
  const operation =
    feature.type === "fillet"
      ? kernel.fillet?.bind(kernel)
      : kernel.chamfer?.bind(kernel);
  if (!operation) {
    errors.push({
      id: `kernel:${feature.id}`,
      source: "kernel",
      sourceId: feature.id,
      message: `${feature.type} is not supported by the active kernel.`,
    });
    return;
  }
  try {
    const shape = operation(
      target.shape,
      feature.targetEdgeRefs,
      evaluated.quantity.value,
    );
    shapesToDispose.add(shape);
    const mesh = withStableBodyId(
      kernel.tessellate(shape, TESSELLATION_LOD.default),
      targetBodyId,
    );
    setRuntimeBody(runtimeBodies, targetBodyId, {
      ...target,
      shape,
      mesh,
      featureId: feature.id,
      name: feature.name,
    });
  } catch (error) {
    errors.push({
      id: `kernel:${feature.id}`,
      source: "kernel",
      sourceId: feature.id,
      message: kernelErrorMessage(feature.type, error),
    });
  }
}

function evaluateHoleDepth(
  depth: HoleFeature["depth"],
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
): number | undefined {
  if (depth === "throughAll") return undefined;
  const value = evaluateExpression(depth.expression, { parameters });
  return value.error || !value.quantity || value.quantity.dimension !== "length"
    ? undefined
    : value.quantity.value;
}

function circleToolProfile(
  featureId: string,
  pointId: string,
  x: number,
  y: number,
  radius: number,
): ReturnType<typeof detectProfiles>["profiles"][number] {
  const entityId = `${featureId}:circle:${pointId}`;
  return {
    id: `${featureId}:hole-tool:${pointId}`,
    sketchId: `${featureId}:hole-sketch`,
    outerLoop: {
      entityIds: [entityId],
      type: "circle",
      role: "outer",
      lineageIds: [entityId],
    },
    innerLoops: [],
    holes: [],
    bounds: {
      minX: x - radius,
      maxX: x + radius,
      minY: y - radius,
      maxY: y + radius,
    },
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

function setRuntimeBody(
  bodies: Map<string, RuntimeBody>,
  id: string,
  body: RuntimeBody,
) {
  let triangles = body.mesh ? body.mesh.indices.length / 3 : 0;
  for (const [otherId, other] of bodies)
    if (otherId !== id) triangles += (other.mesh?.indices.length ?? 0) / 3;
  if (triangles > MODEL_RESOURCE_LIMITS.maxTriangles)
    throw new Error(
      "Model exceeds the total triangle resource limit. Simplify or suppress bodies.",
    );
  bodies.set(id, body);
}

function resolveTargetBodies(
  feature: ExtrudeFeature | RevolveFeature,
  runtimeBodies: Map<string, RuntimeBody>,
  errors: RebuildError[],
): Array<{ bodyId: string } & RuntimeBody> {
  if (feature.operation === "newBody") return [];
  if (!feature.targetBodyIds || feature.targetBodyIds.length === 0) {
    errors.push({
      id: `feature:${feature.id}:target:none`,
      source: "feature",
      sourceId: feature.id,
      message: `${feature.operation} extrude requires a selected target body.`,
    });
    return [];
  }
  if (feature.targetBodyIds.length > 1) {
    errors.push({
      id: `feature:${feature.id}:target:multiple`,
      source: "feature",
      sourceId: feature.id,
      message: `${feature.operation} extrude currently supports exactly one target body.`,
    });
    return [];
  }
  const targets = feature.targetBodyIds.map((bodyId) => ({
    bodyId,
    body: runtimeBodies.get(bodyId),
  }));
  const missing = targets.find((target) => !target.body);
  if (missing) {
    errors.push({
      id: `feature:${feature.id}:target:lost`,
      source: "feature",
      sourceId: feature.id,
      message: `Target body "${missing.bodyId}" was not found for ${feature.operation} extrude.`,
    });
    return [];
  }
  return targets.map((target) => ({ bodyId: target.bodyId, ...target.body! }));
}

function resolveExtrudeDistance(
  feature: ExtrudeFeature,
  parameters: Parameters<typeof evaluateExpression>[1]["parameters"],
  targetMeshes: RenderMesh[],
  transform: SketchPlaneTransform,
): { value: number; error?: string } {
  const termination = feature.termination ?? {
    type: "distance" as const,
    distance: feature.distance,
  };
  if (termination.type === "toFace")
    throw new Error(
      "To-face termination uses native face geometry, not a scalar distance.",
    );
  if (termination.type === "throughAll") {
    if (targetMeshes.length === 0)
      return {
        value: 0,
        error: "Through-all termination requires a target body.",
      };
    const throughAllDistances = targetMeshes.map((mesh) =>
      projectedThroughAllDistance(mesh.bounds, transform),
    );
    if (throughAllDistances.some((distance) => distance === undefined))
      return {
        value: 0,
        error:
          "Through-all termination requires the target body to be in the positive extrusion direction.",
      };
    const targetDepth = throughAllDistances
      .filter((distance): distance is number => distance !== undefined)
      .reduce((max, distance) => Math.max(max, distance), 0);
    if (targetDepth > 0) return { value: targetDepth };
    return {
      value: 0,
      error: "Through-all termination could not resolve a target distance.",
    };
  }
  const expression =
    termination.type === "distance"
      ? (termination.distance ?? feature.distance)
      : feature.distance;
  const distance = evaluateExpression(expression.expression, { parameters });
  if (distance.error || !distance.quantity)
    return {
      value: 0,
      error: distance.error ?? "Extrude distance expression is invalid.",
    };
  if (distance.quantity.dimension !== "length")
    return { value: 0, error: "Extrude distance must resolve to a length." };
  return { value: distance.quantity.value };
}

function applyExtrudeOperation(
  activeKernel: KernelAdapter,
  feature: ExtrudeFeature | RevolveFeature,
  tool: KernelShape,
  targets: Array<{ bodyId: string } & RuntimeBody>,
  newBodyId: string,
): { bodyId: string } & RuntimeBody {
  if (feature.operation === "newBody")
    return {
      bodyId: newBodyId,
      shape: tool,
      featureId: feature.id,
      name: feature.name,
      planeKey: "",
    };
  const target = targets[0];
  const shape =
    feature.operation === "join"
      ? activeKernel.fuse(target.shape, tool)
      : activeKernel.cut(target.shape, tool);
  return {
    bodyId: target.bodyId,
    shape,
    featureId: target.featureId,
    name: target.name,
    planeKey: target.planeKey,
  };
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

function sketchPlaneKey(sketch: CadDocument["sketches"][string]): string {
  const plane = sketch.plane;
  if (plane.type === "origin") return `origin:${plane.plane}`;
  if (plane.type === "offset") return JSON.stringify(plane);
  return `face:${plane.featureId}:${plane.stableFaceId}`;
}

function kernelErrorMessage(type: string, error: unknown): string {
  if (error instanceof Error) return error.message;
  return `${type} failed: OpenCascade rejected the geometry (${String(error)}). Adjust the feature size, axis, or references.`;
}
