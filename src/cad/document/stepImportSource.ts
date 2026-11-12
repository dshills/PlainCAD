/** Portable STEP source, separate from native handles, meshes and export proofs. */
export const STEP_IMPORT_MAX_BYTES = 512 * 1024;
export const STEP_IMPORT_PROJECT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_STEP_ENTITIES = 12000;
const ASCII_STEP = /^[\x09\x0a\x0d\x20-\x7e]+$/;

export function stepSourceDiagnostic(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.length)
    return "STEP source is empty or missing.";
  if (value.length > STEP_IMPORT_MAX_BYTES)
    return "STEP source exceeds the 512 KiB import limit. Export a smaller single solid.";
  if (!ASCII_STEP.test(value) || !value.startsWith("ISO-10303-21;") ||
    !value.trimEnd().endsWith("END-ISO-10303-21;"))
    return "Choose a plain-text ISO-10303-21 STEP file.";
  let count = 0;
  for (const _entity of value.matchAll(/#\d+\s*=/g))
    if (++count > MAX_STEP_ENTITIES)
      return "STEP source exceeds the 12,000-entity import limit. Export a simpler solid.";
  if (count === 0) return "STEP source contains no geometry entities.";
  return undefined;
}
