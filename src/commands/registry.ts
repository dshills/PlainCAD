import { commandRequest } from "./protocol";
/** One runtime registry for domain commands and mounted interaction adapters. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};
export interface CommandDescriptor {
  id: string;
  label: string;
  description?: string;
  source?: string;
  kind: "domain" | "interaction" | "system";
  input: JsonValue;
}
export interface CommandBinding {
  id: string;
  label(): string;
  available(): string | undefined;
  invoke(args: unknown[], remote: boolean): unknown;
  describe?(): JsonValue;
}
export interface RegisteredCommand extends CommandDescriptor {
  bindings: Map<string, CommandBinding>;
}
export interface CommandRequest {
  command: string;
  target?: string;
  arguments?: JsonValue;
  session?: number;
}
export type CommandResponse = {
  ok: true;
  command: string;
  value: JsonValue;
} | {
  ok: false;
  command: string;
  error: {
    code: string;
    message: string;
  };
};
const registry = new Map<string, RegisteredCommand>();
export interface CommandExecution { request: CommandRequest; result: JsonValue }
const executionObservers = new Set<(execution: CommandExecution) => void>();
export function subscribeCommandExecutions(observer: (execution: CommandExecution) => void) {
  executionObservers.add(observer);
  return () => { executionObservers.delete(observer); };
}
export function reportAppliedCommand(request: CommandRequest, result: unknown) {
  if (!executionObservers.size || registry.get(request.command)?.kind !== "domain") return;
  try {
    let serialized: string;
    try { serialized = JSON.stringify({ request, result: result ?? null }); }
    catch { serialized = JSON.stringify({ request, result: null }); }
    if (new TextEncoder().encode(serialized).byteLength > 16 * 1024 * 1024)
      serialized = JSON.stringify({ request, result: null });
    if (new TextEncoder().encode(serialized).byteLength > 16 * 1024 * 1024) return;
    for (const observer of executionObservers) {
      try { observer(JSON.parse(serialized) as CommandExecution); } catch { /* Observers cannot undo an accepted command. */ }
    }
  } catch { /* Runtime handles and non-JSON local arguments are not recorded. */ }
}
interface Delivery { command: string; target: string; invoked: boolean; error?: unknown; pending: Promise<unknown>[] }
const deliveries = new Set<Delivery>();
let session = () => 0;
let transaction: (invoke: () => unknown) => unknown = invoke => invoke();
export function configureCommandRuntime(currentSession: () => number, runTransaction?: typeof transaction) { session = currentSession; if (runTransaction)
  transaction = runTransaction; }
export function defineCommand(descriptor: CommandDescriptor) {
  const existing = registry.get(descriptor.id);
  if (existing)
    return existing;
  const command = { ...descriptor, bindings: new Map<string, CommandBinding>() };
  registry.set(descriptor.id, command);
  return command;
}
export function bindCommand(descriptor: CommandDescriptor, binding: CommandBinding) {
  const command = defineCommand(descriptor);
  command.bindings.set(binding.id, binding);
  return () => { if (command.bindings.get(binding.id) === binding)
    command.bindings.delete(binding.id); };
}
export function invokeCommand(command: string, target: string, args: unknown[] = []) {
  const binding = registry.get(command)?.bindings.get(target);
  if (!binding)
    throw new Error(`Command target is no longer mounted: ${command}. Refresh command discovery.`);
  const request: CommandRequest = { command, target, arguments: args[0] as JsonValue, session: session() };
  const invoke = () => {
    const result = binding.invoke(args, false);
    if (result instanceof Promise) return result.then(value => { reportAppliedCommand(request, value); return value; });
    reportAppliedCommand(request, result);
    return result;
  };
  if (!deliveries.size) return invoke();
  const observers = [...deliveries].filter(delivery => delivery.command === command && delivery.target === target);
  observers.forEach(delivery => { delivery.invoked = true; });
  try {
    const result = invoke();
    if (result instanceof Promise) observers.forEach(delivery => delivery.pending.push(result));
    return result;
  } catch (error) { observers.forEach(delivery => { delivery.error = error; }); throw error; }
}
/** Browser dispatch swallows listener exceptions; retain delivery evidence for
 * the JSON caller without bypassing capture, bubbling or default actions. */
