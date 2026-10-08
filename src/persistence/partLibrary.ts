import type { CadDocument } from "../cad/document/schema";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createId } from "../cad/document/ids";
import { appendProject } from "./appendProject";
import { importProjectText } from "./projectCodec";
import { serializeProject } from "./exportProject";

export const PART_LIBRARY_DB = "plaincad-part-library";
export const PART_LIBRARY_STORE = "parts";
export const PART_LIBRARY_LIMITS = { entries: 50, totalBytes: 25 * 1024 * 1024, thumbnailBytes: 256 * 1024, thumbnailSide: 256 } as const;
export interface PartLibraryEntry {
  id: string;
  name: string;
  text: string;
  thumbnail: string;
  savedAt: number;
}
export interface DamagedLibraryEntry {
  key?: string | number;
  label: string;
  message: string;
}
export interface LibrarySnapshot {
  entries: PartLibraryEntry[];
  damaged: DamagedLibraryEntry[];
  limited: boolean;
}
function recoveryKey(key: unknown): string | number | undefined {
  return typeof key === "string" && key.length <= 1024 ? key : typeof key === "number" && Number.isFinite(key) ? key : undefined;
}
export function partLibraryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) throw new Error("Part name must contain 1–120 characters.");
  return trimmed;
}
export function readPartLibraryDragId(value: string): string | undefined {
  return /^[a-zA-Z0-9:_-]{1,160}$/.test(value) ? value : undefined;
}
/** Use the same independent-reference extraction as insertion; outside references fail explicitly. */
export function extractLibraryComponent(source: CadDocument, componentId: string, name: string): CadDocument {
  const title = partLibraryName(name);
  let copied: ReturnType<typeof appendProject>;
  try { copied = appendProject(createEmptyDocument(title), source, { componentId }); }
  catch (error) {
    if (error instanceof Error && error.message.includes("outside the selected component")) throw new Error(`${error.message} The library saves one self-contained component. To reuse the whole project, save its project file and use Insert a reusable part with All source components.`);
    throw error;
  }
  const id = copied.componentIds[0];
  if (!id || copied.componentIds.length !== 1) throw new Error("Choose one self-contained component to save.");
  const document: CadDocument = { ...copied.document, name: title, rootComponentId: id, components: { [id]: { ...copied.document.components[id], name: title } } };
  // The codec enforces portable size, unsafe keys, nesting, migration, and final storage validation.
  return importProjectText(serializeProject(document, false));
}
export function libraryEntryBytes(entry: PartLibraryEntry): number {
  return new TextEncoder().encode(entry.text).byteLength + new TextEncoder().encode(entry.thumbnail).byteLength + new TextEncoder().encode(entry.name).byteLength + entry.id.length + 16;
}
export function validateLibraryThumbnail(thumbnail: string): void {
  if (!thumbnail.startsWith("data:image/png;base64,") || thumbnail.length > Math.ceil(PART_LIBRARY_LIMITS.thumbnailBytes * 4 / 3) + 24)
    throw new Error("Part thumbnail must be a bounded PNG image.");
  const encoded = thumbnail.slice(22);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!encoded.length || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded) || encoded.slice(0, encoded.length - padding).includes("=")) throw new Error("Part thumbnail PNG encoding is invalid.");
  let bytes: string;
  try { bytes = atob(encoded); } catch { throw new Error("Part thumbnail PNG encoding is invalid."); }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || bytes.length > PART_LIBRARY_LIMITS.thumbnailBytes || signature.some((n, index) => bytes.charCodeAt(index) !== n) || bytes.slice(12, 16) !== "IHDR")
    throw new Error("Part thumbnail PNG header is invalid.");
  const size = (offset: number) => Array.from(bytes.slice(offset, offset + 4)).reduce((n, character) => n * 256 + character.charCodeAt(0), 0);
  if (![size(16), size(20)].every(n => n > 0 && n <= PART_LIBRARY_LIMITS.thumbnailSide)) throw new Error("Part thumbnail dimensions exceed 256 pixels.");
}
export function decodeLibraryEntry(value: unknown): PartLibraryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Library entry is invalid.");
  const entry = value as Partial<PartLibraryEntry>;
  if (typeof entry.id !== "string" || !readPartLibraryDragId(entry.id) || typeof entry.name !== "string" || partLibraryName(entry.name) !== entry.name || typeof entry.text !== "string" || typeof entry.thumbnail !== "string" || typeof entry.savedAt !== "number" || !Number.isFinite(entry.savedAt) || entry.savedAt < 0)
    throw new Error("Library entry metadata is invalid.");
  validateLibraryThumbnail(entry.thumbnail);
  const document = importProjectText(entry.text);
  if (Object.keys(document.components).length !== 1 || !Object.hasOwn(document.components, document.rootComponentId)) throw new Error("Library part must contain one self-contained component.");
  return { id: entry.id, name: entry.name, text: entry.text, thumbnail: entry.thumbnail, savedAt: entry.savedAt };
}
export function createLibraryEntry(document: CadDocument, componentId: string, name: string, thumbnail: string): PartLibraryEntry {
  return decodeLibraryEntry({ id: createId("library"), name: partLibraryName(name), text: serializeProject(extractLibraryComponent(document, componentId, name), false), thumbnail, savedAt: Date.now() });
}
export function assertLibraryBudget(entries: PartLibraryEntry[]): void {
  if (entries.length > PART_LIBRARY_LIMITS.entries) throw new Error("Part library is full (50 parts). Delete a saved part before adding another.");
  if (entries.reduce((sum, entry) => sum + libraryEntryBytes(entry), 0) > PART_LIBRARY_LIMITS.totalBytes) throw new Error("Part library exceeds its 25 MiB storage budget. Delete or simplify saved parts.");
}
function storageError(error: unknown): Error {
  return error instanceof DOMException && error.name === "QuotaExceededError"
    ? new Error("Browser storage is full. Free storage or delete saved parts; the current project is unchanged.")
    : error instanceof Error ? error : new Error("Part library storage failed; the current project is unchanged.");
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Local part storage is unavailable in this browser.")); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(PART_LIBRARY_DB, 1); } catch (error) { reject(storageError(error)); return; }
    let settled = false;
    const timeout = setTimeout(() => { settled = true; reject(new Error("Opening local part storage timed out.")); }, 8000);
    const fail = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timeout); reject(storageError(error)); } };
    request.onupgradeneeded = () => request.result.createObjectStore(PART_LIBRARY_STORE, { keyPath: "id" });
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true; clearTimeout(timeout);
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error("Local part storage is blocked by another browser tab."));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, done: (result: T) => void, fail: (error: unknown) => void) => void, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error("Local part operation was cancelled.");
  const db = await database();
  if (signal?.aborted) { db.close(); throw new Error("Local part operation was cancelled."); }
  return new Promise((resolve, reject) => {
    let result: T, tx: IDBTransaction;
    try { tx = db.transaction(PART_LIBRARY_STORE, mode); } catch (error) { db.close(); reject(storageError(error)); return; }
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort); db.close();
      if (error !== undefined) reject(storageError(error)); else resolve(result);
    };
    const fail = (error: unknown) => { try { tx.abort(); } catch { /* The completed transaction already owns its result. */ } finish(error); };
    const abort = () => fail(new Error("Local part operation was cancelled. The project is unchanged."));
    const timeout = setTimeout(() => fail(new Error("Local part storage transaction timed out.")), 8000);
    signal?.addEventListener("abort", abort, { once: true });
    tx.oncomplete = () => finish();
    tx.onerror = tx.onabort = () => finish(tx.error ?? new Error("Local part storage transaction failed."));
    try { action(tx.objectStore(PART_LIBRARY_STORE), value => { result = value; }, fail); } catch (error) { fail(error); }
  });
}
/** A cursor bounds reads too: damaged or externally modified IndexedDB cannot allocate an unbounded getAll. */
function readEntries(store: IDBObjectStore, done: (snapshot: LibrarySnapshot) => void, fail: (error: unknown) => void, recover = false) {
  const entries: PartLibraryEntry[] = [];
  const damaged: DamagedLibraryEntry[] = [];
  let scanned = 0, bytes = 0;
  const request = store.openCursor();
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (!cursor) { done({ entries, damaged, limited: false }); return; }
      if (++scanned > PART_LIBRARY_LIMITS.entries) {
        if (recover) { done({ entries, damaged, limited: true }); return; }
        throw new Error("Part library is full (50 parts). Delete saved parts before updating the library.");
      }
      let entry: PartLibraryEntry;
      try { entry = decodeLibraryEntry(cursor.value); }
      catch (error) {
        if (!recover) throw new Error("The library contains a damaged saved copy. Open the library and delete the damaged entry before saving parts.");
        const key = recoveryKey(cursor.key);
        damaged.push({ key, label: `Damaged saved entry ${key === undefined ? scanned : String(key).slice(0, 80)}`, message: (error instanceof Error ? error.message : "Saved entry is invalid.").slice(0, 500) });
        cursor.continue(); return;
      }
      bytes += libraryEntryBytes(entry);
      if (bytes > PART_LIBRARY_LIMITS.totalBytes) {
        if (!recover) throw new Error("Part library exceeds its 25 MiB storage budget. Delete or simplify saved parts.");
        damaged.push({ key: recoveryKey(cursor.key), label: entry.name, message: "This saved copy exceeds the remaining 25 MiB library loading budget. Delete saved copies and reopen the library." });
        done({ entries, damaged, limited: true }); return;
      }
      entries.push(entry); cursor.continue();
    } catch (error) { fail(error); }
  };
}
export function listLibrarySnapshot(signal?: AbortSignal): Promise<LibrarySnapshot> {
  return transaction("readonly", (store, done, fail) => readEntries(store, snapshot => done({ ...snapshot, entries: snapshot.entries.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id)) }), fail, true), signal);
}
export async function listLibraryParts(signal?: AbortSignal): Promise<PartLibraryEntry[]> {
  return (await listLibrarySnapshot(signal)).entries;
}
export async function saveLibraryPart(input: PartLibraryEntry, options: { signal?: AbortSignal; newOnly?: boolean; existingOnly?: boolean } = {}): Promise<void> {
  const entry = decodeLibraryEntry(input);
  return transaction("readwrite", (store, done, fail) => readEntries(store, ({ entries }) => {
    try {
      if (options.newOnly && entries.some(item => item.id === entry.id)) throw new Error("Saved part identity collided with another entry. Save the component again.");
      if (options.existingOnly && !entries.some(item => item.id === entry.id)) throw new Error("Saved part was deleted in another tab. Close and reopen the library before renaming.");
      assertLibraryBudget([...entries.filter(item => item.id !== entry.id), entry]);
      const request = store.put(entry); request.onsuccess = () => done(undefined);
    } catch (error) { fail(error); }
  }, fail), options.signal);
}
export function deleteLibraryPart(id: string, signal?: AbortSignal): Promise<void> {
  if (!readPartLibraryDragId(id)) return Promise.reject(new Error("Saved part identity is invalid."));
  return transaction("readwrite", (store, done) => { const request = store.delete(id); request.onsuccess = () => done(undefined); }, signal);
}
export function deleteDamagedLibraryPart(key: string | number, signal?: AbortSignal): Promise<void> {
  if (recoveryKey(key) === undefined) return Promise.reject(new Error("Damaged entry key is unsupported. Delete all saved library copies to reset local part storage."));
  return transaction("readwrite", (store, done) => { const request = store.delete(key); request.onsuccess = () => done(undefined); }, signal);
}
export function clearLibraryParts(signal?: AbortSignal): Promise<void> {
  return transaction("readwrite", (store, done) => { const request = store.clear(); request.onsuccess = () => done(undefined); }, signal);
}
