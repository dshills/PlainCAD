import PackWorker from "./libraryPackWorker?worker";
import { backgroundJob } from "./backgroundJob";
import { decodeLibraryPack, LIBRARY_PACK_MAX_BYTES, serializeLibraryPack } from "./partLibraryPack";
import { libraryEntryBytes, type PartLibraryEntry } from "./partLibrary";
import { PROJECT_IMPORT_LIMITS } from "./importSafety";

export async function importLibraryPackFile(file: File, signal?: AbortSignal): Promise<PartLibraryEntry[]> {
  if (signal?.aborted) throw new Error("Library pack operation was cancelled.");
  if (file.size > LIBRARY_PACK_MAX_BYTES) throw new Error("Library pack is too large.");
  if (typeof Worker !== "undefined") return backgroundJob<File, PartLibraryEntry[]>(PackWorker, file, signal);
  if (file.size > PROJECT_IMPORT_LIMITS.maxBytes) throw new Error("Large library packs require background worker support in this browser.");
  const text = await file.text();
  if (signal?.aborted) throw new Error("Library pack operation was cancelled.");
  return decodeLibraryPack(text);
}
export async function exportLibraryPackText(entries: PartLibraryEntry[], signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error("Library pack operation was cancelled.");
  if (typeof Worker !== "undefined") return backgroundJob<{ entries: PartLibraryEntry[] }, string>(PackWorker, { entries }, signal);
  if (entries.reduce((total, entry) => total + libraryEntryBytes(entry), 0) > PROJECT_IMPORT_LIMITS.maxBytes) throw new Error("Large library backups require background worker support in this browser.");
  return serializeLibraryPack(entries);
}
