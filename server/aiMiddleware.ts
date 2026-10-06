import { generateAiSketchProposal, validateSketchAiRequest, type SketchAiRequest } from "./sketchAiProvider";
import { generateAiFeatureAddProposal, validateFeatureAddAiRequest, type FeatureAddAiRequest } from "./featureAddAiProvider";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { SECURITY_HEADERS } from "../deployment/securityHeaders";
import { AI_LIMITS } from "../src/ai/plan";
import { parseProjectJson } from "../src/persistence/importSafety";
import {
  generateAiPlan,
  AiProviderError,
  publicProviderStatus,
  validateAiRequest,
  type AiEnvironment,
  type AiRequest,
} from "./aiProvider";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function localRequest(request: IncomingMessage) {
  try {
    const scheme =
      "encrypted" in request.socket && request.socket.encrypted
        ? "https"
        : "http";
    const host = new URL(`${scheme}://${request.headers.host}`);
    const address = request.socket.remoteAddress;
    if (
      !LOCAL_HOSTS.has(host.hostname) ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? "")
    )
      return false;
    if (request.headers["sec-fetch-site"] === "cross-site") return false;
    const origin = request.headers.origin;
    return !origin || origin === host.origin;
  } catch {
    return false;
  }
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(status >= 400 ? { Connection: "close" } : {}),
  });
  response.end(JSON.stringify(value));
}
async function readRequest(request: IncomingMessage, route: "part" | "sketch" | "features"): Promise<{ kind: "sketch"; request: SketchAiRequest } | { kind: "part"; request: AiRequest } | { kind: "features"; request: FeatureAddAiRequest }> {
  if (
    request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new AiRequestError("AI requests require application/json.", 415);
  let bytes = 0;
  const chunks: Buffer[] = [];
  // Preserve the socket on an early limit error so the client receives 413.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if ((bytes += buffer.length) > AI_LIMITS.requestBytes)
      throw new AiRequestError(
        "AI request is too large. Shorten the conversation.",
        413,
      );
    chunks.push(buffer);
  }
  const value = parseProjectJson(Buffer.concat(chunks).toString("utf8"));
  if (route === "features") return { kind: "features", request: validateFeatureAddAiRequest(value) };
  return route === "sketch"
    ? { kind: "sketch", request: validateSketchAiRequest(value) }
    : { kind: "part", request: validateAiRequest(value) };
}
/** Only loopback callers may use local environment credentials, including under --host. */
export function createAiMiddleware(
  env: AiEnvironment,
  fetcher: typeof fetch = fetch,
) {
  let busy = false;
  let recent: number[] = [];
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const path = request.url?.split("?")[0];
    if (path !== "/api/ai/status" && path !== "/api/ai/generate" && path !== "/api/ai/sketch" && path !== "/api/ai/features") {
      next();
      return;
    }
    if (!localRequest(request)) {
      send(response, 403, {
        error:
          "AI access is available only from this computer at the local application origin.",
      });
      return;
    }
    if (path === "/api/ai/status" && request.method === "GET") {
      send(response, 200, { providers: publicProviderStatus(env) });
      return;
    }
    if (!["/api/ai/generate", "/api/ai/sketch", "/api/ai/features"].includes(path ?? "") || request.method !== "POST") {
      send(response, 405, { error: "Unsupported AI request method." });
      return;
    }
    recent = recent.filter((time) => Date.now() - time < 60000);
    if (busy || recent.length >= 8) {
      send(response, 429, {
        error:
          "AI is busy or receiving too many requests. Wait a moment and try again.",
      });
      return;
    }
    busy = true;
    recent.push(Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    const abort = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on("close", abort);
    request.on("aborted", abort);
    const bodyTimer = setTimeout(() => request.destroy(), 10000);
    void (async () => {
      let parsed;
      try {
        parsed = await readRequest(request, path === "/api/ai/sketch" ? "sketch" : path === "/api/ai/features" ? "features" : "part");
      } catch (error) {
        // Do not drain an unbounded rejected body. Flush the diagnostic before
        // closing its socket, including wrong-content-type and malformed requests.
        response.once("finish", () => request.socket.destroySoon());
        send(response, error instanceof AiRequestError ? error.status : 400, {
          error: error instanceof Error ? error.message : "Invalid AI request.",
        });
        return;
      } finally {
        clearTimeout(bodyTimer);
      }
      if (controller.signal.aborted) return;
      try {
        if (parsed.kind === "features") {
          const proposal = await generateAiFeatureAddProposal(parsed.request, env, controller.signal, fetcher);
          if (!controller.signal.aborted) send(response, 200, { proposal });
          return;
        }
        if (parsed.kind === "sketch") {
          const proposal = await generateAiSketchProposal(parsed.request, env, controller.signal, fetcher);
          if (!controller.signal.aborted) send(response, 200, { proposal });
          return;
        }
        const plan = await generateAiPlan(
          parsed.request,
          env,
          controller.signal,
          fetcher,
        );
        if (!controller.signal.aborted) send(response, 200, { plan });
      } catch (error) {
        send(response, 502, {
          error: controller.signal.aborted
            ? "AI request was canceled or timed out. Try a simpler description."
            : error instanceof AiProviderError
              ? error.message
              : "AI returned an unreadable response. Try again or choose another model.",
        });
      }
    })().finally(() => {
      busy = false;
      clearTimeout(timer);
      clearTimeout(bodyTimer);
      response.off("close", abort);
      request.off("aborted", abort);
    });
  };
}
export function aiPlugin(): Plugin {
  let env: AiEnvironment = {};
  return {
    name: "plaincad-local-ai",
    configResolved(config) {
      env = { ...loadEnv(config.mode, config.envDir, ""), ...process.env };
    },
    configureServer(server) {
      server.middlewares.use(createAiMiddleware(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createAiMiddleware(env));
    },
  };
}
