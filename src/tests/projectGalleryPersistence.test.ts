import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { serializeProject } from "../persistence/exportProject";
import { recentGalleryProjects, rememberGalleryProject } from "../persistence/projectGallery";
import { libraryThumbnail } from "../persistence/partLibraryThumbnail";
import { listRecoveryRecords } from "../persistence/autosave";
import { importProjectFile } from "../persistence/importProject";
import type { RebuildResult } from "../cad/worker/workerProtocol";
vi.mock("../persistence/autosave", () => ({ listRecoveryRecords: vi.fn() }));
vi.mock("../persistence/importProject", () => ({ importProjectFile: vi.fn() }));
vi.mock("../persistence/partLibraryThumbnail", () => ({ libraryThumbnail: vi.fn(async () => {
  const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12); bytes[19] = 192; bytes[23] = 192;
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function hashMock() { vi.stubGlobal("crypto", webcrypto); }
describe("Gallery saved copies", () => {
  it("keeps valid manual copies visible when another saved copy is damaged", async () => {
    hashMock(); const document = createBoxTemplate();
    vi.mocked(listRecoveryRecords).mockResolvedValue([{ id: "damaged", manual: { text: "bad", savedAt: 2, name: "Bad", schemaVersion: 1 } }, { id: document.id, manual: { text: serializeProject(document, false), savedAt: 1, name: document.name, schemaVersion: document.schemaVersion } }]);
    vi.mocked(importProjectFile).mockImplementation(async file => { if (file.size === 3) throw new Error("Project file is not valid JSON."); return document; });
    const result = await recentGalleryProjects(new AbortController().signal);
    expect(result.projects).toHaveLength(1); expect(result.projects[0].id).toBe(document.id); expect(result.warnings).toHaveLength(1); expect(result.warnings[0]).toContain("Recovery");
  });
  it("never replaces malformed identities with project data", async () => {
    const document = createBoxTemplate();
    vi.mocked(listRecoveryRecords).mockResolvedValue([{ id: "other", manual: { text: "{}", savedAt: 1, name: "Wrong", schemaVersion: 1 } }]);
    vi.mocked(importProjectFile).mockResolvedValue(document);
    const result = await recentGalleryProjects(new AbortController().signal);
    expect(result.projects).toEqual([]); expect(result.warnings[0]).toContain("identity");
  });
  it("does not turn optional cover quota failures into save failures", async () => {
    hashMock(); const document = createBoxTemplate();
    const setItem = vi.fn(() => { throw new DOMException("Quota", "QuotaExceededError"); });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    await expect(rememberGalleryProject(document, { success: true, documentId: document.id, meshes: [{}] } as RebuildResult)).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledOnce();
  });
  it("does not fail a save if native cover rendering rejects", async () => {
    const document = createBoxTemplate();
    const setItem = vi.fn(); vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    vi.mocked(libraryThumbnail).mockRejectedValueOnce(new Error("No canvas"));
    await expect(rememberGalleryProject(document, { success: true, documentId: document.id, meshes: [{}] } as RebuildResult)).resolves.toBeUndefined();
    expect(libraryThumbnail).toHaveBeenCalledOnce(); expect(setItem).not.toHaveBeenCalled();
  });
  it("matches an actual saved cover by hash, declines stale text and caps the cover cache", async () => {
    hashMock(); let stored: string | null = null;
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
    const document = createBoxTemplate();
    await rememberGalleryProject(document, { success: true, documentId: document.id, meshes: [{}] } as RebuildResult);
    const snapshot = { text: serializeProject(document, false), savedAt: 1, name: document.name, schemaVersion: document.schemaVersion };
    vi.mocked(listRecoveryRecords).mockResolvedValue([{ id: document.id, manual: snapshot }]);
    vi.mocked(importProjectFile).mockResolvedValue(document);
    expect((await recentGalleryProjects(new AbortController().signal)).projects[0].thumbnail).toMatch(/^data:image\/png;base64,/);
    const edited = { ...document, name: "Edited project" };
    vi.mocked(listRecoveryRecords).mockResolvedValue([{ id: document.id, manual: { ...snapshot, text: serializeProject(edited, false) } }]);
    vi.mocked(importProjectFile).mockResolvedValue(edited);
    expect((await recentGalleryProjects(new AbortController().signal)).projects[0].thumbnail).toBeUndefined();
    for (let index = 0; index < 5; index++) { const next = createBoxTemplate(); await rememberGalleryProject(next, { success: true, documentId: next.id, meshes: [{}] } as RebuildResult); }
    expect(JSON.parse(stored!)).toHaveLength(5);
    expect(JSON.parse(stored!).some((entry: { id: string }) => entry.id === document.id)).toBe(false);
    stored = "{broken";
    expect((await recentGalleryProjects(new AbortController().signal)).projects[0].thumbnail).toBeUndefined();
  });
  it("cancels without swallowing the aborted import", async () => {
    const controller = new AbortController(); controller.abort();
    vi.mocked(listRecoveryRecords).mockResolvedValue([{ id: "a", manual: { text: "{}", savedAt: 1, name: "A", schemaVersion: 1 } }]);
    await expect(recentGalleryProjects(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(importProjectFile).not.toHaveBeenCalled();
  });
});
