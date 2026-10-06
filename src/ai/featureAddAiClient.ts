import { requestJson } from "./client";
import { validateAiHistory, type AiMessage } from "./conversation";
import { AI_LIMITS, AI_PROVIDERS, type AiProvider } from "./plan";
import { validateAiFeatureAddContext, validateAiFeatureAddProposal, type AiFeatureAddContext } from "./featureAddPlan";
export function prepareAiFeatureAddRequest(provider: AiProvider, model: string, prompt: string, messages: AiMessage[], featureContext: AiFeatureAddContext) {
  if (!AI_PROVIDERS.includes(provider) || !model.trim() || model.length > 120) throw new Error("Choose an available configured provider.");
  if (!prompt.trim() || prompt.length > AI_LIMITS.promptCharacters) throw new Error("Describe a bounded feature addition within the prompt limit.");
  const context = validateAiFeatureAddContext(featureContext), all = validateAiHistory(messages, AI_LIMITS.transcriptMessages);
  let history = all.slice(-AI_LIMITS.history);
  const encoder = new TextEncoder();
  const body = () => ({ provider, model: model.trim(), prompt: prompt.trim(), history, featureContext: context });
  let request = body(), bytes = encoder.encode(JSON.stringify(request)).byteLength;
  while (history.length > 2 && bytes > AI_LIMITS.requestBytes) {
    history = history.slice(2); request = body(); bytes = encoder.encode(JSON.stringify(request)).byteLength;
  }
  if (bytes > AI_LIMITS.requestBytes) throw new Error("Feature context or latest conversation turn exceeds 32 KB. Start a new conversation or use manual tools.");
  return request;
}
export async function requestAiFeatureAddProposal(provider: AiProvider, model: string, prompt: string, history: AiMessage[], context: AiFeatureAddContext, signal: AbortSignal) {
  const response = await requestJson("/api/ai/features", signal, prepareAiFeatureAddRequest(provider, model, prompt, history, context));
  if (signal.aborted) throw new Error("AI feature request canceled.");
  return validateAiFeatureAddProposal(response.proposal);
}
