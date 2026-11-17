import { NativeKernel } from "../kernel/NativeKernel";
import { rebuildDocument } from "../features/rebuildGraph";
import type { CadDocument } from "../document/schema";
import type { DisplayMeshRequest } from "../kernel/displayMesh";

self.onmessage = async (event: MessageEvent<CadDocument | DisplayMeshRequest>) => {
  try {
    await NativeKernel.initialize();
    const request = event.data;
    if ("document" in request) {
      const result = rebuildDocument(request.document, { displayMeshRequest: request.bodies, reuseNativeFeatures: false });
      if (!result.success || !result.displayMeshes) throw new Error(result.errors[0]?.message ?? "Close-up detail did not rebuild.");
      const meshes = result.displayMeshes;
      self.postMessage({ result: meshes }, { transfer: meshes.flatMap(mesh => [
        mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer,
        ...(mesh.nativeEdgeSegments ? [mesh.nativeEdgeSegments.buffer] : []),
      ]) });
    } else self.postMessage({ result: rebuildDocument(request, { includeDisplayEdges: true }) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
