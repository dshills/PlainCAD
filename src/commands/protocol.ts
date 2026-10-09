import { parseBoundedJson } from "../persistence/importSafety";
import type { CommandRequest, JsonValue } from "./registry";
export const COMMAND_BYTES = 6 * 1024 * 1024;
export function commandRequest(value: unknown): CommandRequest {
  // Copy through the bounded untrusted JSON boundary before invoking any handler.
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string")
    throw new Error("Command request must be JSON.");
  const input = parseBoundedJson(serialized, COMMAND_BYTES, "Command request") as Record<string, unknown>;
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.command !== "string" || !input.command || input.command.length > 200 || (input.target !== undefined && (typeof input.target !== "string" || input.target.length > 300)) || (input.session !== undefined && (!Number.isSafeInteger(input.session) || (input.session as number) < 0)) || Object.keys(input).some(key => !["command", "target", "arguments", "session"].includes(key)))
    throw new Error("Command request has invalid or unknown fields.");
  return input as unknown as CommandRequest;
}
export function objectArguments(value: unknown, allowed: readonly string[]): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error("Command arguments contain invalid or unknown fields.");
  return value as Record<string, JsonValue>;
}
export function stringArgument(value: JsonValue | undefined, name: string, maximum = 5000) {
  if (typeof value !== "string" || value.length > maximum)
    throw new Error(`${name} must be a bounded string.`);
  return value;
}
