import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import {
  captureDocumentTargetScope,
  scopeFeatureFromDocument,
} from "../features/targetScopeCapture";
import type { CadDocument } from "../document/schema";
export interface ScopeCaptureRequest {
  document: CadDocument;
  featureId: string;
}
self.onmessage = async (event: MessageEvent<ScopeCaptureRequest>) => {
  try {
    const { document, featureId } = event.data;
    const feature = scopeFeatureFromDocument(document, featureId);
    self.postMessage({ progress: "Initializing native scope capture…" });
    await OpenCascadeKernel.initialize();
    self.postMessage({ progress: "Checking native body/tool intersections…" });
    self.postMessage({ result: captureDocumentTargetScope(document, feature) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
