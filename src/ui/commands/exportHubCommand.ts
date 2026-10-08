import type { CadStore } from "../../state/useCadStore";
import { useCadStore } from "../../state/useCadStore";
import { useFileJobs } from "../../persistence/fileJobs";
import { runCommand, canExportStl } from "./commandRegistry";
import { selectedCanvasSketch, useSketchCanvas } from "./sketchCanvasCommand";
export type ExportHubGoal = "project" | "stl" | "step" | "image" | "library";
export type ExportHubImageScope = "project" | "body" | "sketch";
export function captureExportHub(state: CadStore = useCadStore.getState()) {
    const selection = state.selection.selectedIds[0];
    return { document: state.history.present, session: state.documentSession, result: state.rebuild.result, selection: selection ? { kind: selection.kind, id: selection.id, documentId: selection.documentId } : undefined };
}
export type ExportHubSnapshot = ReturnType<typeof captureExportHub>;
export function exportHubCurrent(snapshot: ExportHubSnapshot, state = useCadStore.getState()) {
    const selection = state.selection.selectedIds[0];
    return state.history.present === snapshot.document && state.documentSession === snapshot.session && state.rebuild.result === snapshot.result && selection?.kind === snapshot.selection?.kind && selection?.id === snapshot.selection?.id && selection?.documentId === snapshot.selection?.documentId && !state.fileBusy;
}
export function exportHubAvailability(state = useCadStore.getState()) {
    const result = state.rebuild.result, selection = state.selection.selectedIds[0];
    const model = canExportStl(state);
    const bodyId = selection?.kind === "body" && selection.documentId === state.history.present.id && result?.meshes.some(mesh => mesh.bodyId === selection.id) ? selection.id : undefined;
    const sketch = selectedCanvasSketch(state);
    const step = model && Boolean(result?.stepExportAvailable && result.meshes.length && result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid && mesh.geometryAssertions.volume > 0 && mesh.geometryAssertions.solidCount > 0)) && typeof Worker !== "undefined";
    return { step, projectImage: model, bodyImage: model && Boolean(bodyId), bodyId, sketchId: sketch?.id, sketchName: sketch?.name, library: typeof indexedDB !== "undefined" };
}
/** End the hub before shared command guards run; no task or download is claimed here. */
export async function handoffExportHub(snapshot: ExportHubSnapshot, goal: Exclude<ExportHubGoal, "project" | "stl">, image: ExportHubImageScope = "project") {
    const state = useCadStore.getState(), availability = exportHubAvailability(state);
    if (state.fileBusy) {
        state.setFileError("Another file task is running. Wait for it to finish before continuing.");
        return;
    }
    if (!useFileJobs.getState().exportOpen || !exportHubCurrent(snapshot) || useSketchCanvas.getState().active) {
        state.setFileError("Project, selection or model changed. Reopen Save or export before continuing.");
        return;
    }
    const ready = goal === "step" ? availability.step : goal === "library" ? availability.library : image === "project" ? availability.projectImage : image === "body" ? availability.bodyImage : Boolean(availability.sketchId);
    if (!ready) {
        state.setFileError("This output is not ready. Follow its selection or rebuild guidance before continuing.");
        return;
    }
    useFileJobs.setState({ exportOpen: false, prepared: undefined, preparedFor: undefined });
    // Store subscribers can replace a project/selection as the modal closes.
    if (!exportHubCurrent(snapshot) || useSketchCanvas.getState().active) {
        useCadStore.getState().setFileError("Project or selection changed while switching file tasks. Reopen Save or export.");
        return;
    }
    const command = goal === "step" ? "file.exportStep" : goal === "library" ? "partLibrary" : image === "sketch" ? "sketch.editCanvas" : image === "body" ? "file.exportBodyPng" : "file.exportProjectPng";
    try {
        await runCommand(command);
    }
    catch (error) {
        useCadStore.getState().setFileError(error instanceof Error ? error.message : "The file task could not be opened.");
    }
}
