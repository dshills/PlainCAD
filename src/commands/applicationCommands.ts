import { bindCommand, configureCommandRuntime, describeCommands, executeCommand, type CommandDescriptor, type JsonValue } from "./registry";
import { objectArguments, stringArgument } from "./protocol";
import { flushSync } from "react-dom";
import { useCadStore } from "../state/useCadStore";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject, setDownloadObserver } from "../persistence/exportProject";
import { downloadRequests, recordDownload } from "./artifacts";
import type { SelectionRef } from "../cad/document/schema";
export interface CommandApi {
  version: 1;
  execute(request: unknown): Promise<import("./registry").CommandResponse>;
  list(): Promise<import("./registry").CommandResponse>;
}
let canEdit: () => boolean;
function snapshot() {
  const state = useCadStore.getState(), current = state.rebuild.status === "succeeded" && state.rebuild.result?.success && state.rebuild.result.documentId === state.history.present.id;
  return { session: state.documentSession, document: JSON.parse(serializeProject(state.history.present)), activeComponentId: state.activeComponentId, selection: state.selection,
    rebuild: { status: state.rebuild.status, native: Boolean(current && state.rebuild.result?.meshes.length && state.rebuild.result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid)), errors: state.rebuild.result?.errors ?? [], bodies: current ? state.rebuild.result!.meshes.map(mesh => ({ id: mesh.bodyId, bounds: mesh.bounds, assertions: mesh.geometryAssertions })) : [] },
    history: { undo: state.history.past.length, redo: state.history.future.length }, fileError: state.fileError ?? null,
    alerts: typeof document === "undefined" ? [] : [...document.querySelectorAll('[role="alert"]')].filter(element => !element.closest("[hidden], [inert], [aria-hidden='true']")).map(element => element.textContent?.trim()).filter(Boolean) } as unknown as JsonValue;
}
function register(id: string, label: string, input: JsonValue, handler: (value: unknown) => unknown, editable = false, guard = () => canEdit()) {
  const descriptor: CommandDescriptor = { id, label, input, kind: id.startsWith("runtime.") || id === "commands.list" ? "system" : "domain" };
  bindCommand(descriptor, { id: "domain", label: () => label, available: () => editable && !guard() ? "Finish the current task before editing the project." : undefined, invoke: args => handler(args[0]) });
}
const schema = (properties: {
  [key: string]: JsonValue;
}, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
export function registerApplicationCommands(editable: () => boolean, parameterEditable = editable) {
  canEdit = editable;
  setDownloadObserver(recordDownload);
  configureCommandRuntime(() => useCadStore.getState().documentSession, invoke => flushSync(invoke));
  register("commands.list", "Discover commands", schema({}), value => { objectArguments(value, []); return { session: useCadStore.getState().documentSession, commands: describeCommands() } as unknown as JsonValue; });
  register("runtime.snapshot", "Inspect project and native geometry", schema({}), value => { objectArguments(value, []); return snapshot(); });
  register("document.serialize", "Read editable project JSON", schema({}), value => { objectArguments(value, []); return { text: serializeProject(useCadStore.getState().history.present) }; });
  register("runtime.artifacts", "Inspect initiated downloads", schema({}), value => { objectArguments(value, []); return downloadRequests() as unknown as JsonValue; });
  register("runtime.awaitArtifact", "Wait for an initiated download", schema({ after: { type: "integer", minimum: 0 }, timeoutMs: { type: "integer", minimum: 1, maximum: 60000 } }, ["after"]), async (value) => {
    const args = objectArguments(value, ["after", "timeoutMs"]), timeout = args.timeoutMs ?? 60000;
    if (!Number.isSafeInteger(args.after) || Number(args.after) < 0 || !Number.isSafeInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 60000)
      throw new Error("Provide a nonnegative artifact sequence and timeout from 1 to 60000 ms.");
    const session = useCadStore.getState().documentSession, expires = Date.now() + Number(timeout);
    while (Date.now() <= expires) {
      if (useCadStore.getState().documentSession !== session)
        throw new Error("Artifact wait became stale. Refresh discovery.");
      const request = downloadRequests().recent.find(request => request.sequence > Number(args.after));
      if (request)
        return request as unknown as JsonValue;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Timed out waiting for a download. Inspect the current task diagnostics.");
  });
  register("document.import", "Open editable project JSON", schema({ text: { type: "string", maxLength: 5 * 1024 * 1024 } }, ["text"]), value => {
    const args = objectArguments(value, ["text"]), document = importProjectText(stringArgument(args.text, "Project JSON", 5 * 1024 * 1024));
    const before = useCadStore.getState().documentSession;
    useCadStore.getState().setDocument(document);
    if (useCadStore.getState().documentSession === before || useCadStore.getState().fileError)
      throw new Error(useCadStore.getState().fileError ?? "Project could not be opened.");
    return { session: useCadStore.getState().documentSession, documentId: document.id };
  }, true);
  register("parameter.update", "Edit a parameter", schema({ parameterId: { type: "string" }, patch: schema({ name: { type: "string" }, expression: { type: "string" }, group: { type: "string" } }) }, ["parameterId", "patch"]), value => {
    const args = objectArguments(value, ["parameterId", "patch"]), id = stringArgument(args.parameterId, "Parameter ID", 160), patch = objectArguments(args.patch, ["name", "expression", "group"]), state = useCadStore.getState();
    if (!Object.values(state.history.present.parameters).some(parameter => parameter.id === id))
      throw new Error("Parameter no longer exists. Refresh the project snapshot.");
    const fields: Record<string, string> = {};
    for (const [field, fieldValue] of Object.entries(patch))
      fields[field] = stringArgument(fieldValue, field, field === "expression" ? 5000 : 120);
    if (!Object.keys(fields).length)
      throw new Error("Parameter patch is empty.");
    state.setFileError(undefined);
    state.updateParameter(id, fields);
    if (useCadStore.getState().fileError)
      throw new Error(useCadStore.getState().fileError);
  }, true, parameterEditable);
  register("selection.set", "Select a project item", schema({ kind: { enum: ["parameter", "sketch", "sketchEntity", "feature", "body"] }, id: { type: "string" } }, ["kind", "id"]), value => {
    const args = objectArguments(value, ["kind", "id"]), kind = stringArgument(args.kind, "Selection kind", 30), id = stringArgument(args.id, "Selection ID", 160), state = useCadStore.getState(), document = state.history.present;
    const valid = kind === "parameter" ? Object.values(document.parameters).some(parameter => parameter.id === id) : kind === "sketch" ? Object.hasOwn(document.sketches, id) : kind === "sketchEntity" ? Object.values(document.sketches).some(sketch => Object.hasOwn(sketch.entities, id)) : kind === "feature" ? document.features.some(feature => feature.id === id) : kind === "body" ? state.rebuild.result?.bodies.some(body => body.id === id) : false;
    if (!valid)
      throw new Error("Selection is absent from the current project.");
    state.select({ kind, id, documentId: document.id } as SelectionRef);
  }, true);
  register("runtime.awaitNative", "Wait for current native geometry", schema({ timeoutMs: { type: "integer", minimum: 1, maximum: 60000 } }), async (value) => {
    const args = objectArguments(value, ["timeoutMs"]), timeout = args.timeoutMs ?? 60000;
    if (!Number.isSafeInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 60000)
      throw new Error("timeoutMs must be an integer from 1 to 60000.");
    const source = useCadStore.getState(), expires = Date.now() + Number(timeout);
    while (Date.now() <= expires) {
      const state = useCadStore.getState();
      if (state.documentSession !== source.documentSession || state.history.present !== source.history.present)
        throw new Error("Native wait became stale. Refresh the project snapshot.");
      if (state.rebuild.status === "failed" && state.rebuild.result?.documentId === state.history.present.id)
        throw new Error(state.rebuild.result.errors.map(error => error.message).join(" ") || "Native rebuild failed.");
      if (state.rebuild.status === "succeeded" && state.rebuild.kernelReady && state.rebuild.result?.success && state.rebuild.result.documentId === state.history.present.id) {
        if (!state.rebuild.result.meshes.length)
          throw new Error("The project has no modeled bodies. Create or import a part first.");
        if (state.rebuild.result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid))
          return snapshot();
        throw new Error("Current model uses fallback geometry rather than native OpenCascade solids.");
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Timed out waiting for native geometry.");
  });
  register("runtime.waitForCommand", "Wait for command availability", { ...schema({ command: { type: "string", minLength: 1, maxLength: 200 }, label: { type: "string", minLength: 1, maxLength: 200 }, property: { type: "string", maxLength: 200 }, timeoutMs: { type: "integer", minimum: 1, maximum: 60000 } }), anyOf: [{ required: ["command"] }, { required: ["label"] }] }, async (value) => {
    const args = objectArguments(value, ["command", "label", "property", "timeoutMs"]), timeout = args.timeoutMs ?? 60000;
    if (!Number.isSafeInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 60000 || (!args.command && !args.label))
      throw new Error("Specify command or label, and a timeout from 1 to 60000 ms.");
    for (const key of ["command", "label", "property"])
      if (args[key] !== undefined)
        stringArgument(args[key], key, 200);
    const session = useCadStore.getState().documentSession, expires = Date.now() + Number(timeout);
    while (Date.now() <= expires) {
      if (useCadStore.getState().documentSession !== session)
        throw new Error("Command wait became stale. Refresh discovery.");
      const matches = describeCommands().flatMap(command => command.bindings.filter(binding => binding.available && (!args.command || command.id === args.command) && (!args.label || binding.label === args.label) && (!args.property || (binding.state as Record<string, JsonValue> | undefined)?.property === args.property)).map(binding => ({ command: command.id, ...binding })));
      if (matches.length)
        return { session, matches } as unknown as JsonValue;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for the requested command.");
  });
}
export const commandApi: CommandApi = Object.freeze({ version: 1 as const, execute: executeCommand, list() { return executeCommand({ command: "commands.list" }); } });
export function installCommandApi() { Object.defineProperty(window, "plaincadCommands", { configurable: true, value: commandApi }); }
declare global {
  interface Window {
    plaincadCommands: CommandApi;
  }
}
