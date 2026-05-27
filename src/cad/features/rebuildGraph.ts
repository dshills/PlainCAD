import { CadBody, RebuildError, RebuildResult, RebuildWarning } from "../worker/workerProtocol";
import { CadDocument } from "../document/schema";
import { evaluateExpression } from "../parameters/expressionEvaluator";
import { solveSketch } from "../sketch/SketchSolver";
import { detectProfiles } from "../sketch/profileDetection";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { validateDocument } from "../document/validate";
import { RenderMesh } from "../kernel/KernelAdapter";
import { sketchPlaneTransform } from "../sketch/planes";

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
  const shapesToDispose = [];

  if (errors.length === 0) {
    for (const feature of document.features) {
      if (feature.suppressed) continue;
      if (feature.type !== "extrude") {
        warnings.push({ id: `feature:${feature.id}`, source: "feature", sourceId: feature.id, message: `${feature.type} is not implemented in the MVP rebuild path.` });
        continue;
      }
      if (feature.operation !== "newBody") {
        errors.push({ id: `feature:${feature.id}:operation`, source: "feature", sourceId: feature.id, message: `Extrude operation "${feature.operation}" is not supported yet.` });
        continue;
      }
      if (feature.direction !== "positive") {
        errors.push({ id: `feature:${feature.id}:direction`, source: "feature", sourceId: feature.id, message: `Extrude direction "${feature.direction}" is not supported yet.` });
        continue;
      }
      const profileResult = profilesBySketch.get(feature.sketchId);
      const profile = profileResult?.profiles.find((item) => item.id === feature.profileId);
      if (!profile) {
        errors.push({ id: `feature:${feature.id}:profile`, source: "feature", sourceId: feature.id, message: `Extrude failed: profile "${feature.profileId}" was not found in sketch "${feature.sketchId}".` });
        continue;
      }
      const distance = evaluateExpression(feature.distance.expression, { parameters: evaluated.values });
      if (distance.error || !distance.quantity || distance.quantity.value <= 0) {
        errors.push({ id: `feature:${feature.id}:distance`, source: "feature", sourceId: feature.id, message: distance.error ?? "Extrude distance must be greater than zero." });
        continue;
      }
      const distanceValue = distance.quantity.value;
      const sketch = document.sketches[feature.sketchId];
      if (!sketch) {
        errors.push({ id: `feature:${feature.id}:sketch`, source: "feature", sourceId: feature.id, message: "Extrude references a missing sketch." });
        continue;
      }
      try {
        const shape = kernel.extrudeProfile(profile, distanceValue);
        shapesToDispose.push(shape);
        const mesh = transformMeshToSketchPlane(kernel.tessellate(shape, { linearDeflection: 0.5, angularDeflection: 0.2 }), sketch);
        meshes.push(mesh);
        bodies.push({ id: shape.id, name: feature.name, featureId: feature.id });
      } catch (error) {
        errors.push({ id: `kernel:${feature.id}`, source: "kernel", sourceId: feature.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  for (const shape of shapesToDispose) {
    kernel.disposeShape?.(shape);
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
