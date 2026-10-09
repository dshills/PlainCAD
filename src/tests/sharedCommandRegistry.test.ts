import { afterEach, describe, expect, it, vi } from "vitest";
import { bindCommand, configureCommandRuntime, describeCommands, executeCommand, invokeCommand, dispatchCommandInteraction } from "../commands/registry";
import { commandRequest } from "../commands/protocol";
import { addCommandListener, removeCommandListener } from "../commands/nativeEvents";
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).forEach(release => release()); configureCommandRuntime(() => 0, invoke => invoke()); });
function bind(id: string, target = "domain", invoke = vi.fn(), available = () => undefined as string | undefined) {
  releases.push(bindCommand({ id, label: id, kind: "domain", input: { type: "object" } }, { id: target, label: () => id, available, invoke }));
  return invoke;
}
describe("shared command transport", () => {
  it("records missed dispatch and propagates handler failures swallowed by browser dispatch", async () => {
    const handler = bind("test.delivery", "domain", vi.fn(() => { throw new Error("Invalid native pick"); }));
    expect(await dispatchCommandInteraction("test.delivery", "domain", () => {})).toEqual({ dispatched: true, invoked: false });
    await expect(dispatchCommandInteraction("test.delivery", "domain", () => { try { invokeCommand("test.delivery", "domain"); } catch { /* Browser dispatch catches this error. */ } })).rejects.toThrow("Invalid native pick"); expect(handler).toHaveBeenCalledTimes(1);
  });
  it("runs the same binding for local UI and JSON callers, returning JSON data", async () => {
    configureCommandRuntime(() => 7);
    const handler = bind("test.parity", "domain", vi.fn(args => ({ value: args[0], absent: undefined })));
    invokeCommand("test.parity", "domain", [{ amount: 8 }]);
    expect(await executeCommand({ command: "test.parity", session: 7, arguments: { amount: 8 } })).toEqual({ ok: true, command: "test.parity", value: { value: { amount: 8 } } });
    expect(handler.mock.calls.map(call => call[0])).toEqual([[{ amount: 8 }], [{ amount: 8 }]]);
  });
  it("rejects stale projects, ambiguous/unmounted targets and unavailable actions before invoking", async () => {
    configureCommandRuntime(() => 3);
    const handler = bind("test.guards", "first");
    bind("test.guards", "second", handler);
    expect(await executeCommand({ command: "test.guards" })).toMatchObject({ error: { code: "session_required" } });
    expect(await executeCommand({ command: "test.guards", session: 2 })).toMatchObject({ error: { code: "stale_session" } });
    expect(await executeCommand({ command: "test.guards", session: 3 })).toMatchObject({ error: { code: "ambiguous_target" } });
    bind("test.disabled", "domain", handler, () => "Native preview pending");
    expect(await executeCommand({ command: "test.disabled", session: 3 })).toMatchObject({ error: { code: "unavailable", message: "Native preview pending" } });
    const release = releases.pop()!;
    release();
    expect(await executeCommand({ command: "test.disabled", session: 3 })).toMatchObject({ error: { code: "unavailable" } });
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects unsafe, oversized and unknown JSON fields", () => {
    expect(() => commandRequest({ command: "test", unexpected: true })).toThrow();
    expect(() => commandRequest(JSON.parse('{"command":"test","arguments":{"__proto__":{}}}'))).toThrow();
    expect(() => commandRequest({ command: "test", session: -1 })).toThrow();
    expect(() => commandRequest({ command: "test", arguments: "x".repeat(6 * 1024 * 1024) })).toThrow();
    expect(() => commandRequest({ command: "test", arguments: Array.from({ length: 70 }).reduce(value => ({ next: value }), {} as object) })).toThrow();
  });
  it("preserves native listener identity, once and abort cleanup", () => {
    const node = document.createElement("button"), handler = vi.fn(), controller = new AbortController();
    document.body.append(node);
    const site = { id: "test.listener", label: "Native click", source: "test" };
    addCommandListener(node, "click", handler, { once: true }, site);
    addCommandListener(node, "click", handler, false, site);
    node.click();
    node.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(describeCommands().find(command => command.id === "test.listener.click")?.bindings).toHaveLength(0);
    addCommandListener(node, "click", handler, { capture: true, signal: controller.signal }, site);
    removeCommandListener(node, "click", handler, false);
    node.click();
    expect(handler).toHaveBeenCalledTimes(2);
    controller.abort();
    node.click();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(describeCommands().find(command => command.id === "test.listener.click")?.bindings).toHaveLength(0);
    node.remove();
  });
  it("accepts native null listener options and routes keyboard input to the active control", async () => {
    const node = document.createElement("input"), handler = vi.fn(), local = vi.fn();
    document.body.append(node);
    node.focus();
    node.addEventListener("keydown", local);
    addCommandListener(window, "keydown", handler, null, { id: "test.keyboard", label: "Shortcut", source: "test" });
    try {
      expect(await executeCommand({ command: "test.keyboard.keydown", session: 0, arguments: { key: "Enter" } })).toMatchObject({ ok: true });
      expect(local).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].target).toBe(node);
    }
    finally {
      removeCommandListener(window, "keydown", handler, null);
      node.remove();
    }
  });
  it("distinguishes an executed action with an unserializable result from invocation failure", async () => {
    const result: {
      self?: object;
    } = {};
    result.self = result;
    const handler = bind("test.executed", "domain", vi.fn(() => result));
    expect(await executeCommand({ command: "test.executed", session: 0 })).toMatchObject({ error: { code: "result_unavailable", message: expect.stringContaining("Command executed") } });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
