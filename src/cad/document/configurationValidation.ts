import type { CadDocument, CadParameter, ValidationIssue } from "./schema";
import { validAuthoredUnit } from "../parameters/parameterUnits";
import { validateParameterBindings } from "../parameters/expressionBindings";
export const MAX_CONFIGURATIONS = 16;
export function configurationIssues(document: CadDocument): ValidationIssue[] {
  const configurations = document.configurations;
  if (configurations === undefined) return [];
  const fail = (message: string): ValidationIssue[] => [{ source: "document", message }];
  if (!Array.isArray(configurations) || configurations.length > MAX_CONFIGURATIONS) return fail("Product configurations must be an array of at most 16 entries.");
  const names = new Set<string>(), ids = new Set<string>();
  for (const configuration of configurations) {
    if (!configuration || typeof configuration.id !== "string" || !configuration.id.trim() || configuration.id.length > 160 || ids.has(configuration.id) || typeof configuration.name !== "string" || !configuration.name.trim() || configuration.name.length > 80 || names.has(configuration.name.trim().toLowerCase())) return fail("Configurations need unique IDs and names of 1–80 characters.");
    ids.add(configuration.id); names.add(configuration.name.trim().toLowerCase());
    if (!Array.isArray(configuration.parameters) || !configuration.parameters.length || configuration.parameters.length > 500) return fail("A configuration needs 1–500 parameter expressions.");
    const targets = new Set<string>();
    const parameters: Record<string, CadParameter> = {};
    for (const entry of configuration.parameters) {
      if (!entry || typeof entry.parameterId !== "string" || !entry.parameterId || entry.parameterId.length > 160 || targets.has(entry.parameterId)) return fail("Configuration parameter IDs are missing or duplicated.");
      targets.add(entry.parameterId);
      const ref = entry.expression;
      if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof ref.expression !== "string" || !ref.expression.trim() || ref.expression.length > 1024 || typeof ref.unit !== "string" || ref.unit.length > 32 || (ref.authoredUnit !== undefined && !validAuthoredUnit(ref.authoredUnit)) || (ref.resolvedValue !== undefined && !Number.isFinite(ref.resolvedValue))) return fail("Configuration expressions are malformed or exceed their resource limit.");
      // Missing targets are repairable inactive configuration data, not a main-model failure.
      const name = `configurationValue${targets.size}`;
      parameters[name] = { ...ref, id: entry.parameterId, name, value: 0 };
    }
    const issues = validateParameterBindings({ ...document, parameters, sketches: {}, features: [] });
    if (issues.length) return fail(`Configuration ${configuration.name}: ${issues[0].message}`);
  }
  return [];
}
