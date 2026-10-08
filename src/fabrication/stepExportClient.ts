import StepWorker from "./stepExportWorker?worker";
import { backgroundJob } from "../persistence/backgroundJob";
import { assertStepReply, assertStepSelection, type StepExportReply, type StepExportRequest } from "./stepExport";
import type { CadDocument } from "../cad/document/schema";
let requestCounter = 0;
export async function exportStepDocument(document: CadDocument, bodyIds: string[], epoch: number, signal: AbortSignal, progress?: (message: string) => void) {
  if (signal.aborted) throw new Error("STEP export was cancelled.");
  if (typeof Worker === "undefined") throw new Error("Native STEP export requires browser worker support.");
  assertStepSelection(bodyIds);
  const request: StepExportRequest = { document, bodyIds, epoch, requestId: ++requestCounter };
  const reply = await backgroundJob<StepExportRequest, StepExportReply>(StepWorker, request, signal, progress, 60000);
  if (signal.aborted) throw new Error("STEP export was cancelled.");
  assertStepReply(reply, request);
  return reply.output;
}
