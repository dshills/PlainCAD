import { migrateDocument } from "../cad/document/migrations";
import { CadDocument } from "../cad/document/schema";
import { validateDocument } from "../cad/document/validate";
import { assertProjectJsonShape, parseProjectJson } from "./importSafety";

export async function importProjectFile(file: File): Promise<CadDocument> {
  return importProjectText(await file.text());
}

export function importProjectText(text: string): CadDocument {
  const parsed = parseProjectJson(text);
  assertProjectJsonShape(parsed);
  const document = migrateDocument(parsed as CadDocument);
  const issues = validateDocument(document);
  if (issues.length > 0) throw new Error(issues[0].message);
  return document;
}
