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
}
export function buildStlExport(
  meshes: RenderMesh[],
  bodies: CadBody[],
  name: string,
  mode: StlMode,
  fullChecks = true,
): FabricationResult {
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
  const budget = { pairs: 0 },
    checks = meshes.map((mesh) => validateMesh(mesh, fullChecks, budget));
  const names = meshes.map(
    (mesh) =>
      bodies.find((body) => body.id === mesh.bodyId)?.name ?? mesh.bodyId,
  );
  const warnings =
    fullChecks && mode !== "separate"
      ? overlapWarnings(checks, names, budget)
      : [];
  if (!fullChecks)
    warnings.push(
      "Expensive self-intersection and body-overlap checks were skipped; topology and orientation were validated.",
    );
  if (mode === "merged" && (meshes[0].geometryAssertions?.solidCount ?? 1) > 1)
    warnings.push(
      "Native union contains separate solids. It did not connect disjoint bodies.",
    );
  let file: ExportFile;
  if (mode === "separate" && meshes.length > 1) {
    const filenames = uniqueFilenames(names);
    file = {
      filename: safeFilename(name, ".zip", "-STL"),
      bytes: zipFiles(
        checks.map((check, i) => ({
          filename: filenames[i],
          bytes: exportMeshesToStl([check.mesh], names[i]),
        })),
      ),
    };
  } else
    file = {
      filename: safeFilename(name, ".stl"),
      bytes: exportMeshesToStl(
        checks.map((check) => check.mesh),
        name,
      ),
    };
  return { file, warnings, bodyCount: meshes.length, triangleCount };
}
