import { migrateDocument } from "../cad/document/migrations";
import { CadDocument } from "../cad/document/schema";
import { validateDocument } from "../cad/document/validate";

export async function importProjectFile(file: File): Promise<CadDocument> {
  return importProjectText(await file.text());
}

export function importProjectText(text: string): CadDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Project file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Project file does not contain a document object.");
  const document = migrateDocument(parsed as CadDocument);
  const issues = validateDocument(document);
  if (issues.length > 0) throw new Error(issues[0].message);
  return document;
}
