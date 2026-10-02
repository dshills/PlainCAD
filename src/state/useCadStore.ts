import { create } from "zustand";
import { CadDocument, SelectionState } from "../cad/document/schema";
import { createEmptyDocument, removeParameter, upsertParameter } from "../cad/document/CadDocument";
import { CadParameter } from "../cad/document/schema";
import { createId } from "../cad/document/ids";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { RebuildResult, WorkerRequest, WorkerResponse } from "../cad/worker/workerProtocol";
import { createWorkerRequest, isWorkerRequestExpired, shouldAcceptWorkerResponse, REBUILD_DEBOUNCE_MS, WORKER_TIMEOUTS_MS } from "../cad/worker/workerLifecycle";
import GeometryWorker from "../cad/worker/geometryWorker?worker";
import { bindDocumentExpressions, renameParameter } from "../cad/parameters/expressionBindings";

export interface HistoryState {
  past: CadDocument[];
  present: CadDocument;
  future: CadDocument[];
}

interface RebuildState {
  status: "idle" | "loadingKernel" | "queued" | "rebuilding" | "succeeded" | "failed";
  result?: RebuildResult;
  kernelReady: boolean;
  message?: string;
}

export interface CadStore {
  documentSession: number;
  history: HistoryState;
  selection: SelectionState;
  rebuild: RebuildState;
  fileError?: string;
  fileBusy?: boolean;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  setFileError(message: string | undefined): void;
  setDocument(document: CadDocument): void;
  updateDocument(mutator: (document: CadDocument) => CadDocument): void;
  addParameter(): void;
  updateParameter(name: string, patch: Partial<CadParameter>): void;
  deleteParameter(name: string): void;
  undo(): void;
  redo(): void;
  select(selection: SelectionState["selectedIds"][number] | undefined): void;
  initializeKernel(): void;
  rebuildNow(): void;
}

const initialDocument = createEmptyDocument();
const initialRebuild = rebuildDocument(initialDocument);
let rebuildRequestId = 0;
let latestKernelInitRequestId = 0;
let nextWorkerRequestId = 0;
let workerEpoch = 0;
let geometryWorker: Worker | undefined;
let kernelInitialized = false;
let kernelInitializing = false;
let queuedRebuildDocument: CadDocument | undefined;
let rebuildDebounce: ReturnType<typeof setTimeout> | undefined;
const pendingWorkerRequests = new Map<
  number,
  {
    kind: WorkerRequest["type"];
    requestId: number;
    epoch: number;
    onResult?: (result: RebuildResult) => void;
    onError?: (message: string) => void;
    onInitialized?: () => void;
    timeout?: ReturnType<typeof setTimeout>;
    startedAt: number;
    lastProgressAt: number;
    timeoutMs: number;
    maxElapsedMs: number;
  }
>();

function getGeometryWorker(): Worker | undefined {
  if (typeof Worker === "undefined") return undefined;
  if (!geometryWorker) {
    workerEpoch += 1;
    geometryWorker = new GeometryWorker();
    geometryWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      try {
        const pending = pendingWorkerRequests.get(event.data.requestId);
        if (!shouldAcceptWorkerResponse(event.data, workerEpoch, pending)) return;
        if (!pending) return;
        pending.lastProgressAt = performance.now();
        if (event.data.type === "heartbeat") return;
        if (event.data.type === "initialized") {
          clearTimeout(pending.timeout);
          pendingWorkerRequests.delete(event.data.requestId);
          pending.onInitialized?.();
        }
        if (event.data.type === "rebuildResult") {
          clearTimeout(pending.timeout);
          pendingWorkerRequests.delete(event.data.requestId);
          pending.onResult?.(event.data.result);
        }
        if (event.data.type === "error") {
          clearTimeout(pending.timeout);
          pendingWorkerRequests.delete(event.data.requestId);
          pending.onError?.(event.data.message);
        }
      } catch (error) {
        failPendingWorkerRequests(error instanceof Error ? error.message : String(error));
      }
    };
    geometryWorker.onerror = (event) => {
      failPendingWorkerRequests(event.message || "Geometry worker failed.");
    };
    geometryWorker.onmessageerror = () => {
      failPendingWorkerRequests("Geometry worker sent an unreadable response.");
    };
  }
  return geometryWorker;
}

function failPendingWorkerRequests(message: string) {
  const pendingRequests = [...pendingWorkerRequests.values()];
  for (const pending of pendingRequests) clearTimeout(pending.timeout);
  pendingWorkerRequests.clear();
  geometryWorker?.terminate();
  geometryWorker = undefined;
  workerEpoch += 1;
  kernelInitialized = false;
  kernelInitializing = false;
  for (const pending of pendingRequests) {
    pending.onError?.(message);
  }
}

