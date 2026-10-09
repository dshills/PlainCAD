import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { createId } from "../cad/document/ids";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { parseBoundedJson } from "../persistence/importSafety";
import { assertProjectJsonShape } from "../persistence/importSafety";
import { useCadStore } from "../state/useCadStore";
import { useCommandPlan, type CommandPlanFrame } from "../state/commandPlanState";
import { clearAiCanvasPreview, currentAiCanvasPreview, publishCommandCanvasPreview, useAiCanvasPreview } from "../state/aiCanvasPreview";
import { applyCadCommand, type CadCommandCall } from "./cadCommandOperations";
import { isCadCommandId } from "./cadCommands";
import { objectArguments, stringArgument } from "./protocol";
import { bindCommand, reportAppliedCommand, type JsonValue } from "./registry";

export interface CommandPlanInput { label?: string; steps: CadCommandCall[] }
export const PLAN_LIMITS = { bytes: 256 * 1024, steps: 100, nativeChecks: 16, timeoutMs: 90000 } as const;
let controller: AbortController | undefined;
let guard: () => boolean = () => false;
let applying = false;
let failureSource: CadDocument | undefined;
let acceptedSteps: CadCommandCall[] = [];
let acceptedObserver: ((frame: CommandPlanFrame) => void) | undefined;

