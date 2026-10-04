import PreviewWorker from "./extrudePreviewWorker?worker";
import { backgroundJob } from "../../persistence/backgroundJob";
import type { CadDocument } from "../document/schema";
import type { RebuildResult } from "./workerProtocol";

/** An isolated worker keeps draft results and cancellation out of the project rebuild. */
export function previewExtrusion(
  document: CadDocument,
  signal: AbortSignal,
): Promise<RebuildResult> {
  if (typeof Worker === "undefined")
    return Promise.reject(
      new Error("A native extrusion preview requires a browser worker."),
    );
  return backgroundJob<CadDocument, RebuildResult>(
    PreviewWorker,
    document,
    signal,
    undefined,
    30000,
  );
}
