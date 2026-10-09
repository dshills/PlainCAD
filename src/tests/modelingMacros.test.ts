import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureCommandRuntime, executeCommand, type CommandRequest, type JsonValue } from "../commands/registry";
import { importMacro, instantiateMacro, parameterizeMacro, recordMacroStep, validateMacro, type ModelingMacro } from "../commands/macros";
import { MACRO_STORAGE_KEY, registerMacroCommands, useMacroStore } from "../commands/macroStore";

const storage = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
const storageApi = { clear: () => storage.clear(), getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
const commands = ["cad.sketch.create", "cad.sketch.rectangle", "cad.parameter.update", "cad.component.place"];
const macro: ModelingMacro = { version: 1, id: "test-workflow", name: "Plate workflow", variables: [], steps: [
  { command: "cad.sketch.create", arguments: { name: "Plate", plane: "XY" } },
  { command: "cad.sketch.rectangle", arguments: { sketchId: { $result: { step: 0, path: ["sketchId"] } }, width: "40", height: "20" } },
] };
let release = () => {};
let listener: (event: { request: CommandRequest; result: JsonValue }) => void;
let session = 5;
const previewPlan = vi.fn(async () => ({ planId: "plan", status: "ready" }));
beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: storageApi });
  window.localStorage.clear(); session = 5; previewPlan.mockClear();
  configureCommandRuntime(() => session, invoke => invoke());
  useMacroStore.setState({ saved: [], draft: undefined, recording: undefined, message: undefined, storageError: undefined, storageBlocked: false });
  release = registerMacroCommands({ canRecord: () => true, currentSession: () => session, commands: () => commands, previewPlan,
    subscribeExecutions: fn => { listener = fn; return () => {}; } });
});
afterEach(() => { if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage); release(); configureCommandRuntime(() => 0, invoke => invoke()); });
const run = (command: string, args: JsonValue = {}) => executeCommand({ command, arguments: args, session });
describe("modeling workflows", () => {
  it("parameterizes one explicit argument with typed defaults and leaves source immutable", () => {
    const parameterized = parameterizeMacro(macro, 1, ["width"], { name: "width", type: "string", defaultValue: "40" }, commands);
    expect(macro.steps[1].arguments).toMatchObject({ width: "40" });
    expect(instantiateMacro(parameterized, { width: "75" }, commands)[1].arguments).toMatchObject({ width: "75", height: "20", sketchId: { $result: { step: 0 } } });
    expect(instantiateMacro(parameterized, {}, commands)[1].arguments).toMatchObject({ width: "40" });
    const preserveDefault = parameterizeMacro(macro, 1, ["width"], { name: "width", type: "string", defaultValue: "999" }, commands);
    expect(preserveDefault.variables[0].defaultValue).toBe("40");
    expect(() => instantiateMacro(parameterized, { width: 75 }, commands)).toThrow("string");
    expect(() => instantiateMacro(parameterized, { surprise: 8 }, commands)).toThrow("Unknown");
    const placement = { ...macro, steps: [{ command: "cad.component.place", arguments: { componentId: "component", translation: [1, 0, 0], rotation: [0, 0, 0] } }] };
    const adjusted = parameterizeMacro(placement, 0, ["translation", "0"], { name: "shift", type: "number", defaultValue: 1 }, commands);
    expect(instantiateMacro(adjusted, { shift: 5 }, commands)[0].arguments).toMatchObject({ translation: [5, 0, 0] });
    expect(() => instantiateMacro(adjusted, { shift: 1e10 }, commands)).toThrow("bounds");
    expect(() => parameterizeMacro(macro, 1, ["absent"], { name: "width", type: "string", defaultValue: "40" }, commands)).toThrow("matching");
  });
  it("rejects unsafe/oversized imports, UI commands and forward result references before persistence", async () => {
    expect(() => importMacro('{"__proto__":{}}', commands)).toThrow("unsafe");
    expect(() => importMacro("x".repeat(256 * 1024 + 1), commands)).toThrow("large");
    expect(() => validateMacro({ ...macro, steps: [{ command: "ui.click", arguments: {} }] }, commands)).toThrow("unsupported");
    expect(() => validateMacro({ ...macro, steps: [{ command: commands[0], arguments: { name: "Sketch", plane: "XY", apiKey: "forbidden" } }] }, commands)).toThrow("unsupported");
    expect(() => validateMacro({ ...macro, steps: [{ command: commands[0], arguments: { $result: { step: 0, path: ["id"] } } }] }, commands)).toThrow("earlier");
    expect(() => validateMacro({ ...macro, steps: [{ command: commands[0], arguments: { $variable: "undeclared" } }] }, commands)).toThrow("undefined");
    expect(await run("macro.import", { text: '{"__proto__":{}}' })).toMatchObject({ ok: false });
    expect(useMacroStore.getState().saved).toEqual([]); expect(window.localStorage.getItem(MACRO_STORAGE_KEY)).toBeNull();
  });
  it("records only successful semantic events and rebinds earlier created IDs", async () => {
    expect(await run("macro.start")).toMatchObject({ ok: true });
    listener({ request: { command: "ui.generated", arguments: { clientX: 100 } }, result: null });
    listener({ request: { command: commands[0], arguments: { name: "Plate", plane: "XY" } }, result: { sketchId: "sketch_created" } });
    listener({ request: { command: commands[1], arguments: { sketchId: "sketch_created", width: "40", height: "20" } }, result: { entityId: "rect_created" } });
    expect(await run("macro.stop")).toMatchObject({ ok: true, value: { steps: 2 } });
    expect(useMacroStore.getState().draft?.steps[1].arguments).toMatchObject({ sketchId: { $result: { step: 0, path: ["sketchId"] } } });
    expect(await run("macro.save", { name: "My plate" })).toMatchObject({ ok: true });
    expect(JSON.parse(window.localStorage.getItem(MACRO_STORAGE_KEY)!).macros).toHaveLength(1);
    expect(useMacroStore.getState().saved[0].name).toBe("My plate");
  });
  it("separates recording availability from native plan preview availability", async () => {
    release();
    let canRecord = true, canPreview = false;
    release = registerMacroCommands({ canRecord: () => canRecord, canPreview: () => canPreview, currentSession: () => session, commands: () => commands, previewPlan, subscribeExecutions: fn => { listener = fn; return () => {}; } });
    expect(await run("macro.start")).toMatchObject({ ok: true });
    await run("macro.stop");
    await run("macro.save", { macro: macro as unknown as JsonValue });
    expect(await run("macro.preview", { macroId: macro.id })).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(previewPlan).not.toHaveBeenCalled();
    canRecord = false; canPreview = true;
    expect(await run("macro.start")).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await run("macro.preview", { macroId: macro.id })).toMatchObject({ ok: true, value: { status: "ready" } });
    expect(previewPlan).toHaveBeenCalledTimes(1);
  });
  it("immediately discards an active recording or unsaved draft on project session changes", async () => {
    release();
    const sessionListeners = new Set<() => void>();
    release = registerMacroCommands({ canRecord: () => true, currentSession: () => session, commands: () => commands, previewPlan, subscribeExecutions: fn => { listener = fn; return () => {}; }, subscribeSession: fn => { sessionListeners.add(fn); return () => { sessionListeners.delete(fn); }; } });
    await run("macro.save", { macro: macro as unknown as JsonValue });
    await run("macro.start");
    listener({ request: { command: commands[0], arguments: { name: "Plate", plane: "XY" } }, result: { id: "sketch" } });
    sessionListeners.forEach(notify => notify());
    expect(useMacroStore.getState().recording?.steps).toHaveLength(1);
    session++; sessionListeners.forEach(notify => notify());
    expect(useMacroStore.getState().recording).toBeUndefined();
    expect(useMacroStore.getState().draft).toBeUndefined();
    expect(useMacroStore.getState().message).toContain("Project changed");
    expect(useMacroStore.getState().saved).toHaveLength(1);
    await run("macro.start");
    listener({ request: { command: commands[0], arguments: { name: "New plate", plane: "XY" } }, result: { id: "new_sketch" } });
    await run("macro.stop");
    expect(useMacroStore.getState().draft?.steps).toHaveLength(1);
    session++; sessionListeners.forEach(notify => notify());
    expect(useMacroStore.getState().draft).toBeUndefined();
    expect(await run("macro.save")).toMatchObject({ ok: false });
    expect(useMacroStore.getState().saved).toHaveLength(1);
    release(); expect(sessionListeners.size).toBe(0);
  });
  it("requires explicit overwrite for supplied workflow JSON", async () => {
    await run("macro.save", { macro: macro as unknown as JsonValue });
    expect(await run("macro.save", { macro: { ...macro, name: "Replacement" } as unknown as JsonValue })).toMatchObject({ ok: false });
    expect(useMacroStore.getState().saved[0].name).toBe(macro.name);
    expect(await run("macro.save", { macro: { ...macro, name: "Replacement" } as unknown as JsonValue, overwrite: true })).toMatchObject({ ok: true });
    expect(useMacroStore.getState().saved[0].name).toBe("Replacement");
  });
  it("discards stale recordings and never silently mutates while replaying", async () => {
    await run("macro.start"); session++;
    listener({ request: { command: commands[0], arguments: {} }, result: { sketchId: "created" } });
    expect(useMacroStore.getState().recording).toBeUndefined(); expect(useMacroStore.getState().draft).toBeUndefined();
    await run("macro.save", { macro: macro as unknown as JsonValue });
    const parameterized = await run("macro.parameterize", { macroId: macro.id, step: 1, path: ["width"], variable: { name: "width", type: "string", defaultValue: "40" } });
    expect(parameterized.ok).toBe(true);
    expect(await run("macro.preview", { macroId: macro.id, values: { width: "80" } })).toMatchObject({ ok: true, value: { status: "ready" } });
    expect(previewPlan).toHaveBeenCalledWith({ label: macro.name, steps: [{ ...macro.steps[0] }, { command: commands[1], arguments: { sketchId: { $result: { step: 0, path: ["sketchId"] } }, width: "80", height: "20" } }] });
  });
  it("imports with a new ID, exports validated JSON and reloads bounded library data", async () => {
    await run("macro.save", { macro: macro as unknown as JsonValue });
    await run("macro.import", { text: JSON.stringify(macro) });
    const saved = useMacroStore.getState().saved;
    expect(saved).toHaveLength(2); expect(saved[0].id).not.toBe(saved[1].id);
    expect(await run("macro.export", { macroId: saved[1].id })).toMatchObject({ ok: true, value: { text: JSON.stringify(saved[1], null, 2) } });
    release(); useMacroStore.setState({ saved: [] }); release = registerMacroCommands({ canRecord: () => true, currentSession: () => session, commands: () => commands, previewPlan, subscribeExecutions: () => () => {} });
    expect(useMacroStore.getState().saved).toEqual(saved);
    await run("macro.delete", { macroId: saved[0].id }); expect(useMacroStore.getState().saved).toHaveLength(1);
  });
  it("reports browser storage failure while retaining exportable session workflows", async () => {
    const fail = vi.spyOn(storageApi, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    try {
      expect(await run("macro.save", { macro: macro as unknown as JsonValue })).toMatchObject({ ok: true });
      expect(useMacroStore.getState().storageError).toContain("export");
      expect(await run("macro.export", { macroId: macro.id })).toMatchObject({ ok: true });
    } finally { fail.mockRestore(); }
  });
  it("preserves malformed browser library data while keeping new workflows exportable", async () => {
    const raw = '{"version":1,"macros":[{"bad":true}]}';
    window.localStorage.setItem(MACRO_STORAGE_KEY, raw);
    release(); useMacroStore.setState({ saved: [] });
    release = registerMacroCommands({ canRecord: () => true, currentSession: () => session, commands: () => commands, previewPlan, subscribeExecutions: () => () => {} });
    expect(useMacroStore.getState().storageBlocked).toBe(true);
    expect(await run("macro.save", { macro: macro as unknown as JsonValue })).toMatchObject({ ok: true });
    expect(window.localStorage.getItem(MACRO_STORAGE_KEY)).toBe(raw);
    expect(useMacroStore.getState().storageError).toContain("preserved");
    expect(await run("macro.export", { macroId: macro.id })).toMatchObject({ ok: true });
  });
  it("keeps already recorded steps as a draft if a later command cannot be recorded", async () => {
    await run("macro.start");
    listener({ request: { command: commands[0], arguments: { name: "Plate", plane: "XY" } }, result: { id: "sketch" } });
    listener({ request: { command: commands[1], arguments: { apiKey: "unexpected" } }, result: {} });
    expect(useMacroStore.getState().recording).toBeUndefined();
    expect(useMacroStore.getState().draft?.steps).toHaveLength(1);
    expect(useMacroStore.getState().message).toContain("stopped");
  });
  it("rebinds schema-declared references while preserving equal authored text", () => {
    const previous = [{ id: "shared", pointIds: ["point"], bodyId: "body" }];
    expect(recordMacroStep({ command: "cad.feature.update", arguments: { featureId: "shared", name: "shared", distance: "shared", axis: "X", targetBodyIds: ["body"] } }, previous).arguments).toEqual({
      featureId: { $result: { step: 0, path: ["id"] } }, name: "shared", distance: "shared", axis: "X", targetBodyIds: [{ $result: { step: 0, path: ["bodyId"] } }],
    });
    expect(recordMacroStep({ command: "cad.sketch.create", arguments: { name: "shared", componentId: "shared", plane: "XY", as: "shared" } }, previous).arguments).toEqual({
      name: "shared", componentId: { $result: { step: 0, path: ["id"] } }, plane: "XY", as: "shared",
    });
    expect(recordMacroStep({ command: "cad.feature.fillet", arguments: { edges: [{ featureId: "shared", sourceEntityId: "point", role: "endCapPerimeter" }], radius: "shared" } }, previous).arguments).toEqual({
      edges: [{ featureId: { $result: { step: 0, path: ["id"] } }, sourceEntityId: { $result: { step: 0, path: ["pointIds", 0] } }, role: "endCapPerimeter" }], radius: "shared",
    });
  });
  it("records result IDs from nested arrays with valid array paths", () => {
    expect(recordMacroStep({ command: commands[1], arguments: { sketchId: "new" } }, [{ items: [{ sketchId: "new" }] }]).arguments).toEqual({ sketchId: { $result: { step: 0, path: ["items", 0, "sketchId"] } } });
    expect(recordMacroStep({ command: "cad.feature.hole", arguments: { centerPointIds: ["point"] } }, [{ pointIds: ["point"] }]).arguments).toEqual({ centerPointIds: [{ $result: { step: 0, path: ["pointIds", 0] } }] });
  });
});
