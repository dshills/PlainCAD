import type { CadStore } from "../../state/useCadStore";
import { useCadStore } from "../../state/useCadStore";
import { bodyComponentId } from "../../cad/document/components";
import { withComponentPlacement, IDENTITY_PLACEMENT } from "../../cad/document/componentPlacement";
import type { Point3 } from "../../cad/sketch/planes";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { appendProject } from "../../persistence/appendProject";
import { importProjectText } from "../../persistence/projectCodec";
import { clearLibraryParts, createLibraryEntry, decodeLibraryEntry, deleteDamagedLibraryPart, deleteLibraryPart, listLibrarySnapshot, partLibraryName, saveLibraryPart } from "../../persistence/partLibrary";
import { libraryThumbnail } from "../../persistence/partLibraryThumbnail";
import { usePartLibrary, type PartLibraryFrame } from "./partLibraryState";
import { interactionDraftBusy } from "./interactionDraftState";
import { operationDraftBusy } from "./operationDropCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useProjectDrop } from "./projectDropCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { useFileJobs } from "../../persistence/fileJobs";
export { usePartLibrary } from "./partLibraryState";
export { readPartLibraryDragId } from "../../persistence/partLibrary";
export const PART_LIBRARY_DRAG_TYPE = "application/x-plaincad-library-part";
let previewController: AbortController | undefined;
let storageController: AbortController | undefined;
function competingTask() {
  return Boolean(useExtrudeDraft.getState().draft || useHoleDraft.getState().draft || useModelingDraft.getState().draft || useGuidedHole.getState().draft || useTargetScopeCapture.getState().busy || operationDraftBusy() || interactionDraftBusy("partLibrary") || useSketchCanvas.getState().active || useProjectWorkflow.getState().active || useProjectDrop.getState().pending || useFileJobs.getState().exportOpen);
}
export function canOpenPartLibrary(state: CadStore) {
  return !state.fileBusy && !competingTask() && !usePartLibrary.getState().frame;
}
export function libraryFrameCurrent(frame: PartLibraryFrame, state = useCadStore.getState()) {
  return state.history.present === frame.document && state.documentSession === frame.session && state.activeComponentId === frame.componentId && state.rebuild.result === frame.result && !state.fileBusy && !competingTask();
}
function nativeCurrent(frame: PartLibraryFrame, state = useCadStore.getState()) {
  return libraryFrameCurrent(frame, state) && state.rebuild.status === "succeeded" && state.rebuild.kernelReady && frame.result?.success && frame.result.documentId === frame.document.id;
}
function showError(frame: PartLibraryFrame, error: unknown) {
  if (usePartLibrary.getState().frame === frame) usePartLibrary.setState({ frame: { ...frame, busy: false, error: error instanceof Error ? error.message : "Local part operation failed." } });
}
function storageOperation(frame: PartLibraryFrame) {
  storageController?.abort();
  const controller = new AbortController(); storageController = controller;
  const unsubscribe = useCadStore.subscribe(state => { if (!libraryFrameCurrent(frame, state)) controller.abort(); });
  return { signal: controller.signal, finish: () => { unsubscribe(); if (storageController === controller) storageController = undefined; } };
}
export async function beginPartLibrary() {
  const state = useCadStore.getState();
  if (!canOpenPartLibrary(state)) return;
  const frame: PartLibraryFrame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, result: state.rebuild.result, entries: [], damaged: [], limited: false, busy: true };
  usePartLibrary.setState({ frame });
  const operation = storageOperation(frame);
  try {
    const snapshot = await listLibrarySnapshot(operation.signal);
    if (usePartLibrary.getState().frame !== frame) return;
    if (!libraryFrameCurrent(frame)) throw new Error("Project changed while loading parts. Close and reopen the library.");
    usePartLibrary.setState({ frame: { ...frame, ...snapshot, busy: false } });
  } catch (error) { showError(frame, error); } finally { operation.finish(); }
}
export function cancelPartLibrary() {
  previewController?.abort(); previewController = undefined;
  storageController?.abort(); storageController = undefined;
  usePartLibrary.setState({ frame: undefined });
}
export async function saveActiveLibraryPart(name: string) {
  const current = usePartLibrary.getState().frame;
  if (!current || current.busy || current.placement) return;
  const frame = { ...current, busy: true, error: undefined, notice: undefined };
  usePartLibrary.setState({ frame });
  const operation = storageOperation(frame);
  try {
    if (!nativeCurrent(frame)) throw new Error("Wait for the current project to rebuild successfully, then reopen the library to save its active component.");
    const meshes = frame.result!.meshes.filter(mesh => bodyComponentId(frame.document, mesh.bodyId) === frame.componentId);
    const thumbnail = await libraryThumbnail(meshes);
    if (usePartLibrary.getState().frame !== frame) return;
    if (!nativeCurrent(frame)) throw new Error("Project changed during thumbnail rendering. Reopen the library and save the current component.");
    const entry = createLibraryEntry(frame.document, frame.componentId, name, thumbnail);
    await saveLibraryPart(entry, { signal: operation.signal, newOnly: true });
    if (usePartLibrary.getState().frame !== frame) return;
    const entries = [...frame.entries, entry].sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
    usePartLibrary.setState({ frame: { ...frame, entries, busy: false, notice: `Saved ${entry.name} locally. The current project is unchanged.` } });
  } catch (error) { showError(frame, error); } finally { operation.finish(); }
}
export async function renameSavedLibraryPart(id: string, name: string) {
  const current = usePartLibrary.getState().frame, entry = current?.entries.find(item => item.id === id);
  if (!current || !entry || current.busy || current.placement || !libraryFrameCurrent(current)) return;
  const frame = { ...current, busy: true, error: undefined, notice: undefined };
  usePartLibrary.setState({ frame });
  const operation = storageOperation(frame);
  try {
    const renamed = { ...entry, name: partLibraryName(name) };
    await saveLibraryPart(renamed, { signal: operation.signal, existingOnly: true });
    if (usePartLibrary.getState().frame === frame) usePartLibrary.setState({ frame: { ...frame, entries: frame.entries.map(item => item.id === id ? renamed : item), busy: false, notice: `Renamed saved part to ${renamed.name}.` } });
  } catch (error) { showError(frame, error); } finally { operation.finish(); }
}
export async function recoverLibraryPart(key?: string | number) {
  const current = usePartLibrary.getState().frame;
  if (!current || current.busy || current.placement || !libraryFrameCurrent(current) || !current.damaged.some(entry => entry.key === key)) return;
  const frame = { ...current, busy: true, error: undefined, notice: undefined };
  usePartLibrary.setState({ frame });
  const operation = storageOperation(frame);
  try {
    if (key === undefined) throw new Error("This damaged entry has an unsupported storage key. Use Delete all saved library copies to reset the library.");
    await deleteDamagedLibraryPart(key, operation.signal);
    const snapshot = await listLibrarySnapshot(operation.signal);
    if (usePartLibrary.getState().frame !== frame) return;
    if (!libraryFrameCurrent(frame)) throw new Error("Project changed during library recovery. Close and reopen the library.");
    usePartLibrary.setState({ frame: { ...frame, ...snapshot, busy: false, notice: "Deleted the damaged saved copy. The current project is unchanged." } });
  } catch (error) { showError(frame, error); } finally { operation.finish(); }
}
export async function resetDamagedLibrary() {
  const current = usePartLibrary.getState().frame;
  if (!current || current.busy || current.placement || !libraryFrameCurrent(current) || (!current.damaged.length && !current.limited)) return;
  const frame = { ...current, busy: true, error: undefined, notice: undefined };
  usePartLibrary.setState({ frame });
  const operation = storageOperation(frame);
  try {
    await clearLibraryParts(operation.signal);
    if (usePartLibrary.getState().frame === frame) usePartLibrary.setState({ frame: { ...frame, entries: [], damaged: [], limited: false, busy: false, notice: "Deleted all saved library copies. The current project and inserted components are unchanged." } });
  } catch (error) { showError(frame, error); } finally { operation.finish(); }
}
export async function removeSavedLibraryPart(id: string) {
  const current = usePartLibrary.getState().frame;
  if (!current || !current.entries.some(item => item.id === id) || current.busy || current.placement || !libraryFrameCurrent(current)) return;
  const frame = { ...current, busy: true, error: undefined, notice: undefined };
  usePartLibrary.setState({ frame });
  const operation = storageOperation(frame);
  try {
    await deleteLibraryPart(id, operation.signal);
    if (usePartLibrary.getState().frame === frame) usePartLibrary.setState({ frame: { ...frame, entries: frame.entries.filter(item => item.id !== id), busy: false, notice: "Deleted saved copy. Inserted components and the current project are unchanged." } });
  } catch (error) { showError(frame, error); } finally { operation.finish(); }
}
export function assertLibraryPlacementResult(result: RebuildResult, frame: PartLibraryFrame) {
  const placement = frame.placement;
  if (!placement || result.documentId !== placement.candidate.id || !result.success) throw new Error(result.errors.map(error => error.message).join(" ") || "Insertion preview failed. Repair the saved part or current project.");
  const inserted = result.meshes.filter(mesh => bodyComponentId(placement.candidate, mesh.bodyId) === placement.componentId);
  if (!inserted.length || result.meshes.some(mesh => mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid || !(mesh.geometryAssertions.volume > 0) || !(mesh.geometryAssertions.solidCount > 0))) throw new Error("Insertion preview must produce valid native solids for the saved component and current project.");
}
export async function beginLibraryPlacement(id: string, origin: Point3 = { x: 0, y: 0, z: 0 }) {
  const current = usePartLibrary.getState().frame;
  if (!current || current.busy || current.placement || !libraryFrameCurrent(current)) return;
  const rawEntry = current.entries.find(item => item.id === id);
  if (!rawEntry) return;
  let frame = current;
  try {
    if (!nativeCurrent(current)) throw new Error("Insertion requires a current successful native rebuild. Reopen the library after rebuilding.");
    const entry = decodeLibraryEntry(rawEntry), source = importProjectText(entry.text);
    const copied = appendProject(current.document, source, { componentId: source.rootComponentId });
    const componentId = copied.componentIds[0];
    if (!componentId) throw new Error("Saved part has no component to insert.");
    const original = copied.document.components[componentId].placement ?? IDENTITY_PLACEMENT;
    const candidate = withComponentPlacement(copied.document, componentId, { translation: [origin.x, origin.y, origin.z], rotation: [...original.rotation] });
    frame = { ...current, busy: true, error: undefined, notice: undefined, placement: { entry, origin: { ...origin }, candidate, componentId } };
    usePartLibrary.setState({ frame });
    previewController?.abort();
    const controller = new AbortController(); previewController = controller;
    const unsubscribe = useCadStore.subscribe(state => { if (!libraryFrameCurrent(frame, state)) controller.abort(); });
    try {
      const result = await previewModeling(candidate, controller.signal);
      if (usePartLibrary.getState().frame !== frame) return;
      if (controller.signal.aborted) throw new Error("Insertion preview was cancelled because the project changed. Cancel and reopen the library.");
      if (!nativeCurrent(frame)) throw new Error("Project changed during native insertion preview. Cancel and reopen the library.");
      assertLibraryPlacementResult(result, frame);
      usePartLibrary.setState({ frame: { ...frame, busy: false, placement: { ...frame.placement!, result } } });
    } finally { unsubscribe(); if (previewController === controller) previewController = undefined; }
  } catch (error) { showError(frame, error); }
}
export function cancelLibraryPlacement() {
  const frame = usePartLibrary.getState().frame;
  if (!frame) return;
  previewController?.abort(); previewController = undefined;
  usePartLibrary.setState({ frame: { ...frame, busy: false, placement: undefined, error: undefined } });
}
export function applyLibraryPlacement() {
  const frame = usePartLibrary.getState().frame, state = useCadStore.getState();
  if (!frame?.placement?.result || frame.busy) return;
  try {
    if (!nativeCurrent(frame, state)) throw new Error("Project changed after insertion preview. Cancel and reopen the library.");
    assertLibraryPlacementResult(frame.placement.result, frame);
    const { candidate, componentId } = frame.placement;
    state.updateDocument(document => {
      if (document !== frame.document) throw new Error("Project changed before insertion.");
      return candidate;
    });
    if (useCadStore.getState().history.present === frame.document) throw new Error(useCadStore.getState().fileError ?? "Part insertion could not be applied.");
    state.activateComponent(componentId);
    cancelPartLibrary();
  } catch (error) { showError(frame, error); }
}
