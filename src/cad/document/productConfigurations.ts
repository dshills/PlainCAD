import type { CadDocument, ExpressionRef, ProductConfiguration } from "./schema";
import { createId } from "./ids";
import { configurationIssues } from "./configurationValidation";
import { bindDocumentExpressions, parameterTokens, refreshBoundNames, validateParameterBindings } from "../parameters/expressionBindings";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import { assertProjectJsonShape, PROJECT_IMPORT_LIMITS } from "../../persistence/importSafety";

function checked(document: CadDocument) {
  const updated = { ...document, updatedAt: new Date().toISOString() };
  assertProjectJsonShape(updated);
  const issues = configurationIssues(updated); if (issues.length) throw new Error(issues[0].message);
  if (new TextEncoder().encode(JSON.stringify(updated, null, 2)).byteLength > PROJECT_IMPORT_LIMITS.maxBytes) throw new Error("Configurations exceed the 5 MiB project-file limit. Remove configurations or shorten expressions.");
  return updated;
}
export function captureConfiguration(document: CadDocument, name: string, replaceId?: string): CadDocument {
  const bound = bindDocumentExpressions(document), evaluation = evaluateParameters(bound.parameters);
  if (evaluation.errors.length) throw new Error("Fix parameter expressions before saving a configuration.");
  if (replaceId && !document.configurations?.some(configuration => configuration.id === replaceId)) throw new Error("Configuration no longer exists.");
  if (!Object.values(bound.parameters).some(parameter => !parameter.locked)) throw new Error("No unlocked parameters to capture.");
  const configuration: ProductConfiguration = { id: replaceId ?? createId("configuration"), name: name.trim(), parameters: Object.values(bound.parameters).filter(parameter => !parameter.locked).map(parameter => ({ parameterId: parameter.id, expression: { expression: parameter.expression, unit: parameter.unit, ...(parameter.authoredUnit !== undefined ? { authoredUnit: parameter.authoredUnit } : {}), ...(parameter.parameterRefs ? { parameterRefs: { ...parameter.parameterRefs } } : {}) } })) };
  return checked({ ...document, configurations: [...(document.configurations ?? []).filter(item => item.id !== configuration.id), configuration] });
}
export function configurationDocument(document: CadDocument, id: string): CadDocument {
  const configuration = document.configurations?.find(configuration => configuration.id === id);
  if (!configuration) throw new Error("Configuration no longer exists.");
  const issues = configurationIssues(document); if (issues.length) throw new Error(issues[0].message);
  const byId = new Map(Object.values(document.parameters).map(parameter => [parameter.id, parameter]));
  const parameters = { ...document.parameters };
  for (const entry of configuration.parameters) {
    const parameter = byId.get(entry.parameterId);
    if (!parameter) throw new Error(`Configuration ${configuration.name} references a deleted parameter. Recapture or delete this configuration.`);
    if (parameter.locked) throw new Error(`Parameter ${parameter.name} is now locked. Recapture this configuration.`);
    const { resolvedValue: _resolvedValue, ...expression } = entry.expression;
    const { parameterRefs: _staleRefs, authoredUnit: _staleUnit, ...base } = parameter;
    // Absence historically means strict scalar semantics. Make it explicit so
    // the store's authoring defaults cannot reinterpret a recalled expression.
    parameters[parameter.name] = { ...base, ...expression, authoredUnit: expression.authoredUnit ?? "", value: parameter.value };
  }
  const candidate = refreshBoundNames({ ...document, parameters });
  const bindings = validateParameterBindings(candidate, true); if (bindings.length) throw new Error(bindings[0].message);
  const evaluation = evaluateParameters(candidate.parameters); if (evaluation.errors.length) throw new Error(evaluation.errors.map(error => error.message).join(" "));
  return { ...candidate, updatedAt: new Date().toISOString() };
}
export function editConfigurationExpression(document: CadDocument, id: string, parameterId: string, text: string) {
  const configuration = document.configurations?.find(configuration => configuration.id === id), parameter = Object.values(document.parameters).find(parameter => parameter.id === parameterId);
  if (!configuration || !parameter || parameter.locked || !configuration.parameters.some(entry => entry.parameterId === parameterId)) throw new Error("Choose an editable configuration parameter.");
  const original = configuration.parameters.find(entry => entry.parameterId === parameterId)!;
  let refs: Record<string, string> | undefined;
  try { refs = Object.fromEntries(parameterTokens(text).flatMap(token => { const target = document.parameters[token.value]?.id ?? original.expression.parameterRefs?.[token.value]; return target ? [[token.value, target]] : []; })); } catch { /* Invalid draft expressions diagnose on Compare. */ }
  const dimension = evaluateParameters(document.parameters).values[parameter.name]?.dimension;
  if (!dimension) throw new Error("Fix the active parameter expression before editing its configuration.");
  const expression: ExpressionRef = { expression: text, unit: parameter.unit, authoredUnit: dimension === "scalar" ? "" : dimension === "angle" ? document.unitSettings.angle : document.unitSettings.length, ...(refs && Object.keys(refs).length ? { parameterRefs: refs } : {}) };
  return checked({ ...document, configurations: document.configurations!.map(item => item.id === id ? { ...item, parameters: item.parameters.map(entry => entry.parameterId === parameterId ? { ...entry, expression } : entry) } : item) });
}
export function deleteConfiguration(document: CadDocument, id: string) {
  if (!document.configurations?.some(configuration => configuration.id === id)) throw new Error("Configuration no longer exists.");
  return checked({ ...document, configurations: document.configurations.filter(configuration => configuration.id !== id) });
}
