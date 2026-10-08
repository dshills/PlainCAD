import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { NativeStepExport } from "../../cad/kernel/nativeStep";
export interface StepExportFrame {
  document: CadDocument;
  result: RebuildResult;
  session: number;
  bodyIds: string[];
  busy: boolean;
  prepared?: NativeStepExport;
  error?: string;
}
export const useStepExport = create<{ frame?: StepExportFrame }>(() => ({}));

/** File operation ownership remains runtime-only and outside the durable document. */
export const stepExportRuntime: { controller?: AbortController } = {};
