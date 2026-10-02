import ExportWorker from "./exportWorker?worker";
import { backgroundJob } from "../persistence/backgroundJob";
import { buildStlExport, type FabricationResult } from "./exportPlan";
import type { FabricationRequest } from "./exportWorker";
export async function exportFabrication(
  request: FabricationRequest,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<FabricationResult> {
  if (signal.aborted) throw new Error("Operation cancelled.");
  if (typeof Worker !== "undefined")
    return backgroundJob<FabricationRequest, FabricationResult>(
      ExportWorker,
      request,
      signal,
      progress,
      60000,
    );
  if (request.mode === "merged")
    return Promise.reject(
      new Error("Native union export requires a browser worker."),
    );
  progress("Validating and encoding STL…");
  if (signal.aborted) throw new Error("Operation cancelled.");
  const output = buildStlExport(
    request.meshes,
    request.bodies,
    request.document.name,
    request.mode,
    request.fullChecks,
  );
  if (signal.aborted) throw new Error("Operation cancelled.");
  return output;
}
