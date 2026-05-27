import { create } from "zustand";
import { CadDocument, SelectionState } from "../cad/document/schema";
import { createEmptyDocument, removeParameter, upsertParameter } from "../cad/document/CadDocument";
import { CadParameter } from "../cad/document/schema";
import { createId } from "../cad/document/ids";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { RebuildResult, WorkerRequest, WorkerResponse } from "../cad/worker/workerProtocol";
import GeometryWorker from "../cad/worker/geometryWorker?worker";

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

interface CadStore {
  history: HistoryState;
  selection: SelectionState;
  rebuild: RebuildState;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
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
let geometryWorker: Worker | undefined;
let kernelInitialized = false;
let kernelInitializing = false;
let queuedRebuildDocument: CadDocument | undefined;
let rebuildDebounce: ReturnType<typeof setTimeout> | undefined;
const pendingWorkerRequests = new Map<
  number,
  {
    kind: WorkerRequest["type"];
    onResult?: (result: RebuildResult) => void;
    onError?: (message: string) => void;
    onInitialized?: () => void;
  }
>();

function getGeometryWorker(): Worker | undefined {
  if (typeof Worker === "undefined") return undefined;
  if (!geometryWorker) {
    geometryWorker = new GeometryWorker();
    geometryWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      try {
        const pending = pendingWorkerRequests.get(event.data.requestId);
        if (!pending) return;
        if (event.data.type === "initialized") {
          pendingWorkerRequests.delete(event.data.requestId);
          pending.onInitialized?.();
        }
        if (event.data.type === "rebuildResult") {
          pendingWorkerRequests.delete(event.data.requestId);
          pending.onResult?.(event.data.result);
        }
        if (event.data.type === "error") {
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
  pendingWorkerRequests.clear();
  geometryWorker?.terminate();
  geometryWorker = undefined;
  kernelInitialized = false;
  kernelInitializing = false;
  for (const pending of pendingRequests) {
    pending.onError?.(message);
  }
}

export const useCadStore = create<CadStore>((set, get) => ({
  history: { past: [], present: initialDocument, future: [] },
  selection: { selectedIds: [] },
  rebuild: { status: initialRebuild.success ? "succeeded" : "failed", result: initialRebuild, kernelReady: false },
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setDocument: (document) => {
    set({ history: { past: [], present: document, future: [] } });
    get().rebuildNow();
  },
  updateDocument: (mutator) => {
    const { history } = get();
    const next = mutator(history.present);
    set({
      history: {
        past: [...history.past, history.present].slice(-50),
        present: next,
        future: [],
      },
    });
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
  updateParameter: (name, patch) => {
    get().updateDocument((document) => {
      const current = document.parameters[name];
      if (!current) return document;
      const nextName = patch.name ?? current.name;
      let next = removeParameter(document, name);
      next = upsertParameter(next, { ...current, ...patch, name: nextName });
      return next;
    });
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
      const request: WorkerRequest = { type: "initialize", requestId };
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
    rebuildDebounce = setTimeout(() => flushQueuedRebuild(set, get), 180);
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
  const document = queuedRebuildDocument ?? get().history.present;
  queuedRebuildDocument = undefined;
  const requestId = nextRequestId();
  rebuildRequestId = requestId;
  for (const [pendingRequestId, pending] of pendingWorkerRequests) {
    if (pending.kind === "rebuild") pendingWorkerRequests.delete(pendingRequestId);
  }
  set({ rebuild: { ...get().rebuild, status: "rebuilding", kernelReady: kernelInitialized, message: "Rebuilding geometry..." } });
  const worker = getGeometryWorker();
  if (worker) {
    pendingWorkerRequests.set(requestId, {
      kind: "rebuild",
      onResult: (result) => {
        if (requestId !== rebuildRequestId) return;
        set({ rebuild: { status: result.success ? "succeeded" : "failed", result, kernelReady: kernelInitialized, message: result.success ? "Rebuild complete." : "Rebuild failed." } });
        if (queuedRebuildDocument) flushQueuedRebuild(set, get);
      },
      onError: (message) => {
        if (requestId !== rebuildRequestId) return;
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
    const request: WorkerRequest = { type: "rebuild", requestId, document };
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
