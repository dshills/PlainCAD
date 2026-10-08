import { prepareAiRepairPrompt } from "./conversation";
import { AI_LIMITS } from "./plan";

export interface FailedAiRequest {
  prompt: string;
  diagnostic: string;
}

/** A short repair request refers only to a captured failure in the current context. */
export function resolveAiFollowUp(prompt: string, failure?: FailedAiRequest) {
  const text = prompt.trim();
  if (!/^(?:please\s+)?(?:fix|repair)\s+(?:that|this|the (?:error|issue|preview))(?:[.!?])?$/i.test(text))
    return { prompt: text };
  if (!failure?.prompt.trim() || !failure.diagnostic.trim())
    return { prompt: text, clarification: "There is no current failed AI proposal to repair. Which issue should I fix? Describe the change or generate a preview to get a specific diagnostic." };
  const repair = prepareAiRepairPrompt(failure.prompt, failure.diagnostic);
  if (repair.text.length > AI_LIMITS.promptCharacters)
    return { prompt: text, clarification: "The original request and diagnostic are too long. Shorten the description before asking for a repair." };
  return { prompt: repair.text };
}
