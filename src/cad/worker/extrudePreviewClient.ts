import PreviewWorker from "./extrudePreviewWorker?worker";
import { backgroundJob } from "../../persistence/backgroundJob";
import type { CadDocument } from "../document/schema";
import type { RebuildResult } from "./workerProtocol";

/** An isolated worker keeps draft results and cancellation out of the project rebuild. */
export function previewModeling(
  document: CadDocument,
  signal: AbortSignal,
): Promise<RebuildResult> {
  if (typeof Worker === "undefined")
    return Promise.reject(
      new Error("A native modeling preview requires a browser worker."),
    );
  return backgroundJob<CadDocument, RebuildResult>(
    PreviewWorker,
    document,
    signal,
    undefined,
    30000,
  );
}

/** Preserve the Extrude API while sharing the bounded worker with other drafts. */
export const previewExtrusion = previewModeling;
