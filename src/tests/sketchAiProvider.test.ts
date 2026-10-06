// @vitest-environment node
import { expect, it, vi } from "vitest";
import { generateAiSketchProposal, validateSketchAiRequest } from "../../server/sketchAiProvider";
import { aiSketchContext } from "../ai/sketchEditPlan";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";

function request(provider: "anthropic" | "openai" | "google") {
  const sketch = addCornerRectangle(createXySketch(), "24mm", "16mm");
  return { provider, model: "test-model", prompt: "Make it 30 by 20 mm", history: [], sketchContext: aiSketchContext(upsertSketch(createEmptyDocument(), sketch), sketch.id, [], "preserve") };
}
const proposal = { summary: "Resize the rectangle", warnings: [], actions: [{ kind: "rectangle", width: "30mm", height: "20mm" }] };
function reply(provider: "anthropic" | "openai" | "google", value: unknown) {
  const text = JSON.stringify(value);
  return provider === "anthropic" ? { stop_reason: "end_turn", content: [{ type: "text", text }] } : provider === "openai" ? { status: "completed", output: [{ content: [{ type: "output_text", text }] }] } : { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] };
}
it.each(["anthropic", "openai", "google"] as const)("uses %s structured transport for bounded sketch context and conversation", async (provider) => {
  const input = validateSketchAiRequest({ ...request(provider), history: [{ role: "user", content: "Resize" }, { role: "assistant", content: "What size?" }] });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply(provider, { ...proposal, actions: proposal.actions.map((action) => JSON.stringify(action)) }))));
  expect(await generateAiSketchProposal(input, { ANTHROPIC_API_KEY: "test-key-a", OPENAI_API_KEY: "test-key-o", GOOGLE_API_KEY: "test-key-g" }, new AbortController().signal, fetcher)).toEqual(proposal);
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.stringify(sent)).toContain(input.sketchContext.sketchId);
  expect(JSON.stringify(sent)).toContain("What size?");
  expect(JSON.stringify(sent)).toContain("bindingPolicy");
  expect(JSON.stringify(sent)).not.toContain("test-key");
  expect(JSON.stringify(sent)).not.toContain("steps");
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  const [url, init] = fetcher.mock.calls[0];
  expect(url).not.toContain("test-key");
  const expected = provider === "anthropic" ? "test-key-a" : provider === "openai" ? "test-key-o" : "test-key-g";
  expect(JSON.stringify(init.headers)).toContain(expected);
  for (const key of ["test-key-a", "test-key-o", "test-key-g"].filter((key) => key !== expected)) expect(JSON.stringify(init)).not.toContain(key);
});
it("keeps clarification actions empty and rejects unsupported or unsafe data", async () => {
  const input = request("anthropic"), fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { summary: "Which edge?", warnings: [], actions: [] }))));
  expect((await generateAiSketchProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).actions).toEqual([]);
  expect(() => validateSketchAiRequest({ ...input, document: {} })).toThrow(/unsupported/);
  expect(() => validateSketchAiRequest({ ...input, sketchContext: { ...input.sketchContext, meshes: [] } })).toThrow(/format/);
  fetcher.mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { ...proposal, actions: ['{"kind":"script","code":"alert(1)"}'] }))));
  await expect(generateAiSketchProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).rejects.toThrow(/unsupported/);
  fetcher.mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { ...proposal, actions: ['{"__proto__":{"polluted":true}}'] }))));
  await expect(generateAiSketchProposal(input, { ANTHROPIC_API_KEY: "test" }, new AbortController().signal, fetcher)).rejects.toThrow();
});
it.each(["anthropic", "openai", "google"] as const)("preserves %s refusal/incomplete diagnostics and limits upstream failures", async (provider) => {
  const input = request(provider), env = { ANTHROPIC_API_KEY: "test-key-a", OPENAI_API_KEY: "test-key-o", GOOGLE_API_KEY: "test-key-g" };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  await expect(generateAiSketchProposal(input, env, new AbortController().signal, fetcher)).rejects.toThrow(/incomplete/);
  fetcher.mockResolvedValue(new Response("test-key-a", { status: 401 }));
  await expect(generateAiSketchProposal(input, env, new AbortController().signal, fetcher)).rejects.toThrow(/Check the server API key/);
  const missing = vi.fn();
  await expect(generateAiSketchProposal(input, {}, new AbortController().signal, missing)).rejects.toThrow(/not configured/);
  expect(missing).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort();
  fetcher.mockRejectedValue(new Error("test-key-a"));
  await expect(generateAiSketchProposal(input, env, controller.signal, fetcher)).rejects.toThrow(/canceled/);
});