export const useCadStore = create<CadStore>((set, get) => ({
  documentSession: 0,
  history: { past: [], present: initialDocument, future: [] },
  selection: { selectedIds: [] },
  rebuild: { status: initialRebuild.success ? "succeeded" : "failed", result: initialRebuild, kernelReady: false },
  fileError: undefined,
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setFileError: (message) => set({ fileError: message }),
  setDocument: (document) => {
    let bound: CadDocument;
    try {
      bound = bindDocumentExpressions(document);
    } catch (error) {
      set({ fileError: error instanceof Error ? error.message : String(error) });
      return;
    }
    set({ history: { past: [], present: bound, future: [] }, rebuild: { ...get().rebuild, result: undefined }, documentSession: get().documentSession + 1, selection: { selectedIds: [] }, fileError: undefined });
    get().rebuildNow();
  },
  updateDocument: (mutator) => {
    const { history } = get();
    let next: CadDocument;
    try {
      const changed = mutator(history.present);
      if (changed === history.present) return;
      next = bindDocumentExpressions(changed, history.present);
    } catch (error) {
      set({ fileError: error instanceof Error ? error.message : String(error) });
      return;
    }
    set({ history: { past: [...history.past, history.present].slice(-50), present: next, future: [] } });
    get().rebuildNow();
  },
  addParameter: () => {
    const base = "param";
    const existing = get().history.present.parameters;
    let index = Object.keys(existing).length + 1;
    let name = `${base}_${index}`;
    while (existing[name]) {
      index += 1;
      name = `${base}_${index}`;
    }
    get().updateDocument((document) =>
      upsertParameter(document, { id: createId("param"), name, expression: "10mm", value: 10, unit: "mm" }),
    );
  },
  updateParameter: (idOrName, patch) => {
    const before = get().history.present;
    get().updateDocument((document) => {
      const current = Object.values(document.parameters).find((parameter) => parameter.id === idOrName) ?? document.parameters[idOrName];
      if (!current) return document;
      const nextName = patch.name !== undefined ? patch.name.trim() : current.name;
      const next = nextName === current.name ? document : renameParameter(document, current.id, nextName);
      return upsertParameter(next, { ...next.parameters[nextName], ...patch, id: current.id, name: nextName });
    });
    if (get().history.present !== before) get().setFileError(undefined);
  },
  deleteParameter: (name) => get().updateDocument((document) => deleteParameterSafe(document, name)),
  undo: () => {
    const { history } = get();
    const previous = history.past.at(-1);
    if (!previous) return;
    set({
      history: {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      },
    });
    get().rebuildNow();
  },
  redo: () => {
    const { history } = get();
    const next = history.future[0];
    if (!next) return;
    set({
      history: {
        past: [...history.past, history.present].slice(-50),
        present: next,
        future: history.future.slice(1),
      },
    });
    get().rebuildNow();
  },
  select: (selection) => set({ selection: { selectedIds: selection ? [selection] : [] } }),
  initializeKernel: () => {
    if (kernelInitialized || kernelInitializing) return;
    const requestId = nextRequestId();
    latestKernelInitRequestId = requestId;
    kernelInitializing = true;
    set({ rebuild: { ...get().rebuild, status: "loadingKernel", message: "Loading CAD kernel...", kernelReady: false } });
    const worker = getGeometryWorker();
    if (worker) {
      pendingWorkerRequests.set(requestId, {
        kind: "initialize",
        requestId,
        epoch: workerEpoch,
        startedAt: performance.now(),
        lastProgressAt: performance.now(),
        timeoutMs: WORKER_TIMEOUTS_MS.initialize,
        maxElapsedMs: WORKER_TIMEOUTS_MS.initialize * 2,
        onError: (message) => {
          if (requestId !== latestKernelInitRequestId) return;
          kernelInitializing = false;
          set({
            rebuild: {
              status: "failed",
              result: {
                documentId: get().history.present.id,
                success: false,
                bodies: [],
                meshes: [],
                errors: [{ id: `worker:${requestId}`, source: "kernel", message }],
                warnings: [],
                durationMs: 0,
              },
              kernelReady: false,
              message,
            },
          });
        },
        onInitialized: () => {
          if (requestId !== latestKernelInitRequestId) return;
          kernelInitializing = false;
          kernelInitialized = true;
          set({ rebuild: { ...get().rebuild, status: "queued", kernelReady: true, message: "CAD kernel ready." } });
          flushQueuedRebuild(set, get);
        },
      });
      armWorkerTimeout(requestId);
      const request: WorkerRequest = createWorkerRequest({ type: "initialize" }, requestId, workerEpoch);
      worker.postMessage(request);
      return;
    }
    kernelInitializing = false;
    kernelInitialized = true;
    set({ rebuild: { ...get().rebuild, status: "queued", kernelReady: true, message: "CAD kernel unavailable; using fallback rebuild." } });
    flushQueuedRebuild(set, get);
  },
  rebuildNow: () => {
    queuedRebuildDocument = get().history.present;
    if (rebuildDebounce) clearTimeout(rebuildDebounce);
    set({ rebuild: { ...get().rebuild, status: kernelInitialized ? "queued" : "loadingKernel", message: kernelInitialized ? "Rebuild queued." : "Loading CAD kernel..." } });
    if (!kernelInitialized) {
      get().initializeKernel();
      return;
    }
    rebuildDebounce = setTimeout(() => flushQueuedRebuild(set, get), REBUILD_DEBOUNCE_MS);
  },
}));

