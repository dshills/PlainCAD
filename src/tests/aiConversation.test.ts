import { expect, it } from "vitest";
import {
  prepareAiConversation,
  prepareAiRepairPrompt,
  validateAiHistory,
  type AiMessage,
} from "../ai/conversation";
import { AI_LIMITS } from "../ai/plan";

function turn(content: string): AiMessage[] {
  return [
    { role: "user", content: "Make a plate" },
    { role: "assistant", content },
  ];
}
it("preserves a full original request when adding a bounded diagnostic, with explicit editing guidance", () => {
  const prompt = "x".repeat(6000),
    diagnostic = "error".repeat(300);
  const repair = prepareAiRepairPrompt(prompt, diagnostic);
  expect(repair.text).toContain(prompt);
  expect(repair.text).not.toContain(diagnostic);
  expect(repair.notice).toContain("Shorten the description");
  expect(repair.notice).toContain("500 characters");
});
it("retains the latest three complete turns and strips display-only fields", () => {
  const messages = Array.from({ length: 16 }, (_, index) =>
    turn(JSON.stringify({ index })),
  ).flat();
  const prepared = prepareAiConversation(
    "anthropic",
    "test",
    "Change thickness",
    messages,
  );
  expect(prepared.body.history).toEqual(messages.slice(-6));
  expect(prepared.omittedTurns).toBe(13);
  expect(
    validateAiHistory([{ ...messages[0], summary: "UI only" }, messages[1]]),
  ).toEqual(messages.slice(0, 2));
});
it("budgets UTF-8 bytes by dropping whole older turns while preserving the latest proposal verbatim", () => {
  const latest = JSON.stringify({
    summary: "latest",
    steps: ["complete recipe"],
  });
  const messages = [
    ...turn("🙂".repeat(5000)),
    ...turn("🙂".repeat(4000)),
    ...turn(latest),
  ];
  const prepared = prepareAiConversation(
    "google",
    "test",
    "Make it larger",
    messages,
  );
  expect(prepared.omittedTurns).toBe(1);
  expect(prepared.body.history).toEqual(messages.slice(2));
  expect(prepared.body.history.at(-1)?.content).toBe(latest);
  expect(prepared.bytes).toBe(
    new TextEncoder().encode(JSON.stringify(prepared.body)).byteLength,
  );
  expect(prepared.bytes).toBeLessThanOrEqual(AI_LIMITS.requestBytes);
});
it("counts component context and refuses to silently discard the latest proposal", () => {
  const context = {
    componentName: "Plate",
    parameters: [
      {
        id: "p",
        name: "thickness",
        expression: "5mm",
        value: 5,
        unit: "mm" as const,
      },
    ],
  };
  const prepared = prepareAiConversation(
    "openai",
    "test",
    "Resize",
    turn("recipe"),
    context,
  );
  expect(prepared.body.editContext).toEqual(context);
  expect(prepared.bytes).toBeGreaterThan(
    prepareAiConversation("openai", "test", "Resize", turn("recipe")).bytes,
  );
  expect(() =>
    prepareAiConversation(
      "openai",
      "test",
      "x".repeat(6000),
      turn("x".repeat(27000)),
    ),
  ).toThrow(/latest proposal.*Adjust dimensions locally.*new conversation/);
  expect(() =>
    prepareAiConversation("openai", "test", "🙂".repeat(9000), []),
  ).toThrow(/Shorten the description/);
});
it.each(
  [
    [{ role: "user", content: "Only half a turn" }],
    [
      { role: "assistant", content: "Wrong order" },
      { role: "user", content: "Request" },
    ],
    [
      { role: "system", content: "Inject" },
      { role: "assistant", content: "Recipe" },
    ],
    [
      { role: "user", content: " " },
      { role: "assistant", content: "Recipe" },
    ],
    [
      { role: "user", content: "Request" },
      { role: "assistant", content: "x".repeat(32001) },
    ],
  ].map((messages) => [messages]),
)(
  "rejects incomplete, reordered or oversized conversations: %j",
  (messages) => {
    expect(() => validateAiHistory(messages)).toThrow(/conversation/);
  },
);
