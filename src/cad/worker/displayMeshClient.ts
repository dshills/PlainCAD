import PreviewWorker from "./extrudePreviewWorker?worker";
import { backgroundJob } from "../../persistence/backgroundJob";
import type { DisplayMesh, DisplayMeshRequest } from "../kernel/displayMesh";

export function requestDisplayMeshes(request: DisplayMeshRequest, signal: AbortSignal) {
  // Detail tessellation is optional and synchronous in both native kernels.
  // It must never occupy the authoritative modeling worker: aborting a queued
  // promise cannot interrupt native work already running on that worker.
  return backgroundJob<DisplayMeshRequest, DisplayMesh[]>(PreviewWorker, request, signal, undefined, 20000);
}
