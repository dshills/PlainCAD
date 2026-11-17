import { importProjectText } from "../persistence/projectCodec";
import type { JobReply } from "../persistence/backgroundJob";
import { assertConfigurationPackageRequest, buildConfigurationPackage, type ConfigurationPackageReply, type ConfigurationPackageRequest } from "./configurationPackage";
import { NativeKernel } from "../cad/kernel/NativeKernel";
import { assertStepSelection, stepBodyLimit } from "./stepExport";

type PackageWorkerReply = JobReply<ConfigurationPackageReply>;

let accepted = false;
self.onmessage = async (event: MessageEvent<ConfigurationPackageRequest>) => {
  if (accepted) return;
  accepted = true;
  let clearCache: (() => void) | undefined;
  const progress = (message: string) => self.postMessage({ progress: message } satisfies PackageWorkerReply);
  try {
    const request = event.data;
    assertConfigurationPackageRequest(request);
    assertStepSelection(request.bodyIds, undefined, stepBodyLimit(NativeKernel.source));
    const document = importProjectText(request.projectText);
    if (!document.configurations?.some(item => item.id === request.configurationId)) throw new Error("Configuration no longer exists.");
    progress("Rebuilding the selected configuration and validating STEP…");
    const { rebuildDocument, clearNativeFeatureCache } = await import("../cad/features/rebuildGraph");
    clearCache = clearNativeFeatureCache;
    await NativeKernel.initialize();
    const unavailable = NativeKernel.stepExportDiagnostic();
    if (unavailable) throw new Error(unavailable);
    const rebuilt = rebuildDocument(document, {
      epoch: request.session, reuseNativeFeatures: false,
      exportStepBodyIds: request.bodyIds, captureDrawingBodyId: request.drawingBodyId,
    });
    const result = buildConfigurationPackage(request, document, rebuilt, progress);
    self.postMessage({ result } satisfies PackageWorkerReply, { transfer: [result.archive.bytes] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Configuration package failed." } satisfies PackageWorkerReply);
  } finally { clearCache?.(); self.close(); }
};
