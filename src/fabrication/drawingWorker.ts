import { importProjectText } from "../persistence/projectCodec";
import { buildShopDrawing } from "../cad/inspection/shopDrawing";
import type { DrawingRequest, DrawingReply } from "./drawingClient";
let accepted = false;
self.onmessage = async (event: MessageEvent<DrawingRequest>) => {
  if (accepted) return;
  accepted = true; let clear: (() => void) | undefined;
  try {
    const request = event.data;
    if (!request || !Number.isSafeInteger(request.requestId) || request.requestId < 1 || !Number.isSafeInteger(request.session) || request.session < 0 || typeof request.bodyId !== "string" || !request.bodyId || request.bodyId.length > 160 || (request.sectionHeight !== undefined && !Number.isFinite(request.sectionHeight))) throw new Error("Drawing request is malformed.");
    const document = importProjectText(JSON.stringify(request.document));
    self.postMessage({ progress: "Rebuilding current native drawing geometry…" });
    const { OpenCascadeKernel } = await import("../cad/kernel/OpenCascadeKernel"), { rebuildDocument, clearNativeFeatureCache } = await import("../cad/features/rebuildGraph");
    clear = clearNativeFeatureCache; await OpenCascadeKernel.initialize();
    const result = rebuildDocument(document, { captureDrawingBodyId: request.bodyId, epoch: request.session, reuseNativeFeatures: false });
    if (!result.success) throw new Error(result.errors.map(error => error.message).join(" ") || "Native drawing rebuild failed.");
    self.postMessage({ progress: "Projecting views and tracing the native mesh section…" });
    const drawing = buildShopDrawing(document, result, request.bodyId, request.sectionHeight);
    const reply: DrawingReply = { requestId: request.requestId, session: request.session, documentId: document.id, drawing };
    self.postMessage({ result: reply });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Shop drawing generation failed." }); }
  finally { clear?.(); self.close(); }
};
