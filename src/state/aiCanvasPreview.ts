import { create } from "zustand";
import type { CadDocument, SelectionRef } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { useCadStore, type CadStore } from "./useCadStore";

/** A native proposal is temporary view data, never document or undo history. */
export interface AiCanvasPreview {
  document: CadDocument;
  session: number;
  componentId?: string;
  selection?: readonly SelectionRef[];
  beforeResult?: RebuildResult;
  result: RebuildResult;
  bodyIds: readonly string[];
}
export const useAiCanvasPreview = create<{
  preview?: AiCanvasPreview;
  mode: "before" | "after";
  setMode(mode: "before" | "after"): void;
}>((set) => ({ mode: "after", setMode: (mode) => set({ mode }) }));

function sameSelection(a: readonly SelectionRef[], b: readonly SelectionRef[]) {
  return a.length === b.length && a.every((item, index) =>
    item.id === b[index].id && item.kind === b[index].kind && item.documentId === b[index].documentId);
}
export function currentAiCanvasPreview(state: Pick<CadStore, "history" | "documentSession" | "activeComponentId" | "selection" | "fileBusy" | "rebuild">, preview = useAiCanvasPreview.getState().preview) {
  return preview && state.history.present === preview.document && state.documentSession === preview.session &&
    (preview.componentId === undefined || state.activeComponentId === preview.componentId) &&
    sameSelection(preview.selection ?? [], state.selection.selectedIds) && !state.fileBusy &&
    (state.rebuild.status === "succeeded" || (state.rebuild.status === "idle" && !preview.beforeResult && !state.history.present.features.length)) &&
    state.rebuild.result === preview.beforeResult && (preview.beforeResult !== undefined || !state.history.present.features.length)
    ? preview : undefined;
}
export function clearAiCanvasPreview(preview?: AiCanvasPreview) {
  if (!preview || useAiCanvasPreview.getState().preview === preview)
    useAiCanvasPreview.setState({ preview: undefined, mode: "after" });
}
/** Callers cancel the previous request before generating. A rejected late request
 * must not erase a newer accepted proposal owned by the current interaction. */
export function publishAiCanvasPreview(input: AiCanvasPreview): boolean {
  const state = useCadStore.getState();
  const result = input.result;
  if (result.documentId !== input.document.id || !result.success || result.errors.length || !result.meshes.length || result.meshes.some((mesh) =>
    mesh.geometrySource !== "opencascade" || mesh.geometryAssertions?.valid !== true ||
    !Number.isInteger(mesh.geometryAssertions.solidCount) || mesh.geometryAssertions.solidCount < 1 ||
    !Number.isFinite(mesh.geometryAssertions.volume) || mesh.geometryAssertions.volume <= 0)) return false;
  const bodyIds = [...new Set(input.bodyIds)];
  if (!bodyIds.length || bodyIds.some((id) => !result.meshes.some((mesh) => mesh.bodyId === id))) return false;
  const preview = { ...input, componentId: input.componentId ?? state.activeComponentId,
    selection: (input.selection ?? state.selection.selectedIds).map((item) => ({ ...item })),
    bodyIds };
  if (!currentAiCanvasPreview(state, preview)) return false;
  useAiCanvasPreview.setState({ preview, mode: "after" });
  return true;
}
// Release large mesh arrays promptly even when the viewport is not mounted.
useCadStore.subscribe((state) => {
  const preview = useAiCanvasPreview.getState().preview;
  if (preview && !currentAiCanvasPreview(state, preview)) clearAiCanvasPreview(preview);
});
