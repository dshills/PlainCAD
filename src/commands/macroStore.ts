import { create } from "zustand";
import { createId } from "../cad/document/ids";
import { parseBoundedJson } from "../persistence/importSafety";
import { bindCommand, type CommandRequest, type JsonValue } from "./registry";
import { objectArguments, stringArgument } from "./protocol";
import { downloadArrayBuffer } from "../persistence/exportProject";
import { safeFilename } from "../persistence/filenames";
import { MACRO_LIMITS, importMacro, instantiateMacro, parameterizeMacro, recordMacroStep, validateMacro, type ModelingMacro, type MacroVariable } from "./macros";

export const MACRO_STORAGE_KEY = "plaincad.macros.v1";
interface MacroRecording { session: number; steps: ModelingMacro["steps"]; results: JsonValue[] }
interface MacroState {
  saved: ModelingMacro[];
  recording?: MacroRecording;
  draft?: ModelingMacro;
  message?: string;
  storageError?: string;
  storageBlocked?: boolean;
}
export const useMacroStore = create<MacroState>(() => ({ saved: [] }));
export interface MacroCommandOptions {
  canRecord(): boolean;
  canPreview?(): boolean;
  currentSession(): number;
  commands(): readonly string[];
  previewPlan(input: { label: string; steps: { command: string; arguments: JsonValue }[] }): Promise<unknown>;
  subscribeExecutions(listener: (event: { request: CommandRequest; result: JsonValue }) => void): () => void;
  subscribeSession?(listener: () => void): () => void;
}
let previewing = false;
function readSaved(commands: readonly string[]) {
  try {
    const text = window.localStorage.getItem(MACRO_STORAGE_KEY);
    if (!text) return { saved: [], storageBlocked: false, storageError: undefined };
    const value = parseBoundedJson(text, MACRO_LIMITS.bytes, "Macro library");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid macro library.");
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some(key => !["version", "macros"].includes(key)) || data.version !== 1 || !Array.isArray(data.macros) || data.macros.length > MACRO_LIMITS.saved) throw new Error("Invalid macro library.");
    const saved = data.macros.map(value => validateMacro(value, commands));
    if (new Set(saved.map(macro => macro.id)).size !== saved.length) throw new Error("Macro library has duplicate IDs.");
    return { saved, storageBlocked: false, storageError: undefined };
  } catch (error) { return { saved: [], storageBlocked: true, storageError: `Saved workflows could not be loaded. Existing browser data is preserved; new workflows remain available for this session only. Export JSON for backup. ${error instanceof Error ? error.message : String(error)}` }; }
}
function persist(saved: ModelingMacro[]) {
  const text = JSON.stringify({ version: 1, macros: saved });
  try { parseBoundedJson(text, MACRO_LIMITS.bytes, "Macro library"); }
  catch { throw new Error("Workflow library exceeds 256 KiB. Delete a saved workflow or use shorter workflows."); }
  let storageError: string | undefined;
  try {
    if (useMacroStore.getState().storageBlocked) { useMacroStore.setState({ saved }); return; }
    window.localStorage.setItem(MACRO_STORAGE_KEY, text);
  }
  catch { storageError = "Workflows changed for this session. Browser storage is unavailable; export JSON to keep them."; }
  useMacroStore.setState({ saved, storageError });
}
function macroId(value: JsonValue | undefined) { return stringArgument(value, "Macro ID", 160); }
function selectedMacro(id: string) {
  const macro = useMacroStore.getState().saved.find(item => item.id === id);
  if (!macro) throw new Error("Saved workflow no longer exists. Refresh the list.");
  return macro;
}
export function registerMacroCommands(options: MacroCommandOptions) {
  const releases: (() => void)[] = [];
  const commands = () => options.commands().filter(command => command.startsWith("cad."));
  const canPreview = () => options.canPreview?.() ?? options.canRecord();
  let currentSession = options.currentSession();
  useMacroStore.setState({ ...readSaved(commands()), recording: undefined, draft: undefined });
  const register = (id: string, label: string, properties: Record<string, JsonValue>, invoke: (args: Record<string, JsonValue>) => unknown, guard?: () => string | undefined) => {
    releases.push(bindCommand({ id, label, kind: "domain", input: { type: "object", additionalProperties: false, properties } }, {
      id: "domain", label: () => label, available: () => guard?.(), invoke: args => invoke(objectArguments(args[0] ?? {}, Object.keys(properties))),
    }));
  };
  const string = { type: "string" } as JsonValue;
  register("macro.list", "List modeling workflows", {}, () => ({ saved: useMacroStore.getState().saved, draft: useMacroStore.getState().draft ?? null, recording: Boolean(useMacroStore.getState().recording) }));
  register("macro.start", "Record modeling workflow", {}, () => {
    if (!options.canRecord()) throw new Error("Finish the current task before recording a workflow.");
    if (useMacroStore.getState().recording) throw new Error("A workflow recording is already active.");
    useMacroStore.setState({ recording: { session: options.currentSession(), steps: [], results: [] }, draft: undefined, message: "Recording modeling commands. Interface clicks and camera movement are excluded." });
  }, () => !options.canRecord() ? "Finish the current task before recording." : useMacroStore.getState().recording ? "A recording is already active." : undefined);
  register("macro.stop", "Stop modeling workflow recording", {}, () => {
    const recording = useMacroStore.getState().recording;
    if (!recording) throw new Error("No workflow recording is active.");
    if (recording.session !== options.currentSession()) { useMacroStore.setState({ recording: undefined, draft: undefined, message: "Project changed; recording discarded." }); throw new Error("Recording became stale after the project changed."); }
    if (!recording.steps.length) { useMacroStore.setState({ recording: undefined, draft: undefined, message: "No semantic modeling edits were recorded. Use typed CAD commands or supported modeling tools." }); return { steps: 0 }; }
    const draft = validateMacro({ version: 1, id: createId("macro"), name: "Recorded workflow", variables: [], steps: recording.steps }, commands());
    useMacroStore.setState({ recording: undefined, draft, message: `${draft.steps.length} modeling steps recorded. Name and save the workflow.` });
    return { steps: draft.steps.length };
  });
  register("macro.save", "Save modeling workflow", { name: string, macro: { type: "object" }, overwrite: { type: "boolean" } }, args => {
    if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") throw new Error("overwrite must be a boolean.");
    const source = args.macro ?? useMacroStore.getState().draft;
    if (!source) throw new Error("Record or import a workflow before saving.");
    const checked = validateMacro(source, commands());
    if (args.name !== undefined) checked.name = stringArgument(args.name, "Workflow name", 120).trim();
    const macro = validateMacro(checked, commands());
    if (args.macro !== undefined && useMacroStore.getState().saved.some(item => item.id === macro.id) && args.overwrite !== true) throw new Error("A workflow with this ID already exists. Use overwrite: true explicitly or import JSON to create a separate workflow.");
    const saved = useMacroStore.getState().saved.filter(item => item.id !== macro.id);
    if (saved.length >= MACRO_LIMITS.saved) throw new Error("Delete a saved workflow before adding another; maximum 30.");
    persist([...saved, macro]); useMacroStore.setState({ draft: undefined, message: `Saved ${macro.name}.` });
    return macro;
  });
  register("macro.parameterize", "Make a workflow argument adjustable", { macroId: string, step: { type: "integer" }, path: { type: "array", items: string }, variable: { type: "object" } }, args => {
    const source = args.macroId === undefined ? useMacroStore.getState().draft : selectedMacro(macroId(args.macroId));
    if (!source || !Number.isSafeInteger(args.step) || !Array.isArray(args.path) || !args.path.every(key => typeof key === "string") || !args.variable || typeof args.variable !== "object" || Array.isArray(args.variable)) throw new Error("Choose a workflow step, argument path and typed variable.");
    const next = parameterizeMacro(source, Number(args.step), args.path as string[], args.variable as unknown as MacroVariable, commands());
    if (args.macroId === undefined) useMacroStore.setState({ draft: next });
    else persist(useMacroStore.getState().saved.map(item => item.id === next.id ? next : item));
    return next;
  });
  register("macro.delete", "Delete saved workflow", { macroId: string }, args => {
    const id = macroId(args.macroId); selectedMacro(id);
    persist(useMacroStore.getState().saved.filter(item => item.id !== id));
  });
  register("macro.import", "Import modeling workflow JSON", { text: string }, args => {
    const macro = importMacro(stringArgument(args.text, "Macro JSON", MACRO_LIMITS.bytes), commands());
    // Imported IDs cannot overwrite an unrelated local workflow.
    macro.id = createId("macro");
    const saved = useMacroStore.getState().saved;
    if (saved.length >= MACRO_LIMITS.saved) throw new Error("Delete a saved workflow before importing another; maximum 30.");
    persist([...saved, macro]); return macro;
  });
  register("macro.export", "Export modeling workflow JSON", { macroId: string, download: { type: "boolean" } }, args => {
    const macro = selectedMacro(macroId(args.macroId)), text = JSON.stringify(macro, null, 2);
    if (args.download !== undefined && typeof args.download !== "boolean") throw new Error("download must be a boolean.");
    if (args.download) downloadArrayBuffer(new TextEncoder().encode(text).buffer, safeFilename(macro.name, ".pcadmacro.json"), "application/json");
    return { text };
  });
  register("macro.preview", "Preview saved modeling workflow", { macroId: string, values: { type: "object" } }, async args => {
    if (!canPreview() || previewing) throw new Error("Finish the current task before previewing a workflow.");
    const macro = selectedMacro(macroId(args.macroId)), values = args.values ?? {};
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Workflow values must be an object.");
    const steps = instantiateMacro(macro, values as Record<string, JsonValue>, commands());
    previewing = true;
    try { return await options.previewPlan({ label: macro.name, steps }); }
    finally { previewing = false; }
  }, () => !canPreview() ? "Finish the current task before previewing." : previewing ? "A workflow preview is already in progress." : undefined);
  releases.push(options.subscribeExecutions(({ request, result }) => {
    const recording = useMacroStore.getState().recording;
    if (!recording || previewing || !commands().includes(request.command)) return;
    if (recording.session !== options.currentSession()) { useMacroStore.setState({ recording: undefined, draft: undefined, message: "Project changed; recording discarded." }); return; }
    const preserveDraft = () => recording.steps.length ? { version: 1 as const, id: createId("macro"), name: "Recorded workflow", variables: [], steps: recording.steps } : undefined;
    try {
      if (recording.steps.length >= MACRO_LIMITS.steps) { useMacroStore.setState({ recording: undefined, draft: preserveDraft(), message: "Recording reached 100 steps. Save these steps and start a shorter workflow." }); return; }
      const step = recordMacroStep(request, recording.results);
      validateMacro({ version: 1, id: "recording", name: "Recording", variables: [], steps: [...recording.steps, step] }, commands());
      useMacroStore.setState({ recording: { ...recording, steps: [...recording.steps, step], results: [...recording.results, result] } });
    } catch (error) { useMacroStore.setState({ recording: undefined, draft: preserveDraft(), message: `Recording stopped: ${error instanceof Error ? error.message : String(error)}` }); }
  }));
  if (options.subscribeSession) releases.push(options.subscribeSession(() => {
    const session = options.currentSession();
    if (session === currentSession) return;
    currentSession = session;
    const state = useMacroStore.getState();
    if (state.recording || state.draft) useMacroStore.setState({
      recording: undefined, draft: undefined,
      message: "Project changed; the recording and unsaved workflow draft were discarded. Saved workflows are unchanged.",
    });
  }));
  return () => releases.forEach(release => release());
}
