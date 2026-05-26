import { CadDocument } from "../cad/document/schema";

export function serializeProject(document: CadDocument): string {
  return JSON.stringify(sortObject(document), null, 2);
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

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}
