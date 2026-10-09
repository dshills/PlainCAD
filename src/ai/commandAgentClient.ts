import { requestJson } from "./client";
import { AI_LIMITS, type AiProvider } from "./plan";
import { validateAiHistory, type AiMessage } from "./conversation";
import { validateCommandAgentContext, validateCommandAgentProposal, type CommandAgentContext } from "./commandAgentPlan";
import { executeCommand } from "../commands/registry";
export async function captureCommandAgentContext() {
  const response = await executeCommand({ command: "runtime.snapshot" });
  if (!response.ok) throw new Error(response.error.message);
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const value = response.value;
  if (!record(value) || !Number.isSafeInteger(value.session) || !record(value.document) || typeof value.activeComponentId !== "string" ||
      !record(value.selection) || !Array.isArray(value.selection.selectedIds) || !record(value.rebuild) || typeof value.rebuild.native !== "boolean" ||
      !Array.isArray(value.rebuild.errors) || value.rebuild.errors.some(error => !record(error) || typeof error.message !== "string") ||
      !Array.isArray(value.rebuild.bodies) || (value.rebuild.native && value.rebuild.bodies.some(body => !record(body) || typeof body.id !== "string" || !record(body.assertions) || typeof body.assertions.volume !== "number" || typeof body.assertions.solidCount !== "number" || typeof body.assertions.valid !== "boolean")))
    throw new Error("The command registry returned an incomplete project snapshot. Refresh the project before asking the agent.");
  const snapshot = value as unknown as { session: number; document: unknown; activeComponentId: string; selection: { selectedIds: unknown[] }; rebuild: { native: boolean; errors: { message: string }[]; bodies: { id: string; assertions: { volume: number; solidCount: number; valid: boolean } }[] } };
  return validateCommandAgentContext({ session: snapshot.session, document: snapshot.document, activeComponentId: snapshot.activeComponentId, selection: snapshot.selection.selectedIds, native: snapshot.rebuild.native, bodies: (snapshot.rebuild.native ? snapshot.rebuild.bodies : []).map(body => ({ id: body.id, volume: body.assertions.volume, solidCount: body.assertions.solidCount, valid: body.assertions.valid })), diagnostics: snapshot.rebuild.errors.map(error => error.message.slice(0, 500)).slice(0, 32) });
}
export function prepareCommandAgentRequest(provider: AiProvider, model: string, prompt: string, messages: AiMessage[], commandContext: CommandAgentContext) {
  if (!prompt.trim() || prompt.length > AI_LIMITS.promptCharacters) throw new Error(`Describe the requested edits in 1–${AI_LIMITS.promptCharacters} characters.`);
  let history = validateAiHistory(messages, AI_LIMITS.transcriptMessages).slice(-AI_LIMITS.history);
  const context = validateCommandAgentContext(commandContext);
  const payload = () => ({ provider, model, prompt: prompt.trim(), history, commandContext: context });
  while (history.length > 0 && new TextEncoder().encode(JSON.stringify(payload())).byteLength > AI_LIMITS.requestBytes) history = history.slice(2);
  if (new TextEncoder().encode(JSON.stringify(payload())).byteLength > AI_LIMITS.requestBytes) throw new Error("This conversation exceeds the request budget. Start a new conversation or shorten the request.");
  return payload();
}
export async function requestCommandAgentProposal(provider: AiProvider, model: string, prompt: string, messages: AiMessage[], context: CommandAgentContext, signal: AbortSignal) {
  const body = prepareCommandAgentRequest(provider, model, prompt, messages, context);
  const response = await requestJson("/api/ai/commands", signal, body);
  return validateCommandAgentProposal(response.proposal);
}
