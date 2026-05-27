import { CadDocument } from "../cad/document/schema";

export const PROJECT_FILE_EXTENSION = ".pcaddoc";
export const PROJECT_FILE_MIME_TYPE = "application/vnd.plaincad.project+json";

export function serializeProject(document: CadDocument, pretty = true): string {
  return JSON.stringify(sortObject(document), null, pretty ? 2 : undefined);
}

export function exportProject(document: CadDocument): ArrayBuffer {
  return new TextEncoder().encode(serializeProject(document)).buffer;
}

export function projectFilename(document: CadDocument, extension = PROJECT_FILE_EXTENSION): string {
  const safeName = document.name.trim().replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${safeName || "PlainCAD"}${extension}`;
}

export function downloadArrayBuffer(bytes: ArrayBuffer, filename: string, type: string) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadProject(document: CadDocument) {
  downloadArrayBuffer(exportProject(document), projectFilename(document), PROJECT_FILE_MIME_TYPE);
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}
