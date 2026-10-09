import { parseBoundedJson } from "../persistence/importSafety";
import type { CommandRequest, JsonValue } from "./registry";
import { CAD_COMMAND_SCHEMAS, isCadCommandId } from "./cadCommands";
import { referenceSchema, validateCommandArguments, type CommandSchema } from "./commandSchemas";

export const MACRO_LIMITS = { bytes: 256 * 1024, steps: 100, variables: 32, saved: 30 } as const;
export interface MacroVariable {
  name: string;
  type: "string" | "number" | "boolean";
  defaultValue: string | number | boolean;
}
export interface MacroStep { command: string; arguments: JsonValue }
export interface ModelingMacro {
  version: 1;
  id: string;
  name: string;
  variables: MacroVariable[];
  steps: MacroStep[];
}
export interface ResultReference { step: number; path: (string | number)[] }
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error("Macro contains unknown fields.");
}
function boundedName(value: unknown, label: string, maximum = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label} must be a nonempty bounded string.`);
  return value;
}
function validateTemplate(value: JsonValue, step: number, variables: Map<string, MacroVariable>, depth = 0) {
  if (depth > 32) throw new Error("Macro argument template is nested too deeply.");
  if (typeof value === "string" && value.length > 5000) throw new Error("Macro string argument is too long.");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(item => validateTemplate(item, step, variables, depth + 1)); return; }
  if (Object.hasOwn(value, "$variable")) {
    exact(value, ["$variable"]);
    if (typeof value.$variable !== "string" || !variables.has(value.$variable)) throw new Error("Macro references an undefined variable.");
    return;
  }
  if (Object.hasOwn(value, "$result")) {
    exact(value, ["$result"]);
    const reference = value.$result;
    if (!record(reference)) throw new Error("Macro result reference is invalid.");
    exact(reference, ["step", "path"]);
    if (!Number.isSafeInteger(reference.step) || Number(reference.step) < 0 || Number(reference.step) >= step || !Array.isArray(reference.path) || reference.path.length > 16 || !reference.path.every(key => (typeof key === "string" && key.length > 0 && key.length <= 160) || (Number.isSafeInteger(key) && Number(key) >= 0))) throw new Error("Macro result references must target an earlier step and bounded field path.");
    return;
  }
  Object.values(value).forEach(item => validateTemplate(item, step, variables, depth + 1));
}
function validateArgumentTemplate(schema: CommandSchema, value: JsonValue, variables: Map<string, MacroVariable>, path = "arguments") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.$variable === "string") {
      const variable = variables.get(value.$variable)!;
      validateCommandArguments(schema, variable.defaultValue, path);
      return;
    }
    if (Object.hasOwn(value, "$result")) {
      if (schema.type !== "string") throw new Error(`${path}: result references must target string ID arguments.`);
      return;
    }
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`${path}.${key} is unsupported.`);
      validateArgumentTemplate(schema.properties![key], child, variables, `${path}.${key}`);
    }
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
    return;
  }
  if (schema.type === "array" && Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 64)) throw new Error(`${path} has an invalid array length.`);
    value.forEach((child, index) => validateArgumentTemplate(schema.items!, child, variables, `${path}[${index}]`));
    return;
  }
  validateCommandArguments(schema, value, path);
}
/** Parse/copy before validation so imports and caller-owned objects share one safe boundary. */
export function validateMacro(input: unknown, commands: readonly string[]): ModelingMacro {
  const value = parseBoundedJson(JSON.stringify(input), MACRO_LIMITS.bytes, "Modeling macro");
  if (!record(value)) throw new Error("Macro must be a JSON object.");
  exact(value, ["version", "id", "name", "variables", "steps"]);
  if (value.version !== 1) throw new Error("Unsupported macro version.");
  const id = boundedName(value.id, "Macro ID", 160), name = boundedName(value.name, "Macro name");
  if (!Array.isArray(value.variables) || value.variables.length > MACRO_LIMITS.variables) throw new Error("Macro has too many variables.");
  const variables: MacroVariable[] = [], known = new Map<string, MacroVariable>();
  for (const variable of value.variables) {
    if (!record(variable)) throw new Error("Macro variable must be an object.");
    exact(variable, ["name", "type", "defaultValue"]);
    if (typeof variable.name !== "string" || !NAME.test(variable.name) || known.has(variable.name) || !["string", "number", "boolean"].includes(String(variable.type)) || typeof variable.defaultValue !== variable.type || (typeof variable.defaultValue === "number" && !Number.isFinite(variable.defaultValue)) || (typeof variable.defaultValue === "string" && variable.defaultValue.length > 5000)) throw new Error("Macro variables need unique names and defaults matching their declared type.");
    const typed = variable as unknown as MacroVariable;
    variables.push(typed); known.set(typed.name, typed);
  }
  if (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > MACRO_LIMITS.steps) throw new Error("Macro requires 1–100 modeling steps.");
  const steps: MacroStep[] = value.steps.map((step, index) => {
    if (!record(step)) throw new Error("Macro step must be an object.");
    exact(step, ["command", "arguments"]);
    if (typeof step.command !== "string" || !commands.includes(step.command) || step.arguments === undefined) throw new Error("Macro contains an unsupported modeling command. Refresh semantic command discovery.");
    validateTemplate(step.arguments as JsonValue, index, known);
    if (!isCadCommandId(step.command)) throw new Error("Macro command has no semantic argument schema.");
    validateArgumentTemplate(CAD_COMMAND_SCHEMAS[step.command], step.arguments as JsonValue, known);
    return step as unknown as MacroStep;
  });
  return { version: 1, id, name, variables, steps };
}
export function importMacro(text: string, commands: readonly string[]): ModelingMacro {
  return validateMacro(parseBoundedJson(text, MACRO_LIMITS.bytes, "Modeling macro"), commands);
}
export function instantiateMacro(macro: ModelingMacro, values: Record<string, JsonValue>, commands: readonly string[]): MacroStep[] {
  const checked = validateMacro(macro, commands);
  if (Object.keys(values).some(key => !checked.variables.some(variable => variable.name === key))) throw new Error("Unknown macro variable.");
  const supplied = new Map(checked.variables.map(variable => {
    const value = Object.hasOwn(values, variable.name) ? values[variable.name] : variable.defaultValue;
    if (typeof value !== variable.type || (typeof value === "number" && !Number.isFinite(value)) || (typeof value === "string" && value.length > 5000)) throw new Error(`Variable ${variable.name} must be a bounded ${variable.type}.`);
    return [variable.name, value] as const;
  }));
  const substitute = (value: JsonValue): JsonValue => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(substitute);
    if (typeof value.$variable === "string") return supplied.get(value.$variable)!;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substitute(child)]));
  };
  const steps = checked.steps.map(step => ({ command: step.command, arguments: substitute(step.arguments) }));
  steps.forEach(step => {
    if (!isCadCommandId(step.command)) throw new Error("Macro command has no semantic argument schema.");
    validateArgumentTemplate(CAD_COMMAND_SCHEMAS[step.command], step.arguments, new Map());
  });
  return steps;
}
/** Rebind declared ID arguments to earlier semantic results; preserve authored text. */
export function recordMacroStep(request: CommandRequest, previousResults: JsonValue[]): MacroStep {
  const references = new Map<string, ResultReference>();
  previousResults.forEach((result, step) => {
    const collect = (value: JsonValue, path: (string | number)[]) => {
      if (typeof value === "string" && path.length && (/(?:^id$|Id$)/.test(String(path.at(-1)!)) || (typeof path.at(-1) === "number" && /Ids$/.test(String(path.at(-2)))))) references.set(value, { step, path });
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => collect(child, [...path, Array.isArray(value) ? Number(key) : key]));
    };
    collect(result, []);
  });
  const rewrite = (value: JsonValue, schema?: CommandSchema): JsonValue => {
    if (typeof value === "string" && schema === referenceSchema && references.has(value)) return { $result: references.get(value)! as unknown as JsonValue };
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(child => rewrite(child, schema?.items));
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child, schema?.properties?.[key])]));
  };
  const schema = isCadCommandId(request.command) ? CAD_COMMAND_SCHEMAS[request.command] : undefined;
  return { command: request.command, arguments: rewrite(request.arguments ?? {}, schema) };
}
/** Replace one explicit JSON argument path rather than guessing coincidentally equal values. */
export function parameterizeMacro(macro: ModelingMacro, stepIndex: number, path: string[], variable: MacroVariable, commands: readonly string[]): ModelingMacro {
  const checked = validateMacro(macro, commands);
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= checked.steps.length || !path.length || path.length > 16 || checked.variables.some(item => item.name === variable.name)) throw new Error("Choose a current argument and a unique variable name.");
  let parent: JsonValue = checked.steps[stepIndex].arguments;
  for (const key of path.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) throw new Error("Macro argument path no longer exists.");
    parent = (parent as Record<string, JsonValue>)[key];
  }
  const key = path.at(-1)!;
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key) || typeof (parent as Record<string, JsonValue>)[key] !== variable.type) throw new Error("Choose a primitive argument matching the variable type.");
  const defaultValue = (parent as Record<string, JsonValue>)[key] as MacroVariable["defaultValue"];
  (parent as Record<string, JsonValue>)[key] = { $variable: variable.name };
  checked.variables.push({ ...variable, defaultValue });
  return validateMacro(checked, commands);
}
