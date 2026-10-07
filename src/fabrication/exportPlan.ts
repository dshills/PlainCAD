import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import type { CadBody } from "../cad/worker/workerProtocol";
import { exportMeshesToStl } from "../cad/kernel/stlExport";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { uniqueFilenames, safeFilename } from "../persistence/filenames";
import { validateMesh, overlapWarnings } from "./meshValidation";
import { zipFiles, type ExportFile } from "./zip";
export type StlMode = "separate" | "shells" | "merged";
export interface FabricationResult {
  file: ExportFile;
  warnings: string[];
  bodyCount: number;
  triangleCount: number;
  metrics?: { meshValidationMs: number; encodingMs: number; totalMs: number };
}
export function buildStlExport(
  meshes: RenderMesh[],
  bodies: CadBody[],
  name: string,
  mode: StlMode,
  fullChecks = true,
  bodyNames?: Readonly<Record<string, string>>,
): FabricationResult {
  const started = performance.now();
  if (!["separate", "shells", "merged"].includes(mode))
    throw new Error("Unknown STL export mode.");
  if (!meshes.length || meshes.length > MODEL_RESOURCE_LIMITS.maxBodies)
    throw new Error("STL body count is empty or exceeds the resource limit.");
  const triangleCount = meshes.reduce(
    (sum, mesh) => sum + mesh.indices.length / 3,
    0,
  );
  if (triangleCount > MODEL_RESOURCE_LIMITS.maxTriangles)
    throw new Error("STL exceeds the total triangle resource limit.");
  if (
    mode === "merged" &&
    (meshes.length !== 1 ||
      meshes[0].geometrySource !== "opencascade" ||
      !fullChecks)
  )
    throw new Error(
      "Merged export requires a native union and full mesh validation.",
    );
  const validationStarted = performance.now();
  const budget = { pairs: 0 },
    checks = meshes.map((mesh) => validateMesh(mesh, fullChecks, budget));
  const names = meshes.map(
    (mesh) =>
      bodyNames?.[mesh.bodyId] ?? bodies.find((body) => body.id === mesh.bodyId)?.name ?? mesh.bodyId,
  );
  // Resolve safe-filename collisions against the full model, not the current export subset.
  const namedIds = bodyNames ? Object.keys(bodyNames).sort() : meshes.map((mesh) => mesh.bodyId);
  const filenames = uniqueFilenames(bodyNames ? namedIds.map((id) => bodyNames[id]) : names);
  const filenameById = new Map(namedIds.map((id, i) => [id, filenames[i]]));
  const warnings =
    fullChecks && mode !== "separate"
      ? overlapWarnings(checks, names, budget)
      : [];
  if (!fullChecks)
    warnings.push(
      mode === "separate"
        ? "Self-intersection checks for each part were skipped; topology and orientation were validated. Overlaps between separate files are not checked."
        : "Expensive self-intersection and body-overlap checks were skipped; topology and orientation were validated.",
    );
  if (mode === "merged" && (meshes[0].geometryAssertions?.solidCount ?? 1) > 1)
    warnings.push(
      "Native union contains separate solids. It did not connect disjoint bodies.",
    );
  const meshValidationMs = performance.now() - validationStarted;
  const encodingStarted = performance.now();
  let file: ExportFile;
  if (mode === "separate" && meshes.length > 1) {
    file = {
      filename: safeFilename(name, ".zip", "-STL"),
      bytes: zipFiles(
        checks.map((check, i) => ({
          filename: filenameById.get(check.mesh.bodyId) ?? safeFilename(names[i], ".stl"),
          bytes: exportMeshesToStl([check.mesh], names[i]),
        })),
      ),
    };
  } else
    file = {
      filename: mode === "separate" && bodyNames
        ? filenameById.get(meshes[0].bodyId) ?? safeFilename(names[0], ".stl")
        : safeFilename(name, ".stl"),
      bytes: exportMeshesToStl(
        checks.map((check) => check.mesh),
        name,
      ),
    };
  return {
    file,
    warnings,
    bodyCount: meshes.length,
    triangleCount,
    metrics: {
      meshValidationMs,
      encodingMs: performance.now() - encodingStarted,
      totalMs: performance.now() - started,
    },
  };
}
