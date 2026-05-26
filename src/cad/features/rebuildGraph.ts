import { CadBody, RebuildError, RebuildResult, RebuildWarning } from "../worker/workerProtocol";
import { CadDocument } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { solveSketch } from "../sketch/SketchSolver";
import { detectProfiles } from "../sketch/profileDetection";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { validateDocument } from "../document/validate";

const kernel = new OpenCascadeKernel();

export function rebuildDocument(document: CadDocument): RebuildResult {
  const started = performance.now();
  const errors: RebuildError[] = [];
  const warnings: RebuildWarning[] = [];
  const validation = validateDocument(document);
  for (const issue of validation) {
    errors.push({ id: `validation:${issue.sourceId ?? issue.message}`, source: issue.source === "document" ? "feature" : issue.source, sourceId: issue.sourceId, message: issue.message });
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

  if (errors.length === 0) {
    for (const feature of document.features) {
      if (feature.suppressed) continue;
      if (feature.type !== "extrude") {
        warnings.push({ id: `feature:${feature.id}`, source: "feature", sourceId: feature.id, message: `${feature.type} is not implemented in the MVP rebuild path.` });
        continue;
      }
      const profileResult = profilesBySketch.get(feature.sketchId);
      const profile = profileResult?.profiles.find((item) => item.id === feature.profileId) ?? profileResult?.profiles[0];
      if (!profile) {
        errors.push({ id: `feature:${feature.id}:profile`, source: "feature", sourceId: feature.id, message: `Extrude failed: sketch "${feature.sketchId}" does not contain a closed supported profile.` });
        continue;
      }
      const distance = evaluateExpression(feature.distance.expression, { parameters: evaluated.values });
      if (distance.error || !distance.quantity || distance.quantity.value <= 0) {
        errors.push({ id: `feature:${feature.id}:distance`, source: "feature", sourceId: feature.id, message: distance.error ?? "Extrude distance must be greater than zero." });
        continue;
      }
      try {
        const shape = kernel.extrudeProfile(profile, distance.quantity.value);
        const mesh = kernel.tessellate(shape, { linearDeflection: 0.5, angularDeflection: 0.2 });
        meshes.push(mesh);
        bodies.push({ id: shape.id, name: feature.name, featureId: feature.id });
      } catch (error) {
        errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

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