function inputPlan(value: unknown): CommandPlanInput {
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error("Supply a JSON command plan.");
  const args = objectArguments(parseBoundedJson(serialized, PLAN_LIMITS.bytes, "Command plan"), ["label", "steps"]);
  const label = args.label === undefined ? "Command plan" : stringArgument(args.label, "Plan label", 120).trim();
  if (!label || !Array.isArray(args.steps) || !args.steps.length || args.steps.length > PLAN_LIMITS.steps)
    throw new Error("Supply a label and 1–100 semantic CAD steps.");
  const steps = args.steps.map(value => {
    const step = objectArguments(value, ["command", "arguments"]);
    if (typeof step.command !== "string" || !isCadCommandId(step.command)) throw new Error("Plans accept only discovered cad.* modeling commands.");
    return { command: step.command, arguments: step.arguments ?? {} };
  });
  return { label, steps };
}
/** References resolve only backward into JSON results, never into runtime handles. */
export function resolvePlanReferences(value: JsonValue, results: readonly JsonValue[], depth = 0): JsonValue {
  if (depth > 32) throw new Error("Command plan arguments are nested too deeply.");
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => resolvePlanReferences(item, results, depth + 1));
  if (Object.hasOwn(value, "$result")) {
    const ref = objectArguments(value.$result, ["step", "path"]);
    if (Object.keys(value).length !== 1 || !Number.isSafeInteger(ref.step) || Number(ref.step) < 0 || Number(ref.step) >= results.length || !Array.isArray(ref.path) || ref.path.length > 16)
      throw new Error("Result references must identify an earlier step and a bounded property path.");
    let current = results[Number(ref.step)];
    for (const key of ref.path) {
      if ((typeof key !== "string" && typeof key !== "number") || !current || typeof current !== "object" || !Object.hasOwn(current, key)) throw new Error("Command result reference was lost. Inspect the earlier step result.");
      current = (current as Record<string | number, JsonValue>)[key];
    }
    return JSON.parse(JSON.stringify(current)) as JsonValue;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Command plan contains an unsafe property.");
    return [key, resolvePlanReferences(item, results, depth + 1)];
  }));
}
function frameCurrent(frame: CommandPlanFrame) {
  const state = useCadStore.getState();
  return state.history.present === frame.source && state.documentSession === frame.session && state.activeComponentId === frame.componentId &&
    state.rebuild.result === frame.beforeResult && !state.fileBusy &&
    (state.rebuild.status === "succeeded" || (state.rebuild.status === "idle" && !frame.source.features.length)) &&
    state.selection.selectedIds.length === frame.selection.length && state.selection.selectedIds.every((item, i) =>
      item.id === frame.selection[i].id && item.kind === frame.selection[i].kind && item.documentId === frame.selection[i].documentId);
}
function nativeProof(result: RebuildResult, document: CadDocument) {
  if (result.documentId !== document.id || !result.success || result.errors.length) {
    const errors = result.errors.map(error => `${error.sourceId ? `[${error.sourceId}] ` : ""}${error.message}`).join(" ");
    throw new Error(`Native geometry validation failed. ${errors || "The model could not be rebuilt."}`);
  }
  if (document.features.some(feature => !feature.suppressed) && !result.meshes.length) throw new Error("Native validation produced no solid geometry for the active features.");
  for (const mesh of result.meshes) {
    const proof = mesh.geometryAssertions;
    if (mesh.geometrySource !== "opencascade" || !proof?.valid || !Number.isInteger(proof.solidCount) || proof.solidCount < 1 || !Number.isFinite(proof.volume) || proof.volume <= 0)
      throw new Error(`Body ${mesh.bodyId} has no valid native solid/volume proof. Unsupported modeling cannot be applied.`);
  }
  return result.meshes.map(mesh => ({ bodyId: mesh.bodyId, ...mesh.geometryAssertions! }));
}
function planSummary(frame: CommandPlanFrame) {
  return { planId: frame.id, status: useCommandPlan.getState().status, label: frame.label, results: frame.results,
    changedBodyIds: frame.bodyIds, nativeProof: frame.result && frame.document ? nativeProof(frame.result, frame.document) : [] };
}
export function cancelCommandPlan() {
  controller?.abort(); controller = undefined;
  const frame = useCommandPlan.getState().frame;
  const preview = useAiCanvasPreview.getState().preview;
  if (preview?.planId && (!frame || preview.planId === frame.id)) clearAiCanvasPreview(preview);
  acceptedSteps = []; failureSource = undefined;
  useCommandPlan.setState({ status: "idle", frame: undefined, progress: undefined, error: undefined });
}
export async function previewCommandPlan(value: CommandPlanInput) {
  const input = inputPlan(value);
  if (!guard()) throw new Error("Finish the current task and wait for the current model before previewing a plan.");
  if (useAiCanvasPreview.getState().preview && !useAiCanvasPreview.getState().preview?.planId)
    throw new Error("Apply or dismiss the current AI proposal first.");
  cancelCommandPlan();
  const state = useCadStore.getState();
  const frame: CommandPlanFrame = { id: createId("plan"), label: input.label!, source: state.history.present,
    session: state.documentSession, componentId: state.activeComponentId, selection: state.selection.selectedIds.map(item => ({ ...item })),
    beforeResult: state.rebuild.result, results: [], bodyIds: [], steps: input.steps.length };
  const abort = new AbortController(); controller = abort;
  const timeout = setTimeout(() => abort.abort(), PLAN_LIMITS.timeoutMs);
  useCommandPlan.setState({ status: "previewing", frame, progress: "Preparing command plan", error: undefined });
  const ensureCurrent = () => {
    if (abort.signal.aborted || controller !== abort || useCommandPlan.getState().frame !== frame) throw new Error("Command plan was cancelled or timed out. The accepted project was preserved.");
    if (!frameCurrent(frame)) throw new Error("Project, selection or model changed during preview. Refresh the plan before applying.");
  };
  try {
    let document = frame.source;
    let aliases: Record<string, string> = {};
    let result: RebuildResult | undefined;
    let nativeChecks = 0;
    const calls: CadCommandCall[] = [];
    for (const [index, step] of input.steps.entries()) {
      ensureCurrent();
      useCommandPlan.setState({ progress: `Step ${index + 1}/${input.steps.length}: ${step.command}` });
      const call = { command: step.command, arguments: resolvePlanReferences(step.arguments ?? {}, frame.results) };
      const applied = applyCadCommand(document, call, { aliases });
      const changed = applied.document !== document;
      document = applied.document; aliases = applied.aliases;
      frame.results.push(JSON.parse(JSON.stringify({ ...applied.result, aliases })) as JsonValue);
      calls.push(call);
      // Validate every authored modeling operation before a later step can hide its failure.
      if (changed && document.features.some(feature => !feature.suppressed)) {
        if (++nativeChecks > PLAN_LIMITS.nativeChecks) throw new Error("Split this plan into at most 16 edits to modeled geometry per preview.");
        result = await previewModeling(document, abort.signal); ensureCurrent(); nativeProof(result, document);
      } else if (changed) result = undefined;
    }
    if (document === frame.source) throw new Error("The command plan makes no changes.");
    assertProjectJsonShape(document);
    useCommandPlan.setState({ progress: "Checking final native geometry" });
    if (!result) result = await previewModeling(document, abort.signal);
    ensureCurrent(); nativeProof(result, document);
    frame.document = document; frame.result = result;
    const before = frame.beforeResult?.meshes ?? [];
    const changed = (a: RebuildResult["meshes"][number], b: RebuildResult["meshes"][number]) => {
      if (a.positions.length !== b.positions.length || a.indices.length !== b.indices.length) return true;
      for (let index = 0; index < a.positions.length; index++) if (Math.abs(a.positions[index] - b.positions[index]) > 1e-7) return true;
      return a.indices.some((value, index) => value !== b.indices[index]);
    };
    const old = new Map(before.map(mesh => [mesh.bodyId, mesh]));
    const after = new Map(result.meshes.map(mesh => [mesh.bodyId, mesh]));
    frame.bodyIds = [...new Set([...before.filter(mesh => !after.has(mesh.bodyId)).map(mesh => mesh.bodyId),
      ...result.meshes.filter(mesh => !old.has(mesh.bodyId) || changed(mesh, old.get(mesh.bodyId)!)).map(mesh => mesh.bodyId)])];
    if (!publishCommandCanvasPreview({ document: frame.source, candidate: document, session: frame.session, componentId: frame.componentId,
      selection: frame.selection, beforeResult: frame.beforeResult, result, bodyIds: frame.bodyIds, planId: frame.id }))
      throw new Error("The canvas could not accept this native preview. The project was preserved.");
    acceptedSteps = calls;
    useCommandPlan.setState({ status: "ready", frame, progress: undefined });
    return { ...planSummary(frame), status: "ready" as const };
  } catch (error) {
    const message = `${useCommandPlan.getState().frame === frame ? `${useCommandPlan.getState().progress ?? frame.label}: ` : ""}${error instanceof Error ? error.message : String(error)}`;
    if (useCommandPlan.getState().frame === frame) {
      cancelCommandPlan(); failureSource = frame.source;
      useCommandPlan.setState({ status: "failed", error: message });
    }
    throw new Error(message);
  } finally { clearTimeout(timeout); if (controller === abort) controller = undefined; }
}
/** Local AI ownership is runtime provenance, not an agent-supplied geometry proof. */
export function markAiCommandPlan(planId: string) {
  const { frame, status } = useCommandPlan.getState();
  if (!frame || frame.id !== planId || status !== "ready" || !frameCurrent(frame) ||
    currentAiCanvasPreview(useCadStore.getState())?.planId !== planId) throw new Error("The AI plan became stale before ownership could be recorded.");
  frame.owner = "ai";
}
export function applyCommandPlan(planId: string) {
  const { frame, status } = useCommandPlan.getState();
  if (!frame || frame.id !== planId || status !== "ready" || !frame.document || !frame.result || !frameCurrent(frame) || !guard() ||
    currentAiCanvasPreview(useCadStore.getState())?.planId !== frame.id) throw new Error("Plan proof is stale or unavailable. Preview it again before applying.");
  nativeProof(frame.result, frame.document);
  const steps = acceptedSteps;
  applying = true;
  try {
    useCadStore.getState().setFileError(undefined);
    useCadStore.getState().updateDocument(document => {
      if (document !== frame.source) throw new Error("Project changed before plan commit.");
      return frame.document!;
    });
    const state = useCadStore.getState();
    if (state.fileError || state.history.present === frame.source) throw new Error(state.fileError ?? "Command plan was not committed.");
    cancelCommandPlan();
    try { acceptedObserver?.(frame); }
    catch { useCadStore.getState().setFileError("AI Undo provenance could not be recorded. The change was applied; use normal Undo."); }
    steps.forEach((step, index) => reportAppliedCommand({ ...step, target: "domain", session: frame.session }, frame.results[index]));
    return { planId, applied: true, steps: frame.steps, documentId: state.history.present.id };
  } finally { applying = false; }
}
export function registerCommandPlanCommands(canPreview: () => boolean, onApplied?: (frame: CommandPlanFrame) => void) {
  guard = canPreview; acceptedObserver = onApplied;
  const bind = (id: string, label: string, input: JsonValue, invoke: (value: unknown) => unknown, available = () => undefined as string | undefined) =>
    bindCommand({ id, label, kind: "domain", input }, { id: "domain", label: () => label, available, invoke: args => invoke(args[0]) });
  const disposers = [
    bind("plan.preview", "Preview a transactional CAD command plan", {
      type: "object", additionalProperties: false, required: ["steps"],
      properties: { label: { type: "string", maxLength: 120 }, steps: {
        type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["command", "arguments"],
          properties: { command: { type: "string" }, arguments: { type: "object" } } },
      } },
    }, value => previewCommandPlan(inputPlan(value)), () => guard() ? undefined : "Finish the current task before previewing a plan."),
    bind("plan.apply", "Apply a native-validated command plan as one edit", { type: "object", required: ["planId"], additionalProperties: false, properties: { planId: { type: "string" } } }, value => applyCommandPlan(stringArgument(objectArguments(value, ["planId"]).planId, "Plan ID", 160)), () => {
      const state = useCommandPlan.getState();
      return state.status === "ready" && state.frame && frameCurrent(state.frame) && guard() &&
        currentAiCanvasPreview(useCadStore.getState())?.planId === state.frame.id ? undefined : "Preview a current native-valid command plan before applying.";
    }),
    bind("plan.cancel", "Cancel the current command plan", { type: "object", additionalProperties: false }, value => { objectArguments(value, []); cancelCommandPlan(); }),
    bind("plan.status", "Inspect the current command plan", { type: "object", additionalProperties: false }, value => { objectArguments(value, []); const state = useCommandPlan.getState(); return state.frame ? planSummary(state.frame) : { status: state.status, error: state.error ?? null }; }),
  ];
  return () => { cancelCommandPlan(); disposers.forEach(dispose => dispose()); guard = () => false; acceptedObserver = undefined; };
}
useCadStore.subscribe(() => {
  const frame = useCommandPlan.getState().frame;
  if (!applying && (frame && !frameCurrent(frame) || failureSource && useCadStore.getState().history.present !== failureSource)) cancelCommandPlan();
});
