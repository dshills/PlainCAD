import { afterEach, expect, it, vi } from "vitest";
import { registerLiveSessionCommands, connectLiveSession, disconnectLiveSession, copyLiveCapability, useLiveSessionState } from "../commands/liveSession";
import { configureCommandRuntime, executeCommand, bindCommand } from "../commands/registry";

afterEach(async () => { await disconnectLiveSession(); vi.unstubAllGlobals(); vi.useRealTimers(); useLiveSessionState.setState({ error: undefined }); });
it("requires a trusted local connection and does not serialize its capabilities through discovery", async () => {
  registerLiveSessionCommands(); configureCommandRuntime(() => 1);
  expect(await executeCommand({ command: "live.connect", session: 1, arguments: {} })).toMatchObject({ ok: false });
  await expect(Promise.resolve().then(() => connectLiveSession(false))).rejects.toThrow("direct click");
  const fetcher = vi.fn((input: string, options: RequestInit) => {
    if (input.endsWith("connect")) return Promise.resolve(new Response(JSON.stringify({ connectionId: "c".repeat(32), agentToken: "a".repeat(64), browserToken: "b".repeat(64) })));
    if (input.endsWith("disconnect")) return Promise.resolve(new Response('{"connected":false}'));
    return new Promise<Response>((_, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  vi.stubGlobal("fetch", fetcher);
  await connectLiveSession(true);
  expect(useLiveSessionState.getState().status).toBe("connected");
  const status = JSON.stringify(await executeCommand({ command: "live.status", session: 1, arguments: {} }));
  expect(status).not.toContain("a".repeat(64)); expect(status).not.toContain("b".repeat(64));
  const writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await expect(copyLiveCapability(false)).rejects.toThrow("direct click");
  await copyLiveCapability(true); expect(writeText).toHaveBeenCalledWith("a".repeat(64));
  await disconnectLiveSession(); expect(useLiveSessionState.getState().status).toBe("disconnected");
});
it("does not dispatch a queued response arriving after the user disconnects", async () => {
  registerLiveSessionCommands(); configureCommandRuntime(() => 1);
  const invoke = vi.fn();
  const remove = bindCommand({ id: "test.liveDelayed", label: "Delayed", kind: "domain", input: {} }, { id: "domain", label: () => "Delayed", available: () => undefined, invoke });
  let resolvePoll: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn((input: string) => {
    if (input.endsWith("connect")) return Promise.resolve(new Response(JSON.stringify({ connectionId: "c".repeat(32), agentToken: "a".repeat(64), browserToken: "b".repeat(64) })));
    if (input.endsWith("disconnect")) return Promise.resolve(new Response('{}'));
    return new Promise<Response>(resolve => { resolvePoll = resolve; });
  }));
  try {
  await connectLiveSession(true);
  await vi.waitFor(() => expect(resolvePoll).toBeDefined());
  await disconnectLiveSession();
  resolvePoll!(new Response(JSON.stringify({ id: "d".repeat(32), request: { command: "test.liveDelayed", session: 1 } })));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(invoke).not.toHaveBeenCalled();
  } finally { remove(); }
});

it("releases the server capability when polling fails", async () => {
  registerLiveSessionCommands();
  const fetcher = vi.fn((input: string) => {
    if (input.endsWith("connect")) return Promise.resolve(new Response(JSON.stringify({ connectionId: "c".repeat(32), agentToken: "a".repeat(64), browserToken: "b".repeat(64) })));
    if (input.endsWith("disconnect")) return Promise.resolve(new Response('{}'));
    return Promise.reject(new Error("Polling failed."));
  });
  vi.stubGlobal("fetch", fetcher);
  await connectLiveSession(true);
  await vi.waitFor(() => expect(useLiveSessionState.getState().error).toBe("Polling failed."));
  expect(fetcher.mock.calls.some(([input]) => input.endsWith("disconnect"))).toBe(true);
  expect(useLiveSessionState.getState().status).toBe("disconnected");
});

function stuckResponse(options: RequestInit) {
  return new Promise<Response>((_, reject) => {
    if (options.signal?.aborted) reject(options.signal.reason);
    else options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
  });
}
it("leaves Connecting with a useful diagnostic when the gateway never responds", async () => {
  vi.useFakeTimers(); registerLiveSessionCommands();
  vi.stubGlobal("fetch", vi.fn((_input: string, options: RequestInit) => stuckResponse(options)));
  const pending = Promise.resolve(connectLiveSession(true));
  const rejected = expect(pending).rejects.toThrow("Live connect request timed out");
  expect(useLiveSessionState.getState().status).toBe("connecting");
  await vi.advanceTimersByTimeAsync(9999);
  expect(useLiveSessionState.getState().status).toBe("connecting");
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(useLiveSessionState.getState()).toMatchObject({ status: "disconnected", error: expect.stringContaining("Reconnect") });
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["poll", "result"] as const)("disconnects and revokes the capability after a stuck %s request", async route => {
  vi.useFakeTimers(); registerLiveSessionCommands(); configureCommandRuntime(() => 1);
  const remove = bindCommand({ id: "test.liveTimeout", label: "Timeout", kind: "domain", input: {} }, { id: "domain", label: () => "Timeout", available: () => undefined, invoke: () => ({ inspected: true }) });
  const fetcher = vi.fn((input: string, options: RequestInit) => {
    if (input.endsWith("connect")) return Promise.resolve(new Response(JSON.stringify({ connectionId: "c".repeat(32), agentToken: "a".repeat(64), browserToken: "b".repeat(64) })));
    if (input.endsWith("disconnect")) return Promise.resolve(new Response('{}'));
    if (route === "result" && input.endsWith("poll")) return Promise.resolve(new Response(JSON.stringify({ id: "d".repeat(32), request: { command: "test.liveTimeout", session: 1 } })));
    return stuckResponse(options);
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    await connectLiveSession(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(useLiveSessionState.getState().status).toBe("connected");
    const deadline = route === "poll" ? 30000 : 10000;
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(useLiveSessionState.getState().status).toBe("connected");
    await vi.advanceTimersByTimeAsync(1);
    expect(useLiveSessionState.getState()).toMatchObject({ status: "disconnected", completed: 0, error: expect.stringContaining(`Live ${route} request timed out`) });
    expect(fetcher.mock.calls.some(([input]) => input.endsWith("disconnect"))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally { remove(); }
});
it("aborts a pending connect immediately when the user disconnects", async () => {
  vi.useFakeTimers(); registerLiveSessionCommands();
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((_input: string, options: RequestInit) => { signal = options.signal; return stuckResponse(options); }));
  const pending = Promise.resolve(connectLiveSession(true));
  const rejected = expect(pending).resolves.toBeUndefined();
  expect(signal?.aborted).toBe(false);
  await disconnectLiveSession();
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(useLiveSessionState.getState().status).toBe("disconnected");
  expect(vi.getTimerCount()).toBe(0);
});

it("does not count a late result receipt against a new connection", async () => {
  registerLiveSessionCommands(); configureCommandRuntime(() => 1);
  const remove = bindCommand({ id: "test.liveLateResult", label: "Late result", kind: "domain", input: {} }, { id: "domain", label: () => "Late result", available: () => undefined, invoke: () => ({ inspected: true }) });
  let delivered = false, finishResult: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
    if (input.endsWith("connect")) return Promise.resolve(new Response(JSON.stringify({ connectionId: "c".repeat(32), agentToken: "a".repeat(64), browserToken: "b".repeat(64) })));
    if (input.endsWith("disconnect")) return Promise.resolve(new Response('{}'));
    if (input.endsWith("result")) return new Promise<Response>(resolve => { finishResult = resolve; });
    if (!delivered) { delivered = true; return Promise.resolve(new Response(JSON.stringify({ id: "d".repeat(32), request: { command: "test.liveLateResult", session: 1 } }))); }
    return stuckResponse(options);
  }));
  try {
    await connectLiveSession(true);
    await vi.waitFor(() => expect(finishResult).toBeDefined());
    await disconnectLiveSession();
    await connectLiveSession(true);
    finishResult!(new Response('{}'));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(useLiveSessionState.getState()).toMatchObject({ status: "connected", completed: 0, error: undefined });
  } finally { remove(); }
});
