import { rebuildDocument } from "../features/rebuildGraph";
import { exportMeshesToStl } from "../kernel/stlExport";
import { OpenCascadeKernel } from "../kernel/OpenCascadeKernel";
import { CadDocument } from "../document/schema";
import { WorkerRequest, WorkerResponse } from "./workerProtocol";

let requestQueue = Promise.resolve();
let latestQueuedRebuild: WorkerRequest | undefined;
const post = (response: WorkerResponse) => self.postMessage(response);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "rebuild") {
    latestQueuedRebuild = request;
    requestQueue = requestQueue
      .then(async () => {
        const queued = latestQueuedRebuild;
        latestQueuedRebuild = undefined;
        if (queued) await handleRequest(queued);
      })
      .catch(recoverQueue);
    return;
  }
  requestQueue = requestQueue.then(() => handleRequest(request)).catch(recoverQueue);
};

async function handleRequest(request: WorkerRequest) {
  try {
    switch (request.type) {
      case "initialize": {
        await OpenCascadeKernel.initialize();
        post({ type: "initialized", requestId: request.requestId });
        return;
      }
      case "rebuild": {
        await OpenCascadeKernel.initialize();
        const result = rebuildDocument(request.document as CadDocument);
        post({ type: "rebuildResult", requestId: request.requestId, result });
        return;
      }
      case "exportStl": {
        await OpenCascadeKernel.initialize();
        const result = rebuildDocument(request.document as CadDocument);
        const bytes = exportMeshesToStl(result.meshes);
        post({ type: "exportResult", requestId: request.requestId, bytes });
        return;
      }
      default: {
        const unknownRequest = request as unknown as { requestId: number; type: string };
        post({ type: "error", requestId: unknownRequest.requestId, message: `Unknown worker request: ${unknownRequest.type}` });
        return;
      }
    }
  } catch (error) {
    post({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
}

function recoverQueue(error: unknown) {
  console.error("Geometry worker queue recovered after an unexpected failure.", error);
}
