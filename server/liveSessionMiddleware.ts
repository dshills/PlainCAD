import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { SECURITY_HEADERS } from "../deployment/securityHeaders";
import { parseBoundedJson } from "../src/persistence/importSafety";
import { commandRequest } from "../src/commands/protocol";

const PREFIX = "/api/live/";
const REQUEST_LIMIT = 6 * 1024 * 1024;
const RESPONSE_LIMIT = 16 * 1024 * 1024;
interface Pending {
  id: string;
  request: unknown;
  response: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
  delivered: boolean;
}
interface Connection {
  id: string;
  browserToken: string;
  agentToken: string;
  touched: number;
  pending: Map<string, Pending>;
  poll?: { response: ServerResponse; timer: ReturnType<typeof setTimeout> };
}
class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store", ...(status >= 400 ? { Connection: "close" } : {}) });
  response.end(JSON.stringify(value));
}
function localOrigin(request: IncomingMessage) {
  try {
    const host = new URL(`http://${request.headers.host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(host.hostname) &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "") &&
      request.headers["sec-fetch-site"] !== "cross-site" &&
      (!request.headers.origin || request.headers.origin === host.origin) ? host.origin : undefined;
  } catch { return undefined; }
}
function authenticated(request: IncomingMessage, token: string) {
  const candidate = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(candidate), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(request: IncomingMessage, maximum = REQUEST_LIMIT): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new RequestError("Use application/json.", 415);
  if (Number(request.headers["content-length"] ?? 0) > maximum) throw new RequestError("Live request exceeds its resource limit.", 413);
  const chunks: Buffer[] = []; let bytes = 0;
  const timer = setTimeout(() => request.destroy(), 10000);
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if ((bytes += data.length) > maximum) throw new RequestError("Live request exceeds its resource limit.", 413);
      chunks.push(data);
    }
    return parseBoundedJson(Buffer.concat(chunks).toString("utf8"), maximum, "Live request");
  } finally { clearTimeout(timer); }
}
/** An opt-in relay only: geometry and registry execution stay in the open browser. */
export function createLiveSessionMiddleware() {
  let connection: Connection | undefined;
  const reading = { agent: 0, browser: 0 };
  async function read(request: IncomingMessage, maximum = REQUEST_LIMIT, browser = false) {
    const owner = browser ? "browser" : "agent", limit = browser ? 2 : 4;
    if (reading[owner] >= limit) throw new RequestError("Live request readers are busy.", 429);
    reading[owner]++;
    try { return await body(request, maximum); } finally { reading[owner]--; }
  }
  function disconnect(reason: string) {
    const current = connection; connection = undefined;
    if (!current) return;
    if (current.poll) { clearTimeout(current.poll.timer); send(current.poll.response, 410, { error: reason }); }
    for (const pending of current.pending.values()) {
      clearTimeout(pending.timer);
      send(pending.response, 410, { error: reason, delivered: pending.delivered, retry: false });
    }
    current.pending.clear();
  }
  function expire() { if (connection && Date.now() - connection.touched > 90000) disconnect("The browser connection expired. Reconnect explicitly."); }
  function deliver(current: Connection) {
    const pending = [...current.pending.values()].find(item => !item.delivered);
    if (!pending || !current.poll) return;
    const poll = current.poll; current.poll = undefined;
    clearTimeout(poll.timer); pending.delivered = true; current.touched = Date.now();
    send(poll.response, 200, { id: pending.id, request: pending.request });
  }
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url?.split("?")[0];
    if (!path?.startsWith(PREFIX)) { next(); return; }
    const origin = localOrigin(request);
    if (!origin) { send(response, 403, { error: "Live access requires this computer's local application origin." }); return; }
    expire();
    if (path === `${PREFIX}status` && request.method === "GET") {
      send(response, 200, { connected: Boolean(connection), connectionId: connection?.id ?? null }); return;
    }
    if (request.method !== "POST") { send(response, 405, { error: "Use POST for live actions." }); return; }
    void (async () => {
      if (path === `${PREFIX}connect`) {
        if (request.headers.origin !== origin || request.headers["sec-fetch-site"] !== "same-origin") throw new RequestError("Connect from the application UI.", 403);
        const value = await read(request, 1024, true);
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) throw new RequestError("Connect takes no arguments.");
        if (connection) throw new RequestError("A browser is already connected. Disconnect it first.", 409);
        connection = { id: randomBytes(16).toString("hex"), browserToken: randomBytes(32).toString("hex"), agentToken: randomBytes(32).toString("hex"), touched: Date.now(), pending: new Map() };
        send(response, 200, { connectionId: connection.id, browserToken: connection.browserToken, agentToken: connection.agentToken }); return;
      }
      const current = connection;
      if (!current) throw new RequestError("No browser is connected. Use Connect live agent in the open project.", 410);
      const browserRoute = ["poll", "result", "disconnect"].some(route => path === PREFIX + route);
      if (!authenticated(request, browserRoute ? current.browserToken : current.agentToken)) throw new RequestError("Invalid live capability token.", 403);
      if (path === `${PREFIX}execute`) {
        const parsed = commandRequest(await read(request));
        if (!["commands.list", "runtime.snapshot"].includes(parsed.command) && parsed.session === undefined) throw new RequestError("Supply the inspected project session. Sessions are never refreshed automatically.");
        if (connection !== current) throw new RequestError("Browser disconnected while reading the request.", 410);
        if (current.pending.size >= 4) throw new RequestError("Live command queue is full.", 429);
        const id = randomBytes(16).toString("hex");
        const timer = setTimeout(() => {
          const pending = current.pending.get(id); current.pending.delete(id);
          send(response, 504, { error: "Live command timed out. Inspect the project before retrying.", delivered: pending?.delivered ?? false, retry: false });
        }, 65000);
        current.pending.set(id, { id, request: parsed, response, timer, delivered: false });
        response.on("close", () => { const item = current.pending.get(id); if (item && !item.delivered) { clearTimeout(item.timer); current.pending.delete(id); } });
        deliver(current); return;
      }
      if (!browserRoute) throw new RequestError("Unknown live endpoint.", 404);
      current.touched = Date.now();
      if (path === `${PREFIX}disconnect`) {
        const value = await read(request, 1024, true);
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) throw new RequestError("Disconnect takes no arguments.");
        if (connection !== current) throw new RequestError("Browser disconnected while reading the request.", 410);
        disconnect("The user disconnected live access."); send(response, 200, { connected: false }); return;
      }
      if (path === `${PREFIX}poll`) {
        const value = await read(request, 1024, true);
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) throw new RequestError("Poll takes no arguments.");
        if (connection !== current) throw new RequestError("Browser disconnected while reading the request.", 410);
        if (current.poll) throw new RequestError("A browser poll is already pending.", 409);
        const timer = setTimeout(() => { if (current.poll?.response === response) { current.poll = undefined; send(response, 200, { idle: true }); } }, 20000);
        current.poll = { response, timer };
        response.on("close", () => { if (current.poll?.response === response) { clearTimeout(timer); current.poll = undefined; } });
        deliver(current); return;
      }
      const value = await read(request, RESPONSE_LIMIT, true) as { id?: unknown; result?: unknown };
      if (!value || typeof value !== "object" || Object.keys(value).some(key => !["id", "result"].includes(key)) || typeof value.id !== "string" || value.result === undefined) throw new RequestError("Malformed command result.");
      const pending = current.pending.get(value.id);
      if (!pending?.delivered) throw new RequestError("Command expired or was not delivered.", 410);
      clearTimeout(pending.timer); current.pending.delete(value.id);
      send(pending.response, 200, value.result); send(response, 200, { received: true });
    })().catch(error => {
      send(response, error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : "Invalid live request." });
      if (!request.complete) response.once("finish", () => request.socket.destroySoon());
    });
  };
  return { middleware, close: () => disconnect("The local server closed.") };
}
export function liveSessionPlugin(): Plugin {
  const relay = createLiveSessionMiddleware();
  return {
    name: "plaincad-live-session",
    configureServer(server) { server.middlewares.use(relay.middleware); server.httpServer?.once("close", relay.close); },
    configurePreviewServer(server) { server.middlewares.use(relay.middleware); server.httpServer.once("close", relay.close); },
  };
}
