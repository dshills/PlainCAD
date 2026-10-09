import type { JsonValue } from "./registry";

/** JSON-schema subset shared by discovery, providers, plans and the executor. */
export interface CommandSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: Record<string, CommandSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: CommandSchema;
  enum?: (string | number)[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
}
export const expressionSchema: CommandSchema = { type: "string", minLength: 1, maxLength: 5000, description: "A unit-aware CAD expression; bare lengths use project authored units." };
export const referenceSchema: CommandSchema = { type: "string", minLength: 1, maxLength: 300, description: "An existing stable ID or a $alias from this plan." };
export const nameSchema: CommandSchema = { type: "string", minLength: 1, maxLength: 120 };
export const aliasSchema: CommandSchema = { type: "string", minLength: 1, maxLength: 64, description: "Bind the created primary ID to this plan-local name; generated members also bind name.point0, name.entity0, name.profile0 and name.body." };
export const pointSchema: CommandSchema = objectSchema({ x: expressionSchema, y: expressionSchema }, ["x", "y"]);
export function enumSchema(values: string[]): CommandSchema { return { type: "string", enum: values }; }
export function arraySchema(items: CommandSchema, maximum = 64, minimum = 1): CommandSchema { return { type: "array", items, minItems: minimum, maxItems: maximum }; }
export function objectSchema(properties: Record<string, CommandSchema>, required: string[] = []): CommandSchema {
  return { type: "object", properties, required, additionalProperties: false };
}
export function commandSchemaJson(schema: CommandSchema): JsonValue { return JSON.parse(JSON.stringify(schema)) as JsonValue; }
export function validateCommandArguments(schema: CommandSchema, value: unknown, path = "arguments"): asserts value is Record<string, JsonValue> {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`${path}.${key} is unsupported.`);
      validateCommandArguments(schema.properties![key], input[key], `${path}.${key}`);
    }
    for (const key of schema.required ?? []) if (!Object.hasOwn(input, key)) throw new Error(`${path}.${key} is required.`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 64)) throw new Error(`${path} has an invalid array length.`);
    value.forEach((item, index) => validateCommandArguments(schema.items!, item, `${path}[${index}]`));
  } else {
    if (typeof value !== schema.type) throw new Error(`${path} must be ${schema.type}.`);
    if (typeof value === "string" && (value.trim().length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 5000))) throw new Error(`${path} has an invalid string length.`);
    if (typeof value === "number" && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path} must be a finite number within its bounds.`);
    if (schema.enum && !schema.enum.includes(value as string | number)) throw new Error(`${path} must be one of ${schema.enum.join(", ")}.`);
  }
}
