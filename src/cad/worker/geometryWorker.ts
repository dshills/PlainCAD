import { rebuildDocument } from "../features/rebuildGraph";
import { exportMeshesToStl } from "../kernel/stlExport";
import { CadDocument } from "../document/schema";
import { WorkerRequest, WorkerResponse } from "./workerProtocol";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "initialize") {
      post({ type: "initialized", requestId: request.requestId });
    }
    if (request.type === "rebuild") {
      const result = rebuildDocument(request.document as CadDocument);
      post({ type: "rebuildResult", requestId: request.requestId, result });
    }
    if (request.type === "exportStl") {
      const result = rebuildDocument(request.document as CadDocument);
      const bytes = exportMeshesToStl(result.meshes);
      post({ type: "exportResult", requestId: request.requestId, bytes });
    }
  } catch (error) {
    post({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};

function post(response: WorkerResponse) {
  self.postMessage(response);
}
