// @vitest-environment node
import { createServer, request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createAiMiddleware } from "../../server/aiMiddleware";
import { aiPlatePlan } from "./fixtures/aiPlan";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function server(fetcher: typeof fetch = vi.fn()) {
  const middleware = createAiMiddleware(
    { ANTHROPIC_API_KEY: "server-only-secret" },
    fetcher,
  );
  const httpServer = createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        httpServer.closeAllConnections();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = httpServer.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  return `http://127.0.0.1:${address.port}`;
}
const input = {
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  prompt: "Make a plate",
  history: [],
};
it("serves only public configuration on loopback and blocks foreign origins/hosts before using credentials", async () => {
  const fetcher = vi.fn(),
    url = await server(fetcher);
  const status = await fetch(`${url}/api/ai/status`);
  expect(status.headers.get("cache-control")).toBe("no-store");
  expect(await status.text()).not.toContain("server-only-secret");
  const foreign = await fetch(`${url}/api/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://foreign.example",
    },
    body: JSON.stringify(input),
  });
  expect(foreign.status).toBe(403);
  const hostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      httpRequest(
        `${url}/api/ai/status`,
        { headers: { Host: "foreign.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
        .on("error", reject)
        .end();
    },
  );
  expect(hostStatus).toBe(403);
  const crossSite = await fetch(`${url}/api/ai/status`, {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  expect(crossSite.status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("accepts a bounded same-origin request and returns a validated recipe under the production CSP", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(aiPlatePlan) }],
      }),
    ),
  );
  const url = await server(fetcher);
  const result = await fetch(`${url}/api/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: url },
    body: JSON.stringify(input),
  });
  expect(result.status).toBe(200);
  expect(result.headers.get("content-security-policy")).toContain(
    "connect-src 'self'",
  );
  expect(await result.json()).toEqual({ plan: aiPlatePlan });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { "x-api-key": "server-only-secret" },
    signal: expect.any(AbortSignal),
  });
});
it("rejects unsupported methods and invalid bodies without making an upstream call", async () => {
  const fetcher = vi.fn(),
    url = await server(fetcher);
  expect((await fetch(`${url}/api/ai/generate`)).status).toBe(405);
  expect(
    (
      await fetch(`${url}/api/ai/generate`, {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await fetch(`${url}/api/ai/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, prompt: "x".repeat(6001) }),
      })
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it("refuses concurrent generation and aborts the upstream request when the client cancels", async () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  const url = await server(fetcher);
  const controller = new AbortController();
  const pending = fetch(`${url}/api/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: controller.signal,
  }).catch(() => undefined);
  await vi.waitFor(() => expect(signal).toBeDefined());
  const concurrent = await fetch(`${url}/api/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(concurrent.status).toBe(429);
  controller.abort();
  await pending;
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not forward low-level upstream stream errors or echoed credentials", async () => {
  const fetcher = vi.fn().mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("server-only-secret"));
          },
        }),
      ),
  );
  const url = await server(fetcher);
  const response = await fetch(`${url}/api/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(502);
  const body = await response.text();
  expect(body).toContain("unreadable response");
  expect(body).not.toContain("server-only-secret");
});
it("returns an actionable 413 for oversized bodies without destroying the response socket", async () => {
  const fetcher = vi.fn(),
    url = await server(fetcher);
  const response = await fetch(`${url}/api/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, prompt: "x".repeat(40000) }),
  });
  expect(response.status).toBe(413);
  expect(await response.text()).toContain("request is too large");
  expect(fetcher).not.toHaveBeenCalled();
});

const sketchContext = { sketchId: "sketch_test", selectedIds: [], bindingPolicy: "preserve", geometry: [], dimensions: [], constraints: [], parameters: [] };
it("routes sketch edits through the protected gateway without sharing full projects or upstream secrets", async () => {
  const proposal = { summary: "Which line should be trimmed?", warnings: [], actions: [] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(proposal) }] })));
  const url = await server(fetcher), body = JSON.stringify({ ...input, sketchContext });
  const foreign = await fetch(`${url}/api/ai/sketch`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://foreign.example" }, body });
  expect(foreign.status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  const response = await fetch(`${url}/api/ai/sketch`, { method: "POST", headers: { "Content-Type": "application/json", Origin: url }, body });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ proposal });
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.stringify(sent)).toContain("sketch_test");
  expect(JSON.stringify(sent)).not.toContain("server-only-secret");
  const unsafe = await fetch(`${url}/api/ai/sketch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, sketchContext: { ...sketchContext, meshes: [] } }) });
  expect(unsafe.status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("shares busy and cancellation controls between full-part AI and sketch AI", async () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
    signal = init?.signal as AbortSignal;
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const url = await server(fetcher), controller = new AbortController();
  const pending = fetch(`${url}/api/ai/sketch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, sketchContext }), signal: controller.signal }).catch(() => undefined);
  await vi.waitFor(() => expect(signal).toBeDefined());
  const concurrent = await fetch(`${url}/api/ai/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  expect(concurrent.status).toBe(429);
  controller.abort(); await pending;
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
