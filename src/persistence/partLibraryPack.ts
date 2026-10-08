import { parseBoundedJson } from "./importSafety";
import { assertLibraryBudget, decodeLibraryEntry, PART_LIBRARY_LIMITS, type PartLibraryEntry } from "./partLibrary";

export const LIBRARY_PACK_EXTENSION = ".pcadlib";
export const LIBRARY_PACK_MIME_TYPE = "application/vnd.plaincad.library+json";
// Project text can expand when escaped as a JSON string. Stored data is still
// capped at 25 MiB, while the serialized envelope permits JSON-string escaping.
export const LIBRARY_PACK_MAX_BYTES = PART_LIBRARY_LIMITS.totalBytes * 2 + 65536;
interface PartLibraryPack { format: "plaincad-part-library"; version: 1; entries: PartLibraryEntry[] }
function exactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}
export function decodeLibraryPack(text: string): PartLibraryEntry[] {
  const parsed = parseBoundedJson(text, LIBRARY_PACK_MAX_BYTES, "Library pack");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !exactKeys(parsed, ["format", "version", "entries"])) throw new Error("Library pack envelope is invalid.");
  const pack = parsed as Partial<PartLibraryPack>;
  if (pack.format !== "plaincad-part-library" || pack.version !== 1 || !Array.isArray(pack.entries)) throw new Error("Library pack format or version is unsupported.");
  if (pack.entries.length > PART_LIBRARY_LIMITS.entries) throw new Error("Library pack contains more than 50 parts.");
  const ids = new Set<string>();
  const entries = pack.entries.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || !exactKeys(input, ["id", "name", "text", "thumbnail", "savedAt"])) throw new Error(`Library pack part ${index + 1} has invalid fields.`);
    const entry = decodeLibraryEntry(input);
    if (ids.has(entry.id)) throw new Error("Library pack contains duplicate part identities. No copies were imported.");
    ids.add(entry.id); return entry;
  });
  assertLibraryBudget(entries);
  return entries;
}
export function serializeLibraryPack(input: PartLibraryEntry[]): string {
  if (input.length > PART_LIBRARY_LIMITS.entries) throw new Error("Library pack contains more than 50 parts.");
  const entries = input.map(entry => decodeLibraryEntry(entry));
  assertLibraryBudget(entries);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("Library pack contains duplicate part identities.");
  const text = JSON.stringify({ format: "plaincad-part-library", version: 1, entries } satisfies PartLibraryPack);
  if (new TextEncoder().encode(text).byteLength > LIBRARY_PACK_MAX_BYTES) throw new Error("Library pack is too large.");
  return text;
}
