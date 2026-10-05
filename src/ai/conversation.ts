import { AI_LIMITS, type AiEditContext, type AiProvider } from "./plan";
export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export function prepareAiRepairPrompt(prompt: string, diagnostic: string) {
  const characters = Array.from(diagnostic);
  const excerpt =
    characters.length > 500
      ? `${characters.slice(0, 500).join("")}…`
      : diagnostic;
  const text = `Original request:\n${prompt}\nPlease revise the full proposal to fix this preview diagnostic:\n${excerpt}`;
  const notice =
    text.length > AI_LIMITS.promptCharacters
      ? "The original request is preserved. Shorten the description before generating a follow-up."
      : "Diagnostic added to the description. Review it, then Generate preview.";
  return {
    text,
    notice:
      characters.length > 500
        ? `${notice} The diagnostic excerpt is limited to 500 characters.`
        : notice,
  };
}

export function validateAiHistory(
  value: unknown,
  maxMessages: number = AI_LIMITS.history,
): AiMessage[] {
  if (!Array.isArray(value) || value.length > maxMessages || value.length % 2)
    throw new Error(
      "AI conversation must contain complete turns. Start a new conversation.",
    );
  return value.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.role !== (index % 2 ? "assistant" : "user") ||
      typeof entry.content !== "string" ||
      !entry.content.trim() ||
      entry.content.length > AI_LIMITS.historyEntryCharacters
    )
      throw new Error(
        "AI conversation contains an invalid or oversized turn. Start a new conversation.",
      );
    return { role: entry.role, content: entry.content };
  });
}

/** Trim whole older turns, never a recipe or half a turn. Keep the latest proposal
 * intact or require an explicit reset rather than silently forgetting its intent. */
export function prepareAiConversation(
  provider: AiProvider,
  model: string,
  prompt: string,
  messages: AiMessage[],
  editContext?: AiEditContext,
) {
  return createAiConversationBudget(
    provider,
    model,
    messages,
    editContext,
  )(prompt);
}

/** Cache history/context serialization separately so typing only encodes the prompt. */
export function createAiConversationBudget(
  provider: AiProvider,
  model: string,
  messages: AiMessage[],
  editContext?: AiEditContext,
) {
  const all = validateAiHistory(messages, AI_LIMITS.transcriptMessages);
  const size = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const recent = all.slice(-AI_LIMITS.history);
  const costs = recent.map((message) => size(message));
  const base = {
    provider,
    model,
    prompt: "",
    history: [] as AiMessage[],
    ...(editContext ? { editContext } : {}),
  };
  const fixed = size(base) - size("");
  return (prompt: string) => {
    const baseBytes = fixed + size(prompt);
    let start = 0;
    const total = () =>
      baseBytes +
      costs.slice(start).reduce((sum, cost) => sum + cost, 0) +
      Math.max(0, recent.length - start - 1);
    let bytes = total();
    while (recent.length - start > 2 && bytes > AI_LIMITS.requestBytes) {
      start += 2;
      bytes = total();
    }
    if (bytes > AI_LIMITS.requestBytes)
      throw new Error(
        recent.length && baseBytes <= AI_LIMITS.requestBytes
          ? "The latest proposal is too large for this follow-up. Adjust dimensions locally or start a new conversation."
          : "The description and component context are too large. Shorten the description or choose a smaller component.",
      );
    const history = recent.slice(start);
    return {
      body: { ...base, prompt, history },
      bytes,
      omittedTurns: (all.length - history.length) / 2,
    };
  };
}
