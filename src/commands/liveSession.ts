import { create } from "zustand";
import { bindCommand, executeCommand, invokeCommand } from "./registry";
import { objectArguments } from "./protocol";

interface LiveState { status: "disconnected" | "connecting" | "connected"; connectionId?: string; error?: string; completed: number; }
export const useLiveSessionState = create<LiveState>(() => ({ status: "disconnected", completed: 0 }));
interface Capability { connectionId: string; browserToken: string; agentToken: string; }
let capability: Capability | undefined;
let epoch = 0;
let polling: AbortController | undefined;
let connecting: AbortController | undefined;
async function request(route: string, value: unknown, token?: string, signal?: AbortSignal, keepalive = false) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`Live ${route} request timed out. Reconnect before sending another command.`)), route === "poll" ? 30000 : 10000);
  try {
    const response = await fetch(`/api/live/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value), signal: controller.signal, keepalive });
    const result = await response.json().catch(() => ({ error: "Live access needs the local Vite server; static hosting does not provide it." }));
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response.ok) throw new Error(result.error ?? "Live connection failed.");
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
  }
}
function clear() {
  epoch++; polling?.abort(); polling = undefined; connecting?.abort(); connecting = undefined; capability = undefined;
  useLiveSessionState.setState({ status: "disconnected", connectionId: undefined });
}
async function poll(current: Capability, generation: number) {
  try {
    while (generation === epoch && capability === current) {
      polling = new AbortController();
      const message = await request("poll", {}, current.browserToken, polling.signal);
      if (generation !== epoch || capability !== current) return;
      if (!message || typeof message !== "object" || (message.id === undefined && message.idle !== true)) throw new Error("Invalid live poll response.");
      if (message.id !== undefined) {
        if (typeof message.id !== "string" || !/^[a-f0-9]{32}$/.test(message.id) || !message.request || typeof message.request !== "object") throw new Error("Invalid live command delivery.");
        // Never dispatch a queued command after disconnect/reconnect.
        const result = await executeCommand(message.request);
        if (generation !== epoch || capability !== current) return;
        await request("result", { id: message.id, result }, current.browserToken, polling.signal);
        if (generation !== epoch || capability !== current) return;
        useLiveSessionState.setState(state => ({ completed: state.completed + 1 }));
      }
    }
  } catch (error) {
    if (generation !== epoch) return;
    clear();
    const clearedEpoch = epoch;
    await request("disconnect", {}, current.browserToken, AbortSignal.timeout(3000)).catch(() => {});
    if (clearedEpoch !== epoch) return;
    useLiveSessionState.setState({ error: error instanceof Error ? error.message : "Live connection lost." });
  }
}
async function connect(trusted: unknown) {
  if (trusted !== true) throw new Error("Connect live access with a direct click in the application.");
  if (useLiveSessionState.getState().status !== "disconnected") throw new Error("Live access is already connecting or connected.");
  const generation = ++epoch;
  useLiveSessionState.setState({ status: "connecting", error: undefined, completed: 0 });
  const controller = new AbortController(); connecting = controller;
  try {
    const value = await request("connect", {}, undefined, controller.signal);
    if (!value || typeof value !== "object" || typeof value.connectionId !== "string" || !/^[a-f0-9]{32}$/.test(value.connectionId) || typeof value.browserToken !== "string" || !/^[a-f0-9]{64}$/.test(value.browserToken) || typeof value.agentToken !== "string" || !/^[a-f0-9]{64}$/.test(value.agentToken)) throw new Error("Invalid live capability response. Use the local application server.");
    const current = value as Capability;
    if (generation !== epoch) { await request("disconnect", {}, current.browserToken, AbortSignal.timeout(3000)); return; }
    capability = current;
    useLiveSessionState.setState({ status: "connected", connectionId: current.connectionId });
    void poll(current, generation);
  } catch (error) {
    if (generation !== epoch) return;
    clear(); useLiveSessionState.setState({ error: error instanceof Error ? error.message : "Live connection failed." });
    throw error;
  } finally { if (connecting === controller) connecting = undefined; }
}
export async function disconnectLiveSession(keepalive = false) {
  const current = capability; clear();
  if (current) await request("disconnect", {}, current.browserToken, AbortSignal.timeout(3000), keepalive).catch(() => { /* Capability expires when the browser stops polling. */ });
}
export async function copyLiveCapability(trusted: boolean) {
  if (!trusted || !capability) throw new Error("Copy the live capability with a direct click while connected.");
  await navigator.clipboard.writeText(capability.agentToken);
}
let lifecycleInstalled = false;
export function registerLiveSessionCommands() {
  if (!lifecycleInstalled && typeof window !== "undefined") {
    lifecycleInstalled = true;
    window.addEventListener("pagehide", () => { void disconnectLiveSession(true); });
  }
  bindCommand({ id: "live.connect", label: "Connect live agent", kind: "domain", input: { type: "object", properties: {}, additionalProperties: false } }, {
    id: "domain", label: () => "Connect live agent", available: () => useLiveSessionState.getState().status === "disconnected" ? undefined : "Already connected or connecting.",
    invoke: (args, remote) => { if (remote) throw new Error("Live access requires a direct click in the application's Connect button."); return connect(args[0]); },
  });
  bindCommand({ id: "live.disconnect", label: "Disconnect live agent", kind: "domain", input: { type: "object", properties: {}, additionalProperties: false } }, {
    id: "domain", label: () => "Disconnect live agent", available: () => useLiveSessionState.getState().status === "disconnected" ? "Already disconnected." : undefined,
    invoke: (args, remote) => { if (remote) objectArguments(args[0], []); return disconnectLiveSession(); },
  });
  bindCommand({ id: "live.status", label: "Inspect live connection", kind: "system", input: { type: "object", properties: {}, additionalProperties: false } }, {
    id: "domain", label: () => "Inspect live connection", available: () => undefined,
    invoke: args => { objectArguments(args[0], []); return useLiveSessionState.getState(); },
  });
}
export function connectLiveSession(trusted: boolean) { return invokeCommand("live.connect", "domain", [trusted]); }
