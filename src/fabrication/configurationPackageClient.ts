import PackageWorker from "./configurationPackageWorker?worker";
import type { CadDocument } from "../cad/document/schema";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import { backgroundJob } from "../persistence/backgroundJob";
import { serializeProject } from "../persistence/exportProject";
import { assertConfigurationPackageReply, assertConfigurationPackageRequest, CONFIGURATION_PACKAGE_MAX_MS, type ConfigurationPackageReply, type ConfigurationPackageRequest } from "./configurationPackage";

let requestId = 0;
export async function generateConfigurationPackage(
  document: CadDocument,
  configurationId: string,
  meshes: readonly RenderMesh[],
  drawingBodyId: string,
  session: number,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  if (signal.aborted) throw new Error("Fabrication package canceled.");
  if (typeof Worker === "undefined") throw new Error("Fabrication packages require a native browser worker.");
  const request: ConfigurationPackageRequest = {
    requestId: ++requestId, session, projectText: serializeProject(document), configurationId,
    bodyIds: meshes.map(mesh => mesh.bodyId), drawingBodyId,
  };
  assertConfigurationPackageRequest(request);
  const reply = await backgroundJob<ConfigurationPackageRequest, ConfigurationPackageReply>(PackageWorker, request, signal, progress, CONFIGURATION_PACKAGE_MAX_MS);
  if (signal.aborted) throw new Error("Fabrication package canceled.");
  assertConfigurationPackageReply(reply, request, document.id, meshes);
  return reply.archive;
}
