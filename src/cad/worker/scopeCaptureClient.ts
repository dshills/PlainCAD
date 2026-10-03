import ScopeWorker from "./scopeCaptureWorker?worker";
import { backgroundJob } from "../../persistence/backgroundJob";
import type { ScopeCaptureRequest } from "./scopeCaptureWorker";
export function captureTargetScope(
  request: ScopeCaptureRequest,
  signal: AbortSignal,
  progress?: (message: string) => void,
): Promise<string[]> {
  if (typeof Worker === "undefined")
    return Promise.reject(
      new Error("Native scope capture requires a browser worker."),
    );
  return backgroundJob<ScopeCaptureRequest, string[]>(
    ScopeWorker,
    request,
    signal,
    progress,
    60000,
  );
}