export async function dispatchCommandInteraction(command: string, target: string, dispatch: () => unknown) {
  const delivery: Delivery = { command, target, invoked: false, pending: [] };
  deliveries.add(delivery);
  try { await dispatch(); }
  finally { deliveries.delete(delivery); }
  if (delivery.error !== undefined) throw delivery.error;
  await Promise.all(delivery.pending);
  return { dispatched: true, invoked: delivery.invoked };
}
export function isRegisteredCommandAvailable(command: string, target: string) {
  const binding = registry.get(command)?.bindings.get(target);
  return Boolean(binding && binding.available() === undefined);
}
/** Commit-phase focus/blur uses a scoped binding; abandoned renders never register. */
export function invokeScopedCommand(descriptor: CommandDescriptor, binding: CommandBinding, args: unknown[]) {
  const command = defineCommand(descriptor), previous = command.bindings.get(binding.id);
  command.bindings.set(binding.id, binding);
  try {
    return invokeCommand(descriptor.id, binding.id, args);
  }
  finally {
    if (command.bindings.get(binding.id) === binding) {
      if (previous)
        command.bindings.set(binding.id, previous);
      else
        command.bindings.delete(binding.id);
    }
  }
}
export function describeCommands() {
  return [...registry.values()].map(command => ({ ...command, bindings: [...command.bindings.values()].map(binding => {
      try {
        const reason = binding.available();
        return { target: binding.id, label: binding.label(), available: reason === undefined, ...(reason ? { reason } : {}), ...(binding.describe ? { state: binding.describe() } : {}) };
      }
      catch (error) {
        return { target: binding.id, label: command.label, available: false, reason: `Binding inspection failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }) }));
}
export async function executeCommand(value: unknown): Promise<CommandResponse> {
  let request: CommandRequest;
  try {
    request = commandRequest(value);
  }
  catch (error) {
    return { ok: false, command: "", error: { code: "invalid_request", message: error instanceof Error ? error.message : String(error) } };
  }
  const fail = (code: string, message: string): CommandResponse => ({ ok: false, command: request.command, error: { code, message } });
  try {
    const command = registry.get(request.command);
    if (!command)
      return fail("unknown_command", `Unknown command: ${request.command}. Discover current commands first.`);
    if (!["commands.list", "runtime.snapshot"].includes(request.command) && request.session === undefined)
      return fail("session_required", "Include the current project session from discovery or snapshot.");
    if (request.session !== undefined && request.session !== session())
      return fail("stale_session", "Project replaced. Refresh command discovery before acting.");
    const bindings = [...command.bindings.values()];
    const binding = request.target ? command.bindings.get(request.target) : bindings.length === 1 ? bindings[0] : undefined;
    if (!binding && request.target) return fail("unknown_target", "This target is no longer mounted. Refresh command discovery.");
    if (!binding)
      return fail(bindings.length ? "ambiguous_target" : "unavailable", bindings.length ? "Choose a current target from command discovery." : "This interaction is not mounted. Open its tool or dialog first.");
    const reason = binding.available();
    if (reason)
      return fail("unavailable", reason);
    const result = await transaction(() => binding.invoke([request.arguments ?? {}], true));
    // The transport returns data only; runtime handles/events never cross it.
    try {
      const json = JSON.stringify(result === undefined ? null : result);
      if (new TextEncoder().encode(json ?? "null").byteLength > 16 * 1024 * 1024)
        throw new Error("Result exceeds 16 MiB.");
      const value = JSON.parse(json ?? "null") as JsonValue;
      reportAppliedCommand(request, value);
      return { ok: true, command: request.command, value };
    }
    catch {
      reportAppliedCommand(request, null);
      return fail("result_unavailable", "Command executed but its result could not be returned as bounded JSON. Inspect runtime.snapshot; do not retry the mutation.");
    }
  }
  catch (error) {
    return fail("command_failed", error instanceof Error ? error.message : String(error));
  }
}
