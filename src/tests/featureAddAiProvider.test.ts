// @vitest-environment node
import { expect, it, vi } from "vitest";
import { generateAiFeatureAddProposal, validateFeatureAddAiRequest } from "../../server/featureAddAiProvider";
const context = { componentName: "Plate", face: { id: "extrude:plate:endCap", label: "Plate end cap", bodyId: "body:plate", bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 } }, edges: [], parameters: [] };
const proposal = { summary: "Add a hole", warnings: [], actions: [{ kind: "holes", centers: [{ x: "10mm", y: "10mm" }], diameter: "3mm", depth: "throughAll" }] };
function reply(provider: "anthropic" | "openai" | "google", value: unknown) {
  const text = JSON.stringify(value);
  return provider === "anthropic" ? { stop_reason: "end_turn", content: [{ type: "text", text }] } : provider === "openai" ? { status: "completed", output: [{ content: [{ type: "output_text", text }] }] } : { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] };
}
it.each(["anthropic", "openai", "google"] as const)("uses %s protected structured transport for bounded feature additions", async (provider) => {
  const input = validateFeatureAddAiRequest({ provider, model: "test-model", prompt: "Add a 3 mm hole", history: [], featureContext: context });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply(provider, { ...proposal, actions: proposal.actions.map((action) => JSON.stringify(action)) }))));
  const env = { ANTHROPIC_API_KEY: "test-a", OPENAI_API_KEY: "test-o", GOOGLE_API_KEY: "test-g" };
  expect(await generateAiFeatureAddProposal(input, env, new AbortController().signal, fetcher)).toEqual(proposal);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.stringify(body)).toContain(context.face.id);
  expect(JSON.stringify(body)).not.toMatch(/test-a|test-o|test-g/);
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
it("preserves clarification/refusal diagnostics and rejects arbitrary geometry, actions and unsafe JSON", async () => {
  const input = validateFeatureAddAiRequest({ provider: "anthropic", model: "test-model", prompt: "Add holes", history: [], featureContext: context });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { summary: "Which coordinates?", warnings: [], actions: [] }))));
  expect((await generateAiFeatureAddProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).actions).toEqual([]);
  expect(() => validateFeatureAddAiRequest({ ...input, document: {} })).toThrow(/unsupported/);
  expect(() => validateFeatureAddAiRequest({ ...input, featureContext: { ...context, meshes: [] } })).toThrow(/unsupported/);
  fetcher.mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { ...proposal, actions: ['{"kind":"script","code":"alert(1)"}'] }))));
  await expect(generateAiFeatureAddProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).rejects.toThrow(/unsupported/);
  fetcher.mockResolvedValue(new Response(JSON.stringify(reply("anthropic", proposal))));
  await expect(generateAiFeatureAddProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).rejects.toThrow(/invalid or unsupported/);
  fetcher.mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { ...proposal, actions: ['{"__proto__":{"polluted":true}}'] }))));
  await expect(generateAiFeatureAddProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).rejects.toThrow();
  expect(Object.prototype).not.toHaveProperty("polluted");
  fetcher.mockResolvedValue(new Response(JSON.stringify({ stop_reason: "max_tokens", content: [] })));
  await expect(generateAiFeatureAddProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).rejects.toThrow(/incomplete/);
});
