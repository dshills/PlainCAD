import { requestJson } from "./client";
import { validateAiHistory, type AiMessage } from "./conversation";
import { AI_LIMITS, AI_PROVIDERS, type AiProvider } from "./plan";
import { validateAiSketchContext, validateAiSketchProposal, type AiSketchContext } from "./sketchEditPlan";

/** A bounded data-only sketch request. This never sends project JSON or credentials. */
export function prepareAiSketchRequest(provider: AiProvider, model: string, prompt: string,
  messages: AiMessage[], sketchContext: AiSketchContext) {
  const configuredModel = model.trim(), requestPrompt = prompt.trim();
  if (!AI_PROVIDERS.includes(provider) || !configuredModel || configuredModel.length > 120)
    throw new Error("Choose an available configured AI provider.");
  if (!requestPrompt || requestPrompt.length > AI_LIMITS.promptCharacters)
    throw new Error(`Describe the sketch edit in 1–${AI_LIMITS.promptCharacters} characters.`);
  const context = validateAiSketchContext(sketchContext);
  const all = validateAiHistory(messages, AI_LIMITS.transcriptMessages);
  let history = all.slice(-AI_LIMITS.history);
  const body = () => ({ provider, model: configuredModel, prompt: requestPrompt, history, sketchContext: context });
  const bytes = () => new TextEncoder().encode(JSON.stringify(body())).byteLength;
  while (history.length > 2 && bytes() > AI_LIMITS.requestBytes) history = history.slice(2);
  if (bytes() > AI_LIMITS.requestBytes)
    throw new Error("The sketch context or latest conversation turn is too large. Use a smaller sketch or start a new conversation.");
  return { body: body(), omittedTurns: (all.length - history.length) / 2 };
}
export async function requestAiSketchProposal(provider: AiProvider, model: string, prompt: string,
  history: AiMessage[], context: AiSketchContext, signal: AbortSignal) {
  const prepared = prepareAiSketchRequest(provider, model, prompt, history, context);
  const response = await requestJson("/api/ai/sketch", signal, prepared.body);
  if (signal.aborted) throw new Error("AI sketch request canceled.");
  return validateAiSketchProposal(response.proposal);
}
