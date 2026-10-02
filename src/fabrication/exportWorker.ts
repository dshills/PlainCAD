import { buildStlExport, type StlMode } from "./exportPlan";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import type { CadBody } from "../cad/worker/workerProtocol";
import type { CadDocument } from "../cad/document/schema";
export interface FabricationRequest {
  meshes: RenderMesh[];
  bodies: CadBody[];
  document: CadDocument;
  mode: StlMode;
  fullChecks: boolean;
  bodyIds?: string[];
}
self.onmessage = async (event: MessageEvent<FabricationRequest>) => {
  try {
    const request = event.data;
    let meshes = request.meshes,
      bodies = request.bodies;
    if (request.mode === "merged") {
      self.postMessage({ progress: "Building native union…" });
      const { OpenCascadeKernel } =
        await import("../cad/kernel/OpenCascadeKernel");
      const { rebuildDocument } = await import("../cad/features/rebuildGraph");
      await OpenCascadeKernel.initialize();
      const result = rebuildDocument(request.document, { exportUnion: true, exportBodyIds: request.bodyIds });
      if (!result.success)
        throw new Error(result.errors.map((error) => error.message).join(" "));
      meshes = result.meshes;
      bodies = result.bodies;
    }
    self.postMessage({
      progress: "Validating mesh topology and intersections…",
    });
    const result = buildStlExport(
      meshes,
      bodies,
      request.document.name,
      request.mode,
      request.fullChecks,
    );
    self.postMessage({ result }, { transfer: [result.file.bytes] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
