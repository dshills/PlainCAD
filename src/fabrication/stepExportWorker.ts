import { importProjectText } from "../persistence/projectCodec";
import { assertStepSelection, type StepExportRequest, type StepExportReply } from "./stepExport";
let accepted = false;
self.onmessage = async (event: MessageEvent<StepExportRequest>) => {
  if (accepted) { self.postMessage({ error: "A disposable STEP worker accepts one export only." }); return; }
  accepted = true;
  let clearCache: (() => void) | undefined;
  try {
    const request = event.data;
    if (!request || !Number.isSafeInteger(request.requestId) || request.requestId <= 0 || !Number.isSafeInteger(request.epoch) || request.epoch < 0 || !Array.isArray(request.bodyIds)) throw new Error("STEP worker request is malformed.");
    assertStepSelection(request.bodyIds);
    const document = importProjectText(JSON.stringify(request.document));
    self.postMessage({ progress: "Rebuilding selected STEP bodies with native geometry…" });
    const { OpenCascadeKernel } = await import("../cad/kernel/OpenCascadeKernel");
    const { rebuildDocument, clearNativeFeatureCache } = await import("../cad/features/rebuildGraph");
    clearCache = clearNativeFeatureCache;
    await OpenCascadeKernel.initialize();
    const unavailable = OpenCascadeKernel.stepExportDiagnostic();
    if (unavailable) throw new Error(unavailable);
    self.postMessage({ progress: "Writing STEP and verifying its native round trip…" });
    const rebuilt = rebuildDocument(document, { exportStepBodyIds: request.bodyIds, epoch: request.epoch, reuseNativeFeatures: false });
    if (!rebuilt.success || !rebuilt.nativeStepExport) throw new Error(rebuilt.errors.map(error => error.message).join(" ") || "Native STEP rebuild produced no export.");
    const result: StepExportReply = { requestId: request.requestId, epoch: request.epoch, bodyIds: [...request.bodyIds], output: rebuilt.nativeStepExport };
    self.postMessage({ result }, { transfer: [result.output.bytes] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Native STEP export failed." });
  } finally { clearCache?.(); self.close(); }
};
