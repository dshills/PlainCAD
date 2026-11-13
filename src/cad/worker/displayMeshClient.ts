import PreviewWorker from "./extrudePreviewWorker?worker";
import { backgroundJob } from "../../persistence/backgroundJob";
import type { DisplayMesh, DisplayMeshRequest } from "../kernel/displayMesh";

export function requestDisplayMeshes(request: DisplayMeshRequest, signal: AbortSignal) {
  return backgroundJob<DisplayMeshRequest, DisplayMesh[]>(PreviewWorker, request, signal, undefined, 20000);
}
