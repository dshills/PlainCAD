import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { bodyComponentId } from "../cad/document/components";
import { useCadStore } from "../state/useCadStore";
import { useInspectionState } from "../state/inspectionState";
import { useFileJobs } from "../persistence/fileJobs";
import * as repository from "../persistence/partLibrary";
import * as thumbnails from "../persistence/partLibraryThumbnail";
import * as worker from "../cad/worker/extrudePreviewClient";
import { importProjectText } from "../persistence/projectCodec";
import { applyLibraryPlacement, beginLibraryPlacement, beginPartLibrary, cancelLibraryPlacement, cancelPartLibrary, canOpenPartLibrary, removeSavedLibraryPart, renameSavedLibraryPart, saveActiveLibraryPart, usePartLibrary } from "../ui/commands/partLibraryCommand";
import { useTargetScopeCapture } from "../ui/commands/targetScopeCaptureCommand";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWv4sAAAAASUVORK5CYII=";
function native(document: CadDocument): RebuildResult {
  const result = rebuildDocument(document);
  return { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 80000, surfaceArea: 14000, solidCount: 1 } })) };
}
function setCurrent() {
  useCadStore.getState().setDocument(createBoxTemplate());
  const document = useCadStore.getState().history.present;
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: native(document) } });
  return document;
}
let entries: repository.PartLibraryEntry[];
beforeEach(() => {
  cancelPartLibrary(); useFileJobs.getState().cancel(); useInspectionState.setState({ picking: false }); useTargetScopeCapture.setState({ busy: false });
  setCurrent();
  const source = createBoxTemplate(); entries = [repository.createLibraryEntry(source, source.rootComponentId, "Saved block", png)];
  vi.spyOn(repository, "listLibrarySnapshot").mockImplementation(async () => ({ entries, damaged: [], limited: false }));
  vi.spyOn(repository, "saveLibraryPart").mockImplementation(async entry => { entries = [...entries.filter(item => item.id !== entry.id), entry]; });
  vi.spyOn(repository, "deleteLibraryPart").mockImplementation(async id => { entries = entries.filter(item => item.id !== id); });
  vi.spyOn(thumbnails, "libraryThumbnail").mockResolvedValue(png);
  vi.spyOn(worker, "previewModeling").mockImplementation(async document => native(document));
});
afterEach(() => { cancelPartLibrary(); vi.restoreAllMocks(); useCadStore.setState(useCadStore.getInitialState(), true); useInspectionState.setState({ picking: false }); useTargetScopeCapture.setState({ busy: false }); });
describe("library operation ownership and native insertion", () => {
  it("opens a bounded saved snapshot without changing the project", async () => {
    const document = useCadStore.getState().history.present;
    await beginPartLibrary();
    expect(usePartLibrary.getState().frame?.entries).toEqual(entries);
    expect(usePartLibrary.getState().frame?.busy).toBe(false);
    expect(useCadStore.getState().history.present).toBe(document);
  });
  it("blocks opening during measurement picking and other competing tasks", async () => {
    useInspectionState.setState({ picking: true });
    expect(canOpenPartLibrary(useCadStore.getState())).toBe(false); await beginPartLibrary(); expect(usePartLibrary.getState().frame).toBeUndefined();
    useInspectionState.setState({ picking: false }); useTargetScopeCapture.setState({ busy: true });
    expect(canOpenPartLibrary(useCadStore.getState())).toBe(false);
  });
  it("saves an independent portable active component with a native thumbnail without adding undo history", async () => {
    const document = useCadStore.getState().history.present, past = useCadStore.getState().history.past.length;
    await beginPartLibrary(); await saveActiveLibraryPart("New saved block");
    const added = usePartLibrary.getState().frame!.entries.find(entry => entry.name === "New saved block")!;
    expect(added).toBeDefined(); expect(importProjectText(added.text).features[0].id).not.toBe(document.features[0].id);
    expect(repository.saveLibraryPart).toHaveBeenCalledWith(added, expect.objectContaining({ newOnly: true, signal: expect.any(AbortSignal) }));
    expect(thumbnails.libraryThumbnail).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ geometrySource: "opencascade" })]));
    expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(past);
  });
  it("keeps the current document unchanged on save failures", async () => {
    const document = useCadStore.getState().history.present;
    vi.mocked(repository.saveLibraryPart).mockRejectedValue(new Error("Browser storage is full. The current project is unchanged."));
    await beginPartLibrary(); await saveActiveLibraryPart("New saved block");
    expect(usePartLibrary.getState().frame?.error).toMatch(/storage is full/);
    expect(usePartLibrary.getState().frame?.entries).toHaveLength(1); expect(useCadStore.getState().history.present).toBe(document);
  });
  it("refuses a storage write when the project changes during thumbnail encoding", async () => {
    let resolve!: (value: string) => void;
    vi.mocked(thumbnails.libraryThumbnail).mockImplementation(() => new Promise(done => { resolve = done; }));
    await beginPartLibrary(); const saving = saveActiveLibraryPart("Old snapshot");
    await vi.waitFor(() => expect(thumbnails.libraryThumbnail).toHaveBeenCalled());
    useCadStore.getState().updateDocument(document => ({ ...document, name: "Changed" }));
    resolve(png); await saving;
    expect(repository.saveLibraryPart).not.toHaveBeenCalled(); expect(usePartLibrary.getState().frame?.error).toMatch(/Project changed/);
  });
  it("stages a placed entire native candidate and applies independent IDs in exactly one undo step", async () => {
    const document = useCadStore.getState().history.present, past = useCadStore.getState().history.past.length;
    await beginPartLibrary(); await beginLibraryPlacement(entries[0].id, { x: 120, y: 35, z: 0 });
    const frame = usePartLibrary.getState().frame!, placement = frame.placement!;
    expect(useCadStore.getState().history.present).toBe(document);
    expect(placement.candidate.components[placement.componentId].placement?.translation).toEqual([120, 35, 0]);
    expect(worker.previewModeling).toHaveBeenCalledWith(placement.candidate, expect.any(AbortSignal));
    expect(placement.result?.meshes).toHaveLength(2);
    expect(placement.result!.meshes.some(mesh => bodyComponentId(placement.candidate, mesh.bodyId) === placement.componentId)).toBe(true);
    applyLibraryPlacement();
    expect(usePartLibrary.getState().frame).toBeUndefined();
    expect(useCadStore.getState().history.present.id).toBe(document.id);
    expect(useCadStore.getState().history.present.features).toHaveLength(2);
    expect(useCadStore.getState().history.present.features[1].id).not.toBe(document.features[0].id);
    expect(useCadStore.getState().history.present.parameters.width_2).toBeDefined();
    expect(useCadStore.getState().history.past).toHaveLength(past + 1);
    useCadStore.getState().undo(); expect(useCadStore.getState().history.present).toBe(document);
  });
  it("rejects fallback or invalid native preview geometry and never applies it", async () => {
    const document = useCadStore.getState().history.present;
    vi.mocked(worker.previewModeling).mockImplementation(async candidate => rebuildDocument(candidate));
    await beginPartLibrary(); await beginLibraryPlacement(entries[0].id);
    expect(usePartLibrary.getState().frame?.error).toMatch(/valid native solids/);
    expect(usePartLibrary.getState().frame?.placement?.result).toBeUndefined();
    applyLibraryPlacement(); expect(useCadStore.getState().history.present).toBe(document);
  });
  it("rejects a non-finite drop origin before starting the native worker", async () => {
    const document = useCadStore.getState().history.present;
    await beginPartLibrary(); await beginLibraryPlacement(entries[0].id, { x: NaN, y: 0, z: 0 });
    expect(worker.previewModeling).not.toHaveBeenCalled();
    expect(usePartLibrary.getState().frame?.error).toMatch(/finite placement limits/);
    expect(useCadStore.getState().history.present).toBe(document);
  });
  it("cancels a pending placement preview and ignores its late result", async () => {
    let resolve!: (result: RebuildResult) => void, candidate!: CadDocument;
    vi.mocked(worker.previewModeling).mockImplementation(document => { candidate = document; return new Promise(done => { resolve = done; }); });
    await beginPartLibrary(); const preview = beginLibraryPlacement(entries[0].id);
    await vi.waitFor(() => expect(worker.previewModeling).toHaveBeenCalled());
    const document = useCadStore.getState().history.present;
    cancelLibraryPlacement();
    expect(vi.mocked(worker.previewModeling).mock.calls[0][1].aborted).toBe(true);
    resolve(native(candidate)); await preview;
    expect(usePartLibrary.getState().frame?.placement).toBeUndefined(); expect(usePartLibrary.getState().frame?.busy).toBe(false);
    expect(useCadStore.getState().history.present).toBe(document);
  });
  it("refuses Apply after the target rebuild result or document has changed", async () => {
    await beginPartLibrary(); await beginLibraryPlacement(entries[0].id);
    const document = useCadStore.getState().history.present;
    useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: native(document) } });
    applyLibraryPlacement();
    expect(useCadStore.getState().history.present).toBe(document); expect(usePartLibrary.getState().frame?.error).toMatch(/Project changed/);
  });
  it("clears a still-owned busy frame if an aborted worker nevertheless resolves late", async () => {
    let resolve!: (result: RebuildResult) => void, candidate!: CadDocument;
    vi.mocked(worker.previewModeling).mockImplementation(document => { candidate = document; return new Promise(done => { resolve = done; }); });
    await beginPartLibrary(); const preview = beginLibraryPlacement(entries[0].id);
    await vi.waitFor(() => expect(worker.previewModeling).toHaveBeenCalled());
    useCadStore.getState().updateDocument(document => ({ ...document, name: "Changed while previewing" }));
    expect(vi.mocked(worker.previewModeling).mock.calls[0][1].aborted).toBe(true);
    resolve(native(candidate)); await preview;
    expect(usePartLibrary.getState().frame?.busy).toBe(false);
    expect(usePartLibrary.getState().frame?.placement?.result).toBeUndefined();
    expect(usePartLibrary.getState().frame?.error).toMatch(/cancelled because the project changed/);
  });
  it("renames and deletes saved copies without changing inserted or current project content", async () => {
    const document = useCadStore.getState().history.present;
    await beginPartLibrary(); const id = entries[0].id;
    await renameSavedLibraryPart(id, "Renamed block");
    expect(repository.saveLibraryPart).toHaveBeenCalledWith(expect.objectContaining({ id, name: "Renamed block" }), expect.objectContaining({ existingOnly: true }));
    expect(usePartLibrary.getState().frame?.entries[0].name).toBe("Renamed block");
    await removeSavedLibraryPart(id);
    expect(usePartLibrary.getState().frame?.entries).toEqual([]); expect(useCadStore.getState().history.present).toBe(document);
  });
  it("does not restore a closed library when asynchronous loading finishes", async () => {
    let resolve!: (value: repository.LibrarySnapshot) => void;
    vi.mocked(repository.listLibrarySnapshot).mockImplementation(() => new Promise(done => { resolve = done; }));
    const loading = beginPartLibrary();
    await vi.waitFor(() => expect(repository.listLibrarySnapshot).toHaveBeenCalled());
    cancelPartLibrary(); resolve({ entries, damaged: [], limited: false }); await loading;
    expect(usePartLibrary.getState().frame).toBeUndefined();
  });
});
