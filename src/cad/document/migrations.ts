import { CURRENT_SCHEMA_VERSION, CadDocument } from "./schema";

export function migrateDocument(input: CadDocument): CadDocument {
  if (input.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return input;
  }
  throw new Error(`Unsupported project schema version ${input.schemaVersion}.`);
}
