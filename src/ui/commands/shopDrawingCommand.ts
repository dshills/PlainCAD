import type { CadDocument } from "../../cad/document/schema";
import { bodyComponentId } from "../../cad/document/components";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { ShopDrawing } from "../../cad/inspection/shopDrawing";
import { generateDrawing } from "../../fabrication/drawingClient";
import { downloadArrayBuffer } from "../../persistence/exportProject";
import { safeFilename } from "../../persistence/filenames";
import { useCadStore } from "../../state/useCadStore";
import { nativeTaskReady } from "./nativeTaskAvailability";
import { useShopDrawing, type DrawingSession } from "./shopDrawingState";
export { useShopDrawing } from "./shopDrawingState";
export interface DrawingFrame { owner: DrawingSession; document: CadDocument; result: RebuildResult; bodyId: string; sectionHeight?: number }
export interface DrawingPreview { frame: DrawingFrame; drawing: ShopDrawing }
const issued = new WeakSet<DrawingPreview>();
export function canOpenDrawing(state = useCadStore.getState()) { return nativeTaskReady(state); }
export function beginDrawing() {
  const state = useCadStore.getState(); if (!canOpenDrawing(state)) throw new Error("Finish the current task and wait for a valid native model before creating a drawing.");
  const selected = state.selection.selectedIds.find(selection => selection.documentId === state.history.present.id && selection.kind === "body" && state.rebuild.result!.meshes.some(mesh => mesh.bodyId === selection.id));
  const componentBody = state.rebuild.result!.meshes.find(mesh => bodyComponentId(state.history.present, mesh.bodyId) === state.activeComponentId);
  useShopDrawing.setState({ frame: { session: state.documentSession, documentId: state.history.present.id, bodyId: selected?.id ?? componentBody?.bodyId ?? state.rebuild.result!.meshes[0].bodyId } });
}
export function cancelDrawing() { useShopDrawing.setState({ frame: undefined }); }
export function currentDrawingSession(owner: DrawingSession) { const state = useCadStore.getState(); return useShopDrawing.getState().frame === owner && state.documentSession === owner.session && state.history.present.id === owner.documentId; }
export function captureDrawingFrame(owner: DrawingSession, bodyId: string, sectionHeight?: number): DrawingFrame {
  const state = useCadStore.getState(); if (!currentDrawingSession(owner) || !nativeTaskReady(state, "drawing") || !state.rebuild.result!.meshes.some(mesh => mesh.bodyId === bodyId)) throw new Error("Wait for current native geometry or reselect a current drawing part.");
  if (sectionHeight !== undefined && !Number.isFinite(sectionHeight)) throw new Error("Section height must be a finite millimeter value or blank for automatic.");
  return { owner, document: state.history.present, result: state.rebuild.result!, bodyId, sectionHeight };
}
export function currentDrawingFrame(frame: DrawingFrame) { const state = useCadStore.getState(); return currentDrawingSession(frame.owner) && nativeTaskReady(state, "drawing") && state.history.present === frame.document && state.rebuild.result === frame.result; }
export async function previewShopDrawing(frame: DrawingFrame, signal: AbortSignal, progress: (message: string) => void): Promise<DrawingPreview> {
  if (!currentDrawingFrame(frame)) throw new Error("Drawing source became stale. Reopen the drawing task.");
  const drawing = await generateDrawing({ session: frame.owner.session, document: frame.document, bodyId: frame.bodyId, sectionHeight: frame.sectionHeight }, signal, progress);
  if (signal.aborted || !currentDrawingFrame(frame)) throw new Error("Drawing canceled or became stale.");
  const preview = { frame, drawing }; issued.add(preview); return preview;
}
export function downloadShopDrawing(preview: DrawingPreview, kind: "svg" | "csv") {
  if (!issued.has(preview) || !currentDrawingFrame(preview.frame)) throw new Error("Wait for a current native drawing before downloading.");
  const value = kind === "svg" ? preview.drawing.svg : preview.drawing.bomCsv, bytes = new TextEncoder().encode(value).buffer;
  downloadArrayBuffer(bytes, safeFilename(`${preview.frame.document.name}--${kind === "svg" ? preview.drawing.name : "parts-list"}`, kind === "svg" ? ".svg" : ".csv"), kind === "svg" ? "image/svg+xml" : "text/csv;charset=utf-8");
}
