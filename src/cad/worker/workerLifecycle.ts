import { WorkerRequest, WorkerResponse } from "./workerProtocol";

export const WORKER_TIMEOUTS_MS = {
  initialize: 8_000,
  rebuild: 8_000,
  exportStl: 30_000,
} satisfies Record<WorkerRequest["type"], number>;

export interface PendingWorkerRequest {
  requestId: number;
  epoch: number;
  kind: WorkerRequest["type"];
  timeoutMs: number;
  maxElapsedMs: number;
  startedAt: number;
  lastProgressAt: number;
}

export function createWorkerRequest<T extends Omit<WorkerRequest, "epoch" | "requestId">>(
  request: T,
  requestId: number,
  epoch: number,
): T & { requestId: number; epoch: number } {
  return { ...request, requestId, epoch };
}

export function shouldAcceptWorkerResponse(response: WorkerResponse, activeEpoch: number, pending?: Pick<PendingWorkerRequest, "requestId" | "epoch">): boolean {
  return Boolean(pending && response.epoch === activeEpoch && response.epoch === pending.epoch && response.requestId === pending.requestId);
}

export function isWorkerRequestExpired(pending: Pick<PendingWorkerRequest, "startedAt" | "lastProgressAt" | "timeoutMs" | "maxElapsedMs">, now: number): boolean {
  return now - pending.lastProgressAt > pending.timeoutMs || now - pending.startedAt > pending.maxElapsedMs;
}
