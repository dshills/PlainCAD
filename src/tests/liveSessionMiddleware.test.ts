// @vitest-environment node
import { createServer, request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createLiveSessionMiddleware } from "../../server/liveSessionMiddleware";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });
async function server() {
  const relay = createLiveSessionMiddleware();
  const http = createServer((request, response) => relay.middleware(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => { relay.close(); http.closeAllConnections(); http.close(error => error ? reject(error) : resolve()); }));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing test address.");
  const url = `http://127.0.0.1:${address.port}`;
  const post = (route: string, value: unknown, token?: string, headers: Record<string, string> = {}) => fetch(`${url}/api/live/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(value) });
  const connect = async () => {
    const response = await post("connect", {}, undefined, { Origin: url, "Sec-Fetch-Site": "same-origin" });
    expect(response.status).toBe(200);
    return response.json() as Promise<{ connectionId: string; browserToken: string; agentToken: string }>;
  };
  return { url, post, connect };
}
it("requires local origin and explicit browser connect and never discovers capabilities publicly", async () => {
  const { url, post, connect } = await server();
  expect((await post("connect", {})).status).toBe(403);
  expect((await post("connect", {}, undefined, { Origin: "https://foreign.example", "Sec-Fetch-Site": "same-origin" })).status).toBe(403);
  const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
    httpRequest(`${url}/api/live/status`, { headers: { Host: "foreign.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject).end();
  });
  expect(foreignHost).toBe(403);
  const connection = await connect();
  expect(connection.browserToken).not.toBe(connection.agentToken);
  const status = await fetch(`${url}/api/live/status`);
  expect(status.headers.get("cache-control")).toBe("no-store");
  const text = await status.text();
  expect(text).not.toContain(connection.browserToken);
  expect(text).not.toContain(connection.agentToken);
  expect((await post("execute", { command: "runtime.snapshot" }, connection.browserToken)).status).toBe(403);
  expect((await post("poll", {}, connection.agentToken)).status).toBe(403);
  expect((await post("connect", {}, undefined, { Origin: url, "Sec-Fetch-Site": "same-origin" })).status).toBe(409);
});
it("relays unchanged registry requests and replies only to the matching delivered request", async () => {
  const { post, connect } = await server(), connection = await connect();
  const command = { command: "parameter.update", session: 7, arguments: { parameterId: "thickness", patch: { expression: "8 mm" } } };
  const waiting = post("execute", command, connection.agentToken);
  const poll = await post("poll", {}, connection.browserToken);
  const delivered = await poll.json() as { id: string; request: unknown };
  expect(delivered.request).toEqual(command);
  expect((await post("result", { id: "unknown", result: { ok: true } }, connection.browserToken)).status).toBe(410);
  const result = { ok: false, command: "parameter.update", error: { code: "stale_session", message: "Project changed." } };
  expect((await post("result", { id: delivered.id, result }, connection.browserToken)).status).toBe(200);
  expect(await (await waiting).json()).toEqual(result);
  expect((await post("execute", { command: "parameter.update", arguments: command.arguments }, connection.agentToken)).status).toBe(400);
});
it("disconnect revokes tokens, rejects unfinished delivery without suggesting retry, and permits a fresh connection", async () => {
  const { post, connect } = await server(), connection = await connect();
  const waiting = post("execute", { command: "runtime.snapshot" }, connection.agentToken);
  const delivered = await (await post("poll", {}, connection.browserToken)).json() as { id: string };
  expect(delivered.id).toBeTruthy();
  expect((await post("disconnect", {}, connection.browserToken)).status).toBe(200);
  expect(await (await waiting).json()).toMatchObject({ delivered: true, retry: false });
  const fresh = await connect();
  expect(fresh.agentToken).not.toBe(connection.agentToken);
  expect((await post("execute", { command: "runtime.snapshot" }, connection.agentToken)).status).toBe(403);
  expect((await post("result", { id: delivered.id, result: { ok: true } }, connection.browserToken)).status).toBe(403);
});
it("rejects unsafe JSON, oversized requests, unsupported routes and wrong content type", async () => {
  const { url, post, connect } = await server(), connection = await connect();
  expect((await fetch(`${url}/api/live/execute`, { method: "POST", headers: { Authorization: `Bearer ${connection.agentToken}`, "Content-Type": "application/json" }, body: '{"command":"runtime.snapshot","__proto__":{}}' })).status).toBe(400);
  expect((await fetch(`${url}/api/live/execute`, { method: "POST", headers: { Authorization: `Bearer ${connection.agentToken}` }, body: "{}" })).status).toBe(415);
  const oversized = await new Promise<number | undefined>((resolve, reject) => {
    httpRequest(`${url}/api/live/execute`, { method: "POST", headers: { Authorization: `Bearer ${connection.agentToken}`, "Content-Type": "application/json", "Content-Length": 6 * 1024 * 1024 + 1 } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject).end();
  });
  expect(oversized).toBe(413);
  expect((await post("unknown", {}, connection.agentToken)).status).toBe(404);
});

it("retains long delivered commands within the execution budget and expires idle capabilities afterwards", async () => {
  const { url, post, connect } = await server(), connection = await connect();
  const waiting = post("execute", { command: "runtime.snapshot" }, connection.agentToken);
  await post("poll", {}, connection.browserToken);
  const now = Date.now(), clock = vi.spyOn(Date, "now");
  try {
    clock.mockReturnValue(now + 50000);
    expect(await (await fetch(`${url}/api/live/status`)).json()).toMatchObject({ connected: true });
    clock.mockReturnValue(now + 91000);
    expect(await (await fetch(`${url}/api/live/status`)).json()).toMatchObject({ connected: false });
    expect(await (await waiting).json()).toMatchObject({ delivered: true, retry: false });
  } finally { clock.mockRestore(); }
});
