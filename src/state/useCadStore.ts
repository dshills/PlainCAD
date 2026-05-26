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
  status: "idle" | "queued" | "rebuilding" | "succeeded" | "failed";
  result?: RebuildResult;
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
  rebuildNow(): void;
}

const initialDocument = createEmptyDocument();
const initialRebuild = rebuildDocument(initialDocument);
let rebuildRequestId = 0;
let geometryWorker: Worker | undefined;
let latestWorkerResult: (requestId: number, result: RebuildResult) => void = () => undefined;
let latestWorkerError: (requestId: number, message: string) => void = () => undefined;

function getGeometryWorker(onResult: (requestId: number, result: RebuildResult) => void, onError: (requestId: number, message: string) => void): Worker | undefined {
  if (typeof Worker === "undefined") return undefined;
  latestWorkerResult = onResult;
  latestWorkerError = onError;
  if (!geometryWorker) {
    geometryWorker = new GeometryWorker();
    geometryWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === "rebuildResult") latestWorkerResult(event.data.requestId, event.data.result);
      if (event.data.type === "error") latestWorkerError(event.data.requestId, event.data.message);
    };
  }
  return geometryWorker;
}

export const useCadStore = create<CadStore>((set, get) => ({
  history: { past: [], present: initialDocument, future: [] },
  selection: { selectedIds: [] },
  rebuild: { status: initialRebuild.success ? "succeeded" : "failed", result: initialRebuild },
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
  rebuildNow: () => {
    const document = get().history.present;
    const requestId = rebuildRequestId + 1;
    rebuildRequestId = requestId;
    set({ rebuild: { ...get().rebuild, status: "rebuilding" } });
    const worker = getGeometryWorker(
      (responseId, result) => {
        if (responseId !== rebuildRequestId) return;
        set({ rebuild: { status: result.success ? "succeeded" : "failed", result } });
      },
      (responseId, message) => {
        if (responseId !== rebuildRequestId) return;
        set({
          rebuild: {
            status: "failed",
            result: {
              documentId: document.id,
              success: false,
              bodies: [],
              meshes: [],
              errors: [{ id: `worker:${responseId}`, source: "kernel", message }],
              warnings: [],
              durationMs: 0,
            },
          },
        });
      },
    );
    if (worker) {
      const request: WorkerRequest = { type: "rebuild", requestId, document };
      worker.postMessage(request);
      return;
    }
    const result = rebuildDocument(document);
    set({ rebuild: { status: result.success ? "succeeded" : "failed", result } });
  },
}));

function deleteParameterSafe(document: CadDocument, name: string): CadDocument {
  return removeParameter(document, name);
}
