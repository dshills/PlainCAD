import { currentNativeEdges } from "./nativeEdgeTargets";
import { NativeEdgeProofCache } from "./nativeEdgeProofCache";
import { materializeSketchProjections } from "../sketch/sketchProjection";
import { documentTimeline } from "../document/timelineOrdering";
import { nativeProjectionValidator } from "./nativeProjectionValidator";
import { currentNativeFaces, nativeSketchPlaneValidator } from "./nativeSketchPlanes";
import { absorbedBodyIds, targetBodyIds } from "../document/bodyScopes";
import { extrusionSweep, throughAllDistance } from "./extrusionSweep";
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
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import { solveSketch } from "../sketch/SketchSolver";
import { detectProfiles } from "../sketch/profileDetection";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { validateDocument } from "../document/validate";
import {
  HoleScopeError,
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
import { featurePatternTransforms, patternSource, patternToolBounds, patternBoundsMayOverlap } from "./featurePattern";
import type { FeaturePatternFeature } from "../document/schema";

const kernel = new OpenCascadeKernel();
const edgeProofCache = new NativeEdgeProofCache();
let seedDocumentId: string | undefined;
const sketchSeeds = new Map<
  string,
  { signature: string; solved: ReturnType<typeof solveSketch> }
>();

export function rebuildDocument(
  document: CadDocument,
  options: {
    exportUnion?: boolean;
    exportBodyIds?: readonly string[];
    captureTargetScopeFeatureId?: string;
  } = {},
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
  let sketchSolveMs = 0, profileDetectionMs = 0;

  const solvedSketches = new Map<string, ReturnType<typeof solveSketch>>();
  const profilesBySketch = new Map<string, ReturnType<typeof detectProfiles>>();
  for (const item of documentTimeline(document)) {
    if (item.kind !== "sketch") continue;
    let sketch = item.sketch;
    try {
      sketch = materializeSketchProjections(document, sketch, solvedSketches, profilesBySketch, evaluated.values);
      if (sketch !== item.sketch) document = { ...document, sketches: { ...document.sketches, [sketch.id]: sketch } };
    } catch (error) {
      errors.push({ id: `sketch:${sketch.id}:projection`, source: "sketch", sourceId: sketch.id, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const signature = JSON.stringify([
      sketch.solveRevision ?? 0,
      sketch.entities,
    ]);
    const previous = sketchSeeds.get(sketch.id);
    const solveStarted = performance.now();
    const solved = solveSketch(sketch, evaluated.values, {
      seed: previous?.signature === signature ? previous.solved : undefined,
    });
    sketchSolveMs += performance.now() - solveStarted;
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
    const profileStarted = performance.now();
    const detected = detectProfiles(solved);
    profileDetectionMs += performance.now() - profileStarted;
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
  const nativeReferences = OpenCascadeKernel.isInitialized() && typeof kernel.validatePlanarFace === "function";
  const planes = resolveDocumentPlanes(
    document,
    evaluated.values,
    solvedSketches,
    nativeReferences,
  );
  for (const [id, message] of planes.errors)
    errors.push({
      id: `sketch:${id}:plane`,
      source: "sketch",
      sourceId: id,
      message,
    });

  const bodies: CadBody[] = [];
  const meshes = [];
  const shapesToDispose = new Set<KernelShape>();
  const runtimeBodies = new Map<string, RuntimeBody>();
  let capturedTargetBodyIds: string[] | undefined;
  const captureTargets: ScopeCapture = (tools, targets) => {
    const hasCommon = kernel.hasCommonVolume?.bind(kernel);
    if (!hasCommon) throw new Error("Scope capture requires a native kernel.");
    capturedTargetBodyIds = targets
      .filter(target => tools.some(tool => hasCommon(target.shape, tool)))
      .map(target => target.bodyId);
  };
  const featureStarted = performance.now();
  const failedBodies = new Set<string>();
  edgeProofCache.begin(document.id, kernel);
  const nativePlanes = nativeReferences
    ? nativeSketchPlaneValidator(document, planes, kernel, runtimeBodies, failedBodies, errors)
    : undefined;
  const nativeProjections = nativeProjectionValidator(document, kernel, runtimeBodies, failedBodies, errors, nativeReferences, edgeProofCache);

  // Any sketch/parameter/validation error blocks feature execution, including unsupported planes.
  if (errors.length === 0) {
    for (const feature of graphPlan.orderedFeatures) {
      nativePlanes?.beforeFeature(feature.id);
      nativeProjections.beforeFeature(feature.id);
      if (feature.suppressed) continue;
      // Supported edge roles belong to a new-body extrusion, so this is the
      // same stable target ID used by rebuildEdgeTreatmentFeature below.
      const affectedIds = (feature.type === "extrude" || feature.type === "revolve") && feature.operation === "newBody"
        ? [stableBodyIdForFeature(feature.id)] : targetBodyIds(feature);
      const capture = options.captureTargetScopeFeatureId === feature.id ? captureTargets : undefined;
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
          if (nativeProjections.invalidSketchIds.has(feature.sketchId)) {
            errors.push({ id: `feature:${feature.id}:invalid-projection`, source: "feature", sourceId: feature.id, message: "Sketch has an invalid linked projection. Repair its cap boundary reference or remove the projection before rebuilding this feature." });
            continue;
          }
          if (nativePlanes?.invalidSketchIds.has(feature.sketchId)) {
            errors.push({ id: `feature:${feature.id}:invalid-plane`, source: "feature", sourceId: feature.id, message: "Sketch plane failed native validation. Repair its face reference before rebuilding this feature." });
            continue;
          }
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
          feature.type !== "pattern" &&
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
        if (feature.type === "pattern") {
          rebuildPatternFeature(feature, document, profilesBySketch, solvedSketches, planes.transforms, evaluated.values, runtimeBodies, shapesToDispose, errors);
          continue;
        }
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
            capture,
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
            capture,
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
        if (feature.direction !== "positive" && feature.termination?.type === "toFace") {
          errors.push({
            id: `feature:${feature.id}:direction`,
            source: "feature",
            sourceId: feature.id,
            message: "To-face termination currently requires positive extrusion. Use distance/through-all or change direction to positive.",
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
        const targetMeshes = targetBodies
          .map(body => body.mesh)
          .filter((mesh): mesh is RenderMesh => Boolean(mesh));
        const sweepMeshes = capture && feature.termination?.type === "throughAll"
          ? targetMeshes.filter(mesh => throughAllDistance(mesh.bounds, planes.transforms.get(sketch.id)!, feature.direction) !== undefined)
          : targetMeshes;
        if (capture && feature.termination?.type === "throughAll" && !sweepMeshes.length) {
          capturedTargetBodyIds = [];
          continue;
        }
        const distance = feature.termination?.type === "toFace"
          ? undefined
          : resolveExtrudeDistance(feature, evaluated.values, sweepMeshes, planes.transforms.get(sketch.id)!);
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
              extrusionSweep(planes.transforms.get(sketch.id)!, distance.value, feature.direction),
            );
          }
          shapesToDispose.add(shape);
          const bodyId = stableBodyIdForFeature(feature.id);
          if (capture) {
            capture([shape], targetBodies);
            continue;
          }
          const outputs = applyExtrudeOperation(
            kernel, feature, shape, targetBodies, bodyId, shapesToDispose,
          );
          publishOperationOutputs(
            kernel, runtimeBodies, outputs,
            feature.operation === "newBody" ? sketchPlaneKey(sketch) : undefined,
            absorbedBodyIds(feature),
          );
        } catch (error) {
          errors.push({
            id: `kernel:${feature.id}`,
            source: "kernel",
            sourceId: feature.id,
            message: kernelErrorMessage(feature.type, error),
          });
        }
      } finally {
        // Also runs for every continue above, including invalid face planes.
        if (errors.length > errorsBefore)
          for (const id of affectedIds) if (id) failedBodies.add(id);
      }
    }
    nativePlanes?.finish();
    nativeProjections.finish();
  }
  if (options.exportUnion && options.exportBodyIds && !errors.length) {
    const ids = options.exportBodyIds;
    if (!ids.length || ids.length > MODEL_RESOURCE_LIMITS.maxBodies || new Set(ids).size !== ids.length || ids.some((id) => !runtimeBodies.has(id))) {
      errors.push({ id: "export:selection", source: "export", message: "STL body selection is empty, duplicated, or no longer available. Select export bodies again." });
    } else {
      const selected = new Set(ids);
      for (const id of runtimeBodies.keys()) if (!selected.has(id)) runtimeBodies.delete(id);
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
  const availableFaces = nativeReferences ? currentNativeFaces(planes.faces, kernel, runtimeBodies, failedBodies) : undefined;
  const edgeProofStarted = performance.now();
  const availableEdges = nativeReferences ? currentNativeEdges(document, kernel, runtimeBodies, failedBodies, warnings, edgeProofCache) : undefined;
  const nativeEdgeProofMs = performance.now() - edgeProofStarted;
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
    ...(availableFaces !== undefined ? { availableFaces } : {}),
    ...(availableEdges !== undefined ? { availableEdges } : {}),
    parameterValues: evaluated.values,
    ...(capturedTargetBodyIds !== undefined ? { capturedTargetBodyIds } : {}),
    metrics: {
      parameterEvaluationMs,
      sketchSolveMs,
      profileDetectionMs,
      featureRebuildMs,
      nativeEdgeProofMs,
      nativeEdgeProofCacheHits: edgeProofCache.hits,
      nativeEdgeProofCacheMisses: edgeProofCache.misses,
      operationCount,
      cacheSize: runtimeBodies.size,
      wasmHeapCapacityBytes: kernel.getWasmHeapCapacityBytes?.(),
      shapeDisposalAttempts: shapesToDispose.size,
      shapeDisposalFailures: disposalFailures,
      scopedHandles: {
        registered: disposableMetricsFinished.registered - disposableMetricsStarted.registered,
        disposed: disposableMetricsFinished.disposed - disposableMetricsStarted.disposed,
        released: disposableMetricsFinished.released - disposableMetricsStarted.released,
        alreadyDeleted: disposableMetricsFinished.alreadyDeleted - disposableMetricsStarted.alreadyDeleted,
        failures: disposableMetricsFinished.failures - disposableMetricsStarted.failures,
      },
      disposalFailures:
        disposalFailures +
        (disposableMetricsFinished.failures -
          disposableMetricsStarted.failures),
    },
  };
}

function rebuildPatternFeature(
  feature: FeaturePatternFeature,
  document: CadDocument,
  profiles: Map<string, ReturnType<typeof detectProfiles>>,
  solvedSketches: Map<string, ReturnType<typeof solveSketch>>,
  planes: Map<string, SketchPlaneTransform>,
  parameters: Parameters<typeof evaluateExpressionRef>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  ownedShapes: Set<KernelShape>,
  errors: RebuildError[],
) {
  try {
    if (!OpenCascadeKernel.isInitialized() || !kernel.cutScope || !kernel.hasCommonVolume)
      throw new Error("Feature patterns require native OpenCascade geometry; fallback meshes cannot repeat cuts.");
    const source = patternSource(document, feature.sourceFeatureId),
      plane = planes.get(source.sketchId),
      solved = solvedSketches.get(source.sketchId);
    if (!plane || !solved || solved.errors.length) throw new Error("Pattern source sketch or plane was lost. Repair it first.");
    const targets = feature.targetBodyIds.map(bodyId => ({ bodyId, body: runtimeBodies.get(bodyId) }));
    if (!targets.length || targets.some(target => !target.body?.mesh || target.body.mesh.geometrySource !== "opencascade"))
      throw new Error("Pattern targets were lost or are not current native solids. Restore the source body scope.");
    const transforms = featurePatternTransforms(feature.pattern, plane, parameters);
    let depth: number;
    let profile: ReturnType<typeof detectProfiles>["profiles"][number];
    if (source.type === "hole") {
      const diameter = evaluateExpressionRef(source.diameter, { parameters }),
        center = solved.points[source.centerPointIds[0]];
      if (!center || diameter.error || diameter.quantity?.dimension !== "length" || diameter.quantity.value <= 0)
        throw new Error("Pattern source Hole center or diameter is invalid. Repair the source Hole.");
      profile = circleToolProfile(feature.id, source.centerPointIds[0], center.x, center.y, diameter.quantity.value / 2);
      const depths = source.depth === "throughAll"
        ? targets.map(target => throughAllDistance(target.body!.mesh!.bounds, plane, source.direction ?? "positive"))
        : [evaluateHoleDepth(source.depth, parameters)];
      if (depths.some(value => value === undefined || value <= 0)) throw new Error("Pattern source Hole depth cannot reach the target bodies.");
      depth = Math.max(...depths as number[]);
    } else {
      const found = profiles.get(source.sketchId)?.profiles.find(item => item.id === source.profileId || item.alternateIds?.includes(source.profileId));
      if (!found) throw new Error("Pattern source pocket profile was lost. Repair the source Cut Extrude.");
      profile = found;
      const distance = resolveExtrudeDistance(source, parameters, targets.map(target => target.body!.mesh!), plane);
      if (distance.error || distance.value <= 0) throw new Error(distance.error ?? "Pattern source pocket depth must be positive.");
      depth = distance.value;
    }
    const tools: KernelShape[] = [];
    const bounds: ReturnType<typeof patternToolBounds>[] = [];
    for (const [index, transform] of transforms.entries()) {
      const sweep = extrusionSweep(transform, depth, source.direction ?? "positive"), toolBounds = patternToolBounds(profile, sweep, depth);
      const tool = kernel.extrudeProfile(profile, depth, sweep);
      ownedShapes.add(tool);
      for (const [previousIndex, previous] of tools.entries())
        if (patternBoundsMayOverlap(bounds[previousIndex], toolBounds) && kernel.hasCommonVolume(previous, tool))
          throw new Error(`Pattern instance ${index + 1} overlaps instance ${previousIndex + 1}. Increase spacing, adjust sweep/center, or reduce count.`);
      tools.push(tool);
      bounds.push(toolBounds);
    }
    let cuts: KernelShape[];
    try {
      // The original already exists; validate every additional tool and every target atomically.
      cuts = kernel.cutScope(targets.map(target => target.body!.shape), tools.slice(1));
    } catch (error) {
      if (error instanceof HoleScopeError)
        throw new Error(error.scope === "center"
          ? `Pattern instance ${error.index + 2} does not remove new material. Move it onto the target or reduce count. ${error.message}`
          : `Pattern target ${targets[error.index].body!.name} does not lose material. Restore the source target scope. ${error.message}`);
      throw error;
    }
    cuts.forEach(shape => ownedShapes.add(shape));
    publishOperationOutputs(kernel, runtimeBodies, cuts.map((shape, index) => ({ ...targets[index].body!, bodyId: targets[index].bodyId, shape })));
  } catch (error) {
    errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: kernelErrorMessage("pattern", error) });
  }
}

function rebuildRevolveFeature(
  feature: RevolveFeature,
  document: CadDocument,
  profilesBySketch: Map<string, ReturnType<typeof detectProfiles>>,
  solvedSketches: Map<string, ReturnType<typeof solveSketch>>,
  transforms: Map<string, SketchPlaneTransform>,
  parameters: Parameters<typeof evaluateExpressionRef>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
  capture?: ScopeCapture,
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
  const angle = evaluateExpressionRef(feature.angle, { parameters });
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
    if (capture) {
      capture([shape], targets);
      return;
    }
    const outputs = applyExtrudeOperation(
      kernel,
      feature,
      shape,
      targets,
      stableBodyIdForFeature(feature.id),
      shapesToDispose,
    );
    publishOperationOutputs(
      kernel,
      runtimeBodies,
      outputs,
      feature.operation === "newBody" ? sketchPlaneKey(sketch) : undefined,
      absorbedBodyIds(feature),
    );
  } catch (error) {
    errors.push({
      id: `kernel:${feature.id}`,
      source: "kernel",
      sourceId: feature.id,
      message: kernelErrorMessage(feature.type, error),
    });
  }
}

function rebuildHoleFeature(
  feature: HoleFeature,
  document: CadDocument,
  solvedSketches: Map<string, ReturnType<typeof solveSketch>>,
  planeTransforms: Map<string, SketchPlaneTransform>,
  parameters: Parameters<typeof evaluateExpressionRef>[1]["parameters"],
  runtimeBodies: Map<string, RuntimeBody>,
  shapesToDispose: Set<KernelShape>,
  errors: RebuildError[],
  capture?: ScopeCapture,
) {
  const ids = targetBodyIds(feature);
  const targets = ids.map((bodyId) => ({
    bodyId,
    body: runtimeBodies.get(bodyId),
  }));
  const sketch = document.sketches[feature.sketchId];
  const solved = solvedSketches.get(feature.sketchId);
  const missing = targets.find((target) => !target.body?.mesh);
  if (!ids.length || missing) {
    errors.push({
      id: `feature:${feature.id}:target`,
      source: "feature",
      sourceId: feature.id,
      message: `Hole target body ${missing ? `"${missing.bodyId}" ` : ""}was not found. Reselect a surviving upstream body.`,
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
  if (!feature.centerPointIds.length) {
    errors.push({
      id: `feature:${feature.id}:centers`,
      source: "feature",
      sourceId: feature.id,
      message:
        "Hole requires at least one explicit center point. Select centers in the Inspector.",
    });
    return;
  }
  const diameter = evaluateExpressionRef(feature.diameter, {
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
  const depths =
    feature.depth === "throughAll"
      ? targets.map((target) =>
          throughAllDistance(
            target.body!.mesh!.bounds,
            planeTransform,
            feature.direction ?? "positive",
          ),
        )
      : [evaluateHoleDepth(feature.depth, parameters)];
  const usableDepths = capture
    ? depths.filter(
        (value): value is number => value !== undefined && value > 0,
      )
    : depths;
  if (capture && feature.depth === "throughAll" && !usableDepths.length) {
    capture([], targets.map(target => ({...target.body!,bodyId:target.bodyId})));
    return;
  }
  const depth =
    usableDepths.length &&
    usableDepths.every((value) => value !== undefined && value > 0)
      ? Math.max(...(usableDepths as number[]))
      : undefined;
  if (!depth || depth <= 0) {
    errors.push({
      id: `feature:${feature.id}:depth`,
      source: "feature",
      sourceId: feature.id,
      message:
        "Hole depth must resolve along the selected sketch normal direction.",
    });
    return;
  }
  const tools: KernelShape[] = [];
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
      const tool = kernel.extrudeProfile(
        profile,
        depth,
        extrusionSweep(planeTransform, depth, feature.direction ?? "positive"),
      );
      shapesToDispose.add(tool);
      tools.push(tool);
    }
    if (capture) {
      capture(
        tools,
        targets.map((target) => ({ ...target.body!, bodyId: target.bodyId })),
      );
      return;
    }
    // The fallback remains single-target. Native scope validation allows each
    // center to hit a different body, while rejecting unused centers and targets.
    const native = targets.every(
      (target) => target.body!.mesh!.geometrySource === "opencascade",
    );
    if (targets.length > 1 && (!kernel.cutScope || !native))
      throw new Error("Multi-body holes require native OpenCascade geometry.");
    const cuts =
      native && kernel.cutScope
        ? kernel.cutScope(
            targets.map((target) => target.body!.shape),
            tools,
          )
        : targets.map((target) => kernel.cutAll(target.body!.shape, tools));
    for (const cut of cuts) shapesToDispose.add(cut);
    publishOperationOutputs(
      kernel,
      runtimeBodies,
      cuts.map((shape, index) => ({
        ...targets[index].body!,
        bodyId: targets[index].bodyId,
        shape,
      })),
    );
  } catch (error) {
    errors.push({
      id: `kernel:${feature.id}`,
      source: "kernel",
      sourceId: feature.id,
      message:
        error instanceof HoleScopeError
          ? `${error.message} ${
              error.scope === "target"
                ? `Target body "${targets[error.index].body!.name}" (${targets[error.index].bodyId}).`
                : `Center point "${feature.centerPointIds[error.index]}".`
            }`
          : kernelErrorMessage(feature.type, error),
    });
    return;
  }
}

function rebuildEdgeTreatmentFeature(
  feature: FilletFeature | ChamferFeature,
  document: CadDocument,
  parameters: Parameters<typeof evaluateExpressionRef>[1]["parameters"],
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
  const evaluated = evaluateExpressionRef(expression, { parameters });
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
  parameters: Parameters<typeof evaluateExpressionRef>[1]["parameters"],
): number | undefined {
  if (depth === "throughAll") return undefined;
  const value = evaluateExpressionRef(depth, { parameters });
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
  assertRuntimeTriangleCount(triangles);
  bodies.set(id, body);
}

function assertRuntimeTriangleCount(triangles: number) {
  if (triangles > MODEL_RESOURCE_LIMITS.maxTriangles) throw new Error("Model exceeds the total triangle resource limit. Simplify or suppress bodies.");
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
      message: `${feature.operation} ${feature.type} requires a selected target body.`,
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
      message: `Target body "${missing.bodyId}" was not found for ${feature.operation} ${feature.type}. Reselect a surviving upstream body.`,
    });
    return [];
  }
  return targets.map((target) => ({ bodyId: target.bodyId, ...target.body! }));
}

function resolveExtrudeDistance(
  feature: ExtrudeFeature,
  parameters: Parameters<typeof evaluateExpressionRef>[1]["parameters"],
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
      throughAllDistance(mesh.bounds, transform, feature.direction),
    );
    if (throughAllDistances.some((distance) => distance === undefined))
      return {
        value: 0,
        error:
          `Through-all termination requires the target body to extend in the ${feature.direction} extrusion direction.`,
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
  const distance = evaluateExpressionRef(expression, { parameters });
  if (distance.error || !distance.quantity)
    return {
      value: 0,
      error: distance.error ?? "Extrude distance expression is invalid.",
    };
  if (distance.quantity.dimension !== "length")
    return { value: 0, error: "Extrude distance must resolve to a length." };
  return { value: distance.quantity.value };
}

type OperationOutput = { bodyId: string } & RuntimeBody;
type ScopeCapture = (tools: KernelShape[], targets: OperationOutput[]) => void;

function applyExtrudeOperation(
  activeKernel: KernelAdapter,
  feature: ExtrudeFeature | RevolveFeature,
  tool: KernelShape,
  targets: OperationOutput[],
  newBodyId: string,
  shapesToDispose: Set<KernelShape>,
): OperationOutput[] {
  if (feature.operation === "newBody")
    return [{ bodyId: newBodyId, shape: tool, featureId: feature.id, name: feature.name, planeKey: "" }];
  if (feature.operation === "join") {
    if (targets.length > 1 && !activeKernel.joinAll)
      throw new Error("Multi-body join is not supported by the active kernel.");
    const shape = targets.length > 1
      ? activeKernel.joinAll!(targets.map((target) => target.shape), tool)
      : activeKernel.fuse(targets[0].shape, tool);
    shapesToDispose.add(shape);
    return [{ ...targets[0], shape }];
  }
  return targets.map((target) => {
    try {
      const shape = activeKernel.cut(target.shape, tool);
      // Register immediately: a later target or tessellation may fail.
      shapesToDispose.add(shape);
      return { ...target, shape };
    } catch (error) {
      throw new Error(`${feature.name}: target "${target.name}" (${target.bodyId}): ${kernelErrorMessage(feature.type, error)}`);
    }
  });
}

// Publish only when every boolean, tessellation and final resource check succeeds.
function publishOperationOutputs(
  activeKernel: KernelAdapter,
  bodies: Map<string, RuntimeBody>,
  outputs: OperationOutput[],
  newPlaneKey?: string,
  removedBodyIds: string[] = [],
) {
  const prepared = outputs.map((output) => ({
    ...output,
    mesh: withStableBodyId(activeKernel.tessellate(output.shape, TESSELLATION_LOD.default), output.bodyId),
    planeKey: newPlaneKey ?? output.planeKey,
  }));
  const prospective = new Map(bodies);
  for (const id of removedBodyIds) prospective.delete(id);
  for (const output of prepared) prospective.set(output.bodyId, output);
  // Check the final aggregate, not an intermediate subset of body replacements.
  assertRuntimeTriangleCount([...prospective.values()].reduce((sum, body) => sum + (body.mesh?.indices.length ?? 0) / 3, 0));
  for (const id of removedBodyIds) bodies.delete(id);
  for (const output of prepared) bodies.set(output.bodyId, output);
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