function deleteParameterSafe(document: CadDocument, name: string): CadDocument {
  return removeParameter(document, name);
}

function flushQueuedRebuild(
  set: (partial: Partial<CadStore>) => void,
  get: () => CadStore,
) {
  if (rebuildDebounce) {
    clearTimeout(rebuildDebounce);
    rebuildDebounce = undefined;
  }
  // A worker failure resets kernel readiness before pending callbacks run.
  // Restart initialization before draining an edit queued behind that failure.
  if (!kernelInitialized) {
    get().initializeKernel();
    return;
  }
  const document = queuedRebuildDocument ?? get().history.present;
  queuedRebuildDocument = undefined;
  const requestId = nextRequestId();
  rebuildRequestId = requestId;
  for (const [pendingRequestId, pending] of pendingWorkerRequests) {
    if (pending.kind === "rebuild") {
      clearTimeout(pending.timeout);
      pendingWorkerRequests.delete(pendingRequestId);
    }
  }
  set({ rebuild: { ...get().rebuild, status: "rebuilding", kernelReady: kernelInitialized, message: "Rebuilding geometry..." } });
  const worker = getGeometryWorker();
  if (worker) {
    pendingWorkerRequests.set(requestId, {
      kind: "rebuild",
      requestId,
      epoch: workerEpoch,
      startedAt: performance.now(),
      lastProgressAt: performance.now(),
      timeoutMs: WORKER_TIMEOUTS_MS.rebuild,
      maxElapsedMs: WORKER_TIMEOUTS_MS.rebuild * 4,
      onResult: (result) => {
        if (requestId !== rebuildRequestId) return;
        if (get().history.present !== document) {
          queuedRebuildDocument ??= get().history.present;
          flushQueuedRebuild(set, get);
          return;
        }
        set({ rebuild: { status: result.success ? "succeeded" : "failed", result, kernelReady: kernelInitialized, message: result.success ? "Rebuild complete." : "Rebuild failed." } });
        if (queuedRebuildDocument) flushQueuedRebuild(set, get);
      },
      onError: (message) => {
        if (requestId !== rebuildRequestId) return;
        if (get().history.present !== document) {
          queuedRebuildDocument ??= get().history.present;
          flushQueuedRebuild(set, get);
          return;
        }
        set({
          rebuild: {
            status: "failed",
            result: {
              documentId: document.id,
              success: false,
              bodies: [],
              meshes: [],
              errors: [{ id: `worker:${requestId}`, source: "kernel", message }],
              warnings: [],
              durationMs: 0,
            },
            kernelReady: kernelInitialized,
            message,
          },
        });
      },
    });
    armWorkerTimeout(requestId);
    const request: WorkerRequest = createWorkerRequest({ type: "rebuild", document }, requestId, workerEpoch);
    worker.postMessage(request);
    return;
  }
  const result = rebuildDocument(document);
  set({ rebuild: { status: result.success ? "succeeded" : "failed", result, kernelReady: kernelInitialized, message: result.success ? "Rebuild complete." : "Rebuild failed." } });
}

function nextRequestId(): number {
  nextWorkerRequestId += 1;
  return nextWorkerRequestId;
}

function armWorkerTimeout(requestId: number) {
  const pending = pendingWorkerRequests.get(requestId);
  if (!pending) return;
  pending.timeout = setTimeout(() => {
    const current = pendingWorkerRequests.get(requestId);
    if (!current) return;
    if (!isWorkerRequestExpired(current, performance.now())) {
      armWorkerTimeout(requestId);
      return;
    }
    failPendingWorkerRequests(`${current.kind} timed out after ${current.timeoutMs}ms without worker progress.`);
  }, pending.timeoutMs);
}
