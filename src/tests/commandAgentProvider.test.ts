// @vitest-environment node
import { bindCommand, type JsonValue } from "../commands/registry";
import { AI_LIMITS } from "../ai/plan";
import { expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { generateCommandAgentProposal, validateCommandAgentRequest } from "../../server/commandAgentProvider";
import { validateCommandAgentContext, validateCommandAgentProposal } from "../ai/commandAgentPlan";
import { prepareCommandAgentRequest, captureCommandAgentContext } from "../ai/commandAgentClient";
const document = createEmptyDocument("Agent project");
const context = { session: 1, document, activeComponentId: document.rootComponentId, selection: [], native: false, bodies: [], diagnostics: [] };
const proposal = { kind: "plan", label: "Rectangle part", summary: "Create an explicitly sized part.", warnings: [], steps: [
  { command: "cad.sketch.create", arguments: { name: "Outline", plane: "XY", as: "outline" } },
  { command: "cad.sketch.rectangle", arguments: { sketchId: "$outline", width: "40mm", height: "30mm" } },
  { command: "cad.feature.extrude", arguments: { sketchId: "$outline", distance: "5mm", operation: "newBody" } },
] };
function reply(provider: "anthropic" | "openai" | "google", value: unknown) {
  const text = JSON.stringify(value);
  return provider === "anthropic" ? { stop_reason: "end_turn", content: [{ type: "text", text }] } : provider === "openai" ? { status: "completed", output: [{ content: [{ type: "output_text", text }] }] } : { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] };
}
it.each(["anthropic", "openai", "google"] as const)("uses protected %s structured command planning with the same safe schemas", async provider => {
  const input = validateCommandAgentRequest({ provider, model: "test-model", prompt: "Create a 40 by 30 by 5 mm XY rectangle part", history: [], commandContext: context });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply(provider, { ...proposal, steps: proposal.steps.map(step => JSON.stringify(step)) }))));
  const env = { ANTHROPIC_API_KEY: "test-a", OPENAI_API_KEY: "test-o", GOOGLE_API_KEY: "test-g" };
  expect(await generateCommandAgentProposal(input, env, new AbortController().signal, fetcher)).toEqual(proposal);
  const payload = JSON.stringify(JSON.parse(fetcher.mock.calls[0][1].body));
  expect(payload).toContain("cad.feature.extrude"); expect(payload).toContain(document.id);
  expect(payload).not.toMatch(/test-a|test-o|test-g/); expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
it("preserves explicit clarification and rejects unsafe, oversized or executable proposals", () => {
  expect(validateCommandAgentProposal({ kind: "clarification", label: "Choose dimensions", summary: "What width and height?", warnings: [], steps: [] }).steps).toEqual([]);
  for (const command of ["document.import", "file.exportSTL", "history.undo", "ui.fake", "live.connect"])
    expect(() => validateCommandAgentProposal({ ...proposal, steps: [{ command, arguments: {} }] })).toThrow(/safe modeling/);
  expect(() => validateCommandAgentProposal({ ...proposal, steps: [{ command: "cad.feature.extrude", arguments: { sketchId: "$outline", distance: "5mm", script: "run()" } }] })).toThrow(/unsupported/);
  expect(() => validateCommandAgentProposal({ ...proposal, steps: Array(13).fill(proposal.steps[0]) })).toThrow(/limits/);
  expect(() => validateCommandAgentProposal({ ...proposal, kind: "clarification" })).toThrow(/no edits/);
  expect(() => validateCommandAgentContext({ ...context, meshes: [] })).toThrow(/unknown/);
  expect(() => validateCommandAgentContext({ ...context, document: { ...document, metadata: { notes: "x".repeat(22000) } } })).toThrow(/20 kB context budget/);
  expect(() => validateCommandAgentProposal(undefined)).toThrow(/no command proposal/);
  expect(() => validateCommandAgentRequest({ provider: "anthropic", model: "test", prompt: "Create", history: [], commandContext: context, credentials: "forbidden" })).toThrow(/unsupported/);
});
it("bounds conversation payloads without truncating a current project or half a turn", () => {
  const messages = Array.from({ length: 6 }, (_, index) => ({ role: (index % 2 ? "assistant" : "user") as "assistant" | "user", content: `Turn ${index} ` + "x".repeat(8000) }));
  const request = prepareCommandAgentRequest("openai", "test", "Create a part", messages, context);
  expect(request.history).toEqual(messages.slice(-2));
  expect(request.history.length).toBeGreaterThan(0);
  expect(request.history.length).toBeLessThan(messages.length);
  expect(request.history.length % 2).toBe(0); expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThanOrEqual(AI_LIMITS.requestBytes);
  expect(request.commandContext.document).toEqual(document);
});
it("does not forward provider error bodies or accept malformed returned commands", async () => {
  const input = validateCommandAgentRequest({ provider: "anthropic", model: "test", prompt: "Create a part", history: [], commandContext: context });
  const fetcher = vi.fn().mockResolvedValue(new Response("sensitive-provider-payload", { status: 401 }));
  const failure = await generateCommandAgentProposal(input, { ANTHROPIC_API_KEY: "test-secret" }, new AbortController().signal, fetcher).catch(error => error as Error);
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) throw new Error("Expected a provider diagnostic.");
  expect(failure.message).toMatch(/HTTP 401/); expect(failure.message).not.toContain("sensitive-provider-payload"); expect(failure.message).not.toContain("test-secret");
  fetcher.mockResolvedValue(new Response(JSON.stringify(reply("anthropic", { ...proposal, steps: ['{"command":"document.import","arguments":{}}'] }))));
  await expect(generateCommandAgentProposal(input, { ANTHROPIC_API_KEY: "test-secret" }, new AbortController().signal, fetcher)).rejects.toThrow(/invalid or unsupported/);
});

it("diagnoses malformed registry snapshots instead of throwing opaque property errors", async () => {
  let snapshot: unknown;
  const remove = bindCommand({ id: "runtime.snapshot", label: "Snapshot", kind: "system", input: {} }, { id: "domain", label: () => "Snapshot", available: () => undefined, invoke: () => snapshot as JsonValue });
  try {
    for (const value of [null, { session: 1, document, activeComponentId: document.rootComponentId },
      { session: 1, document, activeComponentId: document.rootComponentId, selection: { selectedIds: [] }, rebuild: { native: true, errors: [], bodies: [{ id: "body", assertions: null }] } }]) {
      snapshot = value;
      await expect(captureCommandAgentContext()).rejects.toThrow(/incomplete project snapshot/);
    }
    snapshot = { session: 1, document, activeComponentId: document.rootComponentId, selection: { selectedIds: [] }, rebuild: { native: false, errors: [], bodies: [] } };
    expect((await captureCommandAgentContext()).document.id).toBe(document.id);
  } finally { remove(); }
});
