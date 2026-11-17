import { afterEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { requestDisplayMeshes } from "../cad/worker/displayMeshClient";
import type { DisplayMeshRequest } from "../cad/kernel/displayMesh";

const runtime = vi.hoisted(() => ({ workers: [] as Array<{
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent) => void;
}> }));
vi.mock("../cad/worker/extrudePreviewWorker?worker", () => ({
  default: class {
    postMessage = vi.fn();
    terminate = vi.fn();
    onmessage?: (event: MessageEvent) => void;
    constructor() { runtime.workers.push(this); }
  },
}));
afterEach(() => { runtime.workers.length = 0; vi.useRealTimers(); });

function largeRequest(): DisplayMeshRequest {
  const document = createBoxTemplate();
  // The former shared-worker shortcut began at eight features. This unit
  // test exercises job ownership, not the geometry of the repeated features.
  document.features = Array.from({ length: 8 }, (_, i) => ({ ...document.features[0], id: `feature-${i}` }));
  return { document, bodies: [] };
}

it("isolates long-graph display work and terminates canceled native work before accepting another result", async () => {
  const first = new AbortController(), second = new AbortController();
  const request = largeRequest();
  const canceled = requestDisplayMeshes(request, first.signal);
  const rejection = expect(canceled).rejects.toThrow("Operation cancelled.");
  expect(runtime.workers).toHaveLength(1);
  expect(runtime.workers[0].postMessage).toHaveBeenCalledWith(request);
  first.abort();
  await rejection;
  expect(runtime.workers[0].terminate).toHaveBeenCalledOnce();

  const fresh = requestDisplayMeshes(request, second.signal);
  expect(runtime.workers).toHaveLength(2);
  runtime.workers[0].onmessage?.({ data: { result: ["stale"] } } as MessageEvent);
  expect(runtime.workers[1].terminate).not.toHaveBeenCalled();
  runtime.workers[1].onmessage?.({ data: { result: [] } } as MessageEvent);
  await expect(fresh).resolves.toEqual([]);
  expect(runtime.workers[1].terminate).toHaveBeenCalledOnce();
});

it("never starts an aborted detail job and terminates a stalled detail worker at its own deadline", async () => {
  vi.useFakeTimers();
  const aborted = new AbortController();
  aborted.abort();
  await expect(requestDisplayMeshes(largeRequest(), aborted.signal)).rejects.toThrow("Operation cancelled.");
  expect(runtime.workers).toHaveLength(0);
  const pending = requestDisplayMeshes(largeRequest(), new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow("resource/time limit");
  await vi.advanceTimersByTimeAsync(20000);
  await rejection;
  expect(runtime.workers[0].terminate).toHaveBeenCalledOnce();
});
