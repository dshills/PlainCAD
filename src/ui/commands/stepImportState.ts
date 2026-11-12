import { create } from "zustand";
import type { CadStore } from "../../state/useCadStore";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";

export interface StepImportPreview {
  document: CadDocument;
  result: RebuildResult;
  componentId: string;
  featureId: string;
}

export interface StepImportFrame {
  source: CadDocument;
  sourceResult?: RebuildResult;
  session: number;
  busy: boolean;
  name?: string;
  preview?: StepImportPreview;
  error?: string;
}

export const useStepImport = create<{ frame?: StepImportFrame }>(() => ({}));

export function stepImportNativeReady(state: CadStore) {
  const result = state.rebuild.result;
  // Kernel initialization flushes a rebuild even for an empty document.
  return state.rebuild.kernelReady && state.rebuild.status === "succeeded" &&
    Boolean(result?.success && result.stepImportAvailable &&
      result.documentId === state.history.present.id &&
      result.meshes.every(mesh => mesh.geometrySource === "opencascade"));
}
export function stepImportSourceMatches(frame: StepImportFrame, state: CadStore) {
  return state.history.present === frame.source && state.documentSession === frame.session &&
    state.rebuild.result === frame.sourceResult && stepImportNativeReady(state);
}
