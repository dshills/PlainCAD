import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { rebuildDocument } from "../features/rebuildGraph";
import type { CadDocument } from "../document/schema";

self.onmessage = async (event: MessageEvent<CadDocument>) => {
  try {
    await OpenCascadeKernel.initialize();
    self.postMessage({ result: rebuildDocument(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
