import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { listRecoveryRecords } from "./autosave";
import { serializeProject } from "./exportProject";
import { validateLibraryThumbnail } from "./partLibrary";
import { libraryThumbnail } from "./partLibraryThumbnail";
import { importProjectFile } from "./importProject";

const KEY = "plaincad.gallery.thumbnails.v1";
const LIMIT = 5;
interface Cover { id: string; hash: string; thumbnail: string }
export interface GalleryProject { id: string; name: string; text: string; savedAt: number; thumbnail?: string; parts: number; features: number; complexity: string }
export function projectComplexity(parts: number, features: number): string {
  return parts >= 20 || features >= 35 ? "Highly complex" : parts >= 10 || features >= 20 ? "Advanced" : parts >= 5 || features >= 10 ? "Intermediate" : "Beginner";
}
async function fingerprint(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function readCovers(): Cover[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 1800000) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > LIMIT) return [];
    return entries.flatMap(entry => {
      if (!entry || typeof entry.id !== "string" || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash) || typeof entry.thumbnail !== "string") return [];
      try { validateLibraryThumbnail(entry.thumbnail); return [{ id: entry.id, hash: entry.hash, thumbnail: entry.thumbnail }]; } catch { return []; }
    });
  } catch { return []; }
}
/** Optional, bounded browser cover cache; the editable project remains in recovery storage. */
export async function rememberGalleryProject(document: CadDocument, result?: RebuildResult): Promise<void> {
  if (!result?.success || result.documentId !== document.id || !result.meshes.length) return;
  try {
    const text = serializeProject(document, false);
    const thumbnail = await libraryThumbnail(result.meshes);
    const entry = { id: document.id, hash: await fingerprint(text), thumbnail };
    localStorage.setItem(KEY, JSON.stringify([entry, ...readCovers().filter(cover => cover.id !== entry.id)].slice(0, LIMIT)));
  } catch { /* Covers are optional; recovery and the downloaded project remain available. */ }
}
export async function recentGalleryProjects(signal: AbortSignal): Promise<{ projects: GalleryProject[]; warnings: string[] }> {
  const records = await listRecoveryRecords();
  const covers = readCovers();
  const projects: GalleryProject[] = [];
  const warnings: string[] = [];
  const saved = records.flatMap(record => record.manual ? [{ record, snapshot: record.manual }] : []);
  for (const { record, snapshot } of saved.sort((a, b) => b.snapshot.savedAt - a.snapshot.savedAt).slice(0, LIMIT)) {
    if (signal.aborted) throw new DOMException("Gallery closed", "AbortError");
    try {
    // Import validation happens off-thread, including identity and resource limits.
    const document = await importProjectFile(new File([snapshot.text], "recent.pcaddoc"), signal);
    if (document.id !== record.id) throw new Error("A saved project has a mismatched identity. Use Recovery to inspect this copy.");
    const hash = covers.length ? await fingerprint(snapshot.text).catch(() => undefined) : undefined;
    const parts = Object.keys(document.components).filter(id => id !== document.rootComponentId).length;
    const features = document.features.length;
    projects.push({ id: document.id, name: document.name, text: snapshot.text, savedAt: snapshot.savedAt, thumbnail: covers.find(cover => cover.id === document.id && cover.hash === hash)?.thumbnail, parts, features, complexity: projectComplexity(parts, features) });
    } catch (error) {
      if (signal.aborted) throw error;
      warnings.push(`A recent saved copy was skipped: ${error instanceof Error ? error.message : String(error)} Open Recovery to inspect saved copies.`);
    }
  }
  return { projects, warnings };
}
