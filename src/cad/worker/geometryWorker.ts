import { rebuildDocument } from "../features/rebuildGraph";
import { exportMeshesToStl } from "../kernel/stlExport";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { CadDocument } from "../document/schema";
import { WorkerRequest, WorkerResponse } from "./workerProtocol";

let requestQueue = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  requestQueue = requestQueue.then(() => handleRequest(event.data));
};

async function handleRequest(request: WorkerRequest) {
  try {
    if (request.type === "initialize") {
      await OpenCascadeKernel.initialize();
      post({ type: "initialized", requestId: request.requestId });
    }
    if (request.type === "rebuild") {
      await OpenCascadeKernel.initialize();
      const result = rebuildDocument(request.document as CadDocument);
      post({ type: "rebuildResult", requestId: request.requestId, result });
    }
    if (request.type === "exportStl") {
      await OpenCascadeKernel.initialize();
      const result = rebuildDocument(request.document as CadDocument);
      const bytes = exportMeshesToStl(result.meshes);
      post({ type: "exportResult", requestId: request.requestId, bytes });
    }
  } catch (error) {
    post({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
}

function post(response: WorkerResponse) {
  self.postMessage(response);
}
