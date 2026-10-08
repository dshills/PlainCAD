import { decodeLibraryPack, LIBRARY_PACK_MAX_BYTES, serializeLibraryPack } from "./partLibraryPack";
import type { PartLibraryEntry } from "./partLibrary";
self.onmessage = async (event: MessageEvent<File | { entries: PartLibraryEntry[] }>) => {
  try {
    if (event.data instanceof File) {
      if (event.data.size > LIBRARY_PACK_MAX_BYTES) throw new Error("Library pack is too large.");
      self.postMessage({ result: decodeLibraryPack(await event.data.text()) });
    } else self.postMessage({ result: serializeLibraryPack(event.data.entries) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Library pack validation failed." });
  }
};
