import { create } from "zustand";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { useCadStore } from "./useCadStore";

export interface AiFacePickFrame { document: CadDocument; result: RebuildResult; session: number; componentId: string }
export const useAiFacePicking = create<{ frame?: AiFacePickFrame; message?: string }>(() => ({}));
export function beginAiFacePicking() {
  const state = useCadStore.getState(), result = state.rebuild.result;
  if (state.fileBusy || state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== state.history.present.id ||
      !result.meshes.some(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid &&
        Number.isFinite(mesh.geometryAssertions.volume) && mesh.geometryAssertions.volume > 0 && Number.isInteger(mesh.geometryAssertions.solidCount) && mesh.geometryAssertions.solidCount > 0)) return false;
  useAiFacePicking.setState({ frame: { document: state.history.present, result, session: state.documentSession, componentId: state.activeComponentId }, message: "Click a supported planar face on the model." });
  return true;
}
export function clearAiFacePicking() { useAiFacePicking.setState({ frame: undefined, message: undefined }); }
export function currentAiFacePicking() {
  const state = useCadStore.getState(), frame = useAiFacePicking.getState().frame;
  return frame && state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && state.rebuild.result === frame.result && state.rebuild.status === "succeeded" && !state.fileBusy ? frame : undefined;
}
const unsubscribe = useCadStore.subscribe(() => { if (useAiFacePicking.getState().frame && !currentAiFacePicking()) clearAiFacePicking(); });

if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
