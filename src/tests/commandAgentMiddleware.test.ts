// @vitest-environment node
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { createAiMiddleware } from "../../server/aiMiddleware";
import { createEmptyDocument } from "../cad/document/CadDocument";
it("serves command planning only through the bounded loopback AI gateway", async () => {
  const document = createEmptyDocument("Gateway project");
  const proposal = { kind: "clarification", label: "Choose size", summary: "What dimensions?", warnings: [], steps: [] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(proposal) }] })));
  const middleware = createAiMiddleware({ ANTHROPIC_API_KEY: "server-private-test-key" }, fetcher);
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing server address.");
    const url = `http://127.0.0.1:${address.port}`;
    const input = { provider: "anthropic", model: "test-model", prompt: "Create a rectangle part", history: [], commandContext: { session: 1, document, activeComponentId: document.rootComponentId, selection: [], native: false, bodies: [], diagnostics: [] } };
    const send = (origin: string, value: unknown) => fetch(`${url}/api/ai/commands`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(value) });
    expect((await send("https://foreign.example", input)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await send(url, input);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ proposal });
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await send(url, { ...input, commandContext: { ...input.commandContext, callbacks: [] } })).status).toBe(400);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
