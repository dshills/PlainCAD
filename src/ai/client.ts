import {
  AI_LIMITS,
  AI_PROVIDERS,
  validateAiPlan,
  type AiPlan,
  type AiProvider,
  type AiProviderStatus,
  type AiEditContext,
} from "./plan";
import { parseProjectJson } from "../persistence/importSafety";
import { prepareAiConversation } from "./conversation";

export async function requestJson(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (
    encoded &&
    new TextEncoder().encode(encoded).byteLength > AI_LIMITS.requestBytes
  )
    throw new Error("Conversation is too long. Start a new conversation.");
  let response: Response;
  try {
    response = await fetch(path, {
      method: encoded ? "POST" : "GET",
      headers: encoded ? { "Content-Type": "application/json" } : undefined,
      body: encoded,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "AI server could not be reached. Run the app with its local server.",
    );
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel();
    throw new Error(
      "AI needs the local server. Start with npm run dev or npm run preview; static hosting needs a separate AI service.",
    );
  }
  if (!response.body) throw new Error("AI server returned no response.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((bytes += value.byteLength) > AI_LIMITS.responseBytes)
        throw new Error("AI response is too large. Try a simpler part.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = parseProjectJson(text);
  } catch {
    throw new Error(
      "AI server returned invalid JSON. Generate a new proposal.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("AI server returned an invalid response.");
  const result = value as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `AI request failed (HTTP ${response.status}).`,
    );
  return result;
}
export async function fetchAiProviders(
  signal: AbortSignal,
): Promise<AiProviderStatus[]> {
  const value = await requestJson("/api/ai/status", signal);
  if (
    !Array.isArray(value.providers) ||
    value.providers.length !== AI_PROVIDERS.length ||
    new Set(value.providers.map((p) => p?.id)).size !== AI_PROVIDERS.length ||
    value.providers.some(
      (p) =>
        !p ||
        typeof p !== "object" ||
        !AI_PROVIDERS.includes(p.id) ||
        typeof p.available !== "boolean" ||
        typeof p.label !== "string" ||
        typeof p.model !== "string",
    )
  )
    throw new Error("AI server provider configuration is invalid.");
  return value.providers as AiProviderStatus[];
}
export async function requestAiPlan(
  provider: AiProvider,
  model: string,
  prompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  signal: AbortSignal,
  editContext?: AiEditContext,
): Promise<AiPlan> {
  if (!prompt.trim() || prompt.length > AI_LIMITS.promptCharacters)
    throw new Error(
      `Describe your part in 1–${AI_LIMITS.promptCharacters} characters.`,
    );
  const prepared = prepareAiConversation(
    provider,
    model,
    prompt,
    history,
    editContext,
  );
  const value = await requestJson("/api/ai/generate", signal, prepared.body);
  return validateAiPlan(value.plan);
}
