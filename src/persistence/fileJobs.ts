import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { create } from "zustand";
import { useCadStore } from "../state/useCadStore";
import { exportFabrication } from "../fabrication/exportClient";
import type { FabricationResult, StlMode } from "../fabrication/exportPlan";
import { downloadArrayBuffer } from "./exportProject";
import { selectFabricationBodies } from "../fabrication/bodySelection";
export interface FileJobState {
  busy: boolean;
  message?: string;
  exportOpen: boolean;
  exportSession?: number;
  exportBodyIds?: string[];
  prepared?: FabricationResult;
  preparedFor?: {
    document: CadDocument;
    result: RebuildResult;
    session: number;
  };
  cancel: () => void;
}
let active: AbortController | undefined;
export const useFileJobs = create<FileJobState>(() => ({
  busy: false,
  exportOpen: false,
  cancel: () => {
    active?.abort();
    active = undefined;
    useFileJobs.setState({
      busy: false,
      message: undefined,
      prepared: undefined,
      preparedFor: undefined,
    });
  },
}));
useFileJobs.subscribe((state, previous) => {
  if (state.busy !== previous.busy)
    useCadStore.setState({ fileBusy: state.busy });
});
export function beginFileJob(message: string): AbortController {
  active?.abort();
  active = new AbortController();
  useFileJobs.setState({
    busy: true,
    message,
    prepared: undefined,
    preparedFor: undefined,
  });
  return active;
}
export function finishFileJob(controller: AbortController) {
  if (active !== controller) return;
  active = undefined;
  useFileJobs.setState({ busy: false, message: undefined });
}
export function fileJobCurrent(controller: AbortController) {
  return active === controller && !controller.signal.aborted;
}
export function downloadPrepared(result: FabricationResult) {
  const jobs = useFileJobs.getState(),
    current = useCadStore.getState();
  if (
    jobs.prepared === result &&
    (current.history.present !== jobs.preparedFor?.document ||
      current.rebuild.result !== jobs.preparedFor?.result ||
      current.documentSession !== jobs.preparedFor?.session ||
      current.rebuild.status !== "succeeded")
  ) {
    current.setFileError(
      "Model changed after validation. Generate STL again before downloading.",
    );
    useFileJobs.setState({ prepared: undefined, preparedFor: undefined });
    return;
  }
  downloadArrayBuffer(
    result.file.bytes,
    result.file.filename,
    result.file.filename.endsWith(".zip") ? "application/zip" : "model/stl",
  );
  useFileJobs.setState({
    prepared: undefined,
    preparedFor: undefined,
    exportOpen: false,
  });
}
export function openFabrication() {
  const state = useCadStore.getState();
  useFileJobs.setState({
    exportOpen: true,
    exportSession: state.documentSession,
    exportBodyIds:
      state.rebuild.result?.meshes.map((mesh) => mesh.bodyId) ?? [],
    prepared: undefined,
    preparedFor: undefined,
  });
}
export async function runFabrication(
  mode: StlMode = "separate",
  fullChecks = true,
  bodyIds?: readonly string[],
  expectedSession = useCadStore.getState().documentSession,
) {
  const state = useCadStore.getState(),
    document = state.history.present,
    result = state.rebuild.result;
  if (state.fileBusy) return;
  if (state.documentSession !== expectedSession) {
    state.setFileError(
      "Project replaced. Reopen STL export to select its bodies.",
    );
    return;
  }
  if (
    state.rebuild.status !== "succeeded" ||
    !state.rebuild.kernelReady ||
    !result?.success ||
    result.documentId !== document.id
  )
    return;
  const controller = beginFileJob("Preparing STL export…");
  state.setFileError(undefined);
  try {
    const selected = selectFabricationBodies(
      result.meshes,
      result.bodies,
      bodyIds,
    );
    const output = await exportFabrication(
      {
        document,
        meshes: selected.meshes,
        bodies: selected.bodies,
        bodyIds: bodyIds ? [...bodyIds] : undefined,
        mode,
        fullChecks,
      },
      controller.signal,
      (message) => {
        if (fileJobCurrent(controller)) useFileJobs.setState({ message });
      },
    );
    if (!fileJobCurrent(controller)) return;
    if (
      useCadStore.getState().history.present !== document ||
      useCadStore.getState().documentSession !== expectedSession ||
      useCadStore.getState().rebuild.result !== result
    )
      throw new Error(
        "Model changed during export. Export the current rebuilt model again.",
      );
    if (output.warnings.length && mode !== "separate")
      useFileJobs.setState({
        exportSession: expectedSession,
        exportBodyIds: selected.meshes.map((mesh) => mesh.bodyId),
        prepared: output,
        preparedFor: { document, result, session: expectedSession },
        exportOpen: true,
      });
    else {
      downloadPrepared(output);
      if (output.warnings.length) state.setFileError(output.warnings.join(" "));
    }
  } catch (error) {
    if (fileJobCurrent(controller))
      state.setFileError(
        error instanceof Error ? error.message : "STL export failed.",
      );
  } finally {
    finishFileJob(controller);
  }
}
