import { applyCadCommand, type CadCommandResult } from "../../commands/cadCommandOperations";
import { reportAppliedCommand, type CommandRequest } from "../../commands/registry";
import { createId, stableBodyIdForFeature } from "../../cad/document/ids";
import type { CadDocument, ExtrudeFeature, ShellFeature } from "../../cad/document/schema";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { assertNativeSolidPreview } from "./modelingDraftCommand";
import { shellTarget, useShell } from "../../state/shellDraftState";
import { shellTaskBusy } from "./shellAvailability";

export interface ShellInput {
  opening: ShellFeature["opening"];
  wallThickness: string;
}
export interface ShellFrame {
  id: string;
  document: CadDocument;
  selection: CadStore["selection"];
  session: number;
  componentId: string;
  result: RebuildResult;
  source: ExtrudeFeature;
  existing?: ShellFeature;
  openings: ShellFeature["opening"][];
}

export function beginShell(edit = false) {
  const state = useCadStore.getState(), target = shellTarget(state, edit);
  if (!target || shellTaskBusy(state)) throw new Error("Select an unmodified native rectangular extrusion or an existing Shell feature, and finish other tasks first.");
  useShell.setState({ frame: {
    ...target, id: createId("shell-draft"), document: state.history.present, selection: state.selection, session: state.documentSession,
    componentId: state.activeComponentId,
  } });
}

export function currentShell(frame: ShellFrame, state = useCadStore.getState()) {
  return useShell.getState().frame === frame && state.history.present === frame.document &&
    state.selection === frame.selection && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && state.rebuild.result === frame.result && !shellTaskBusy(state, true);
}

export function cancelShell() {
  useShell.setState({ frame: undefined });
}

export interface ShellPreview {
  frame: ShellFrame;
  input: ShellInput;
  document: CadDocument;
  result: RebuildResult;
  featureId: string;
  request: CommandRequest;
  receipt: CadCommandResult;
}
const issuedPreviews = new WeakSet<ShellPreview>();

export async function previewShell(frame: ShellFrame, input: ShellInput, signal: AbortSignal): Promise<ShellPreview> {
  if (!currentShell(frame)) throw new Error("The project or selection changed. Reopen Shell.");
  if (!frame.openings.includes(input.opening)) throw new Error("Choose a supported opening cap.");
  const request: CommandRequest = {
    ...(frame.existing
      ? { command: "cad.feature.update", arguments: { ...input, featureId: frame.existing.id } }
      : { command: "cad.feature.shell", arguments: { ...input, sourceFeatureId: frame.source.id } }),
    target: "domain",
    session: frame.session,
  };
  const { document, result: receipt } = applyCadCommand(frame.document, request);
  const featureId = receipt.id;
  if (!featureId || (frame.existing && featureId !== frame.existing.id))
    throw new Error("Shell did not return the expected feature ID. Reopen the task.");
  const result = await previewModeling(document, signal);
  if (signal.aborted || !currentShell(frame)) throw new Error("Shell preview was canceled or became stale.");
  assertNativeSolidPreview(result, document.id);
  if (!frame.existing) {
    const body = result.meshes.find(item => item.bodyId === stableBodyIdForFeature(frame.source.id));
    if (body?.kernelOperation !== "shell" || body.geometryAssertions?.solidCount !== 1)
      throw new Error("Shell did not produce one native solid on the original body.");
  }
  const preview = { frame, input: { ...input }, document, result, featureId, request, receipt };
  issuedPreviews.add(preview);
  return preview;
}

export function applyShell(preview: ShellPreview, input: ShellInput) {
  if (!issuedPreviews.has(preview) || !currentShell(preview.frame) ||
      preview.input.opening !== input.opening || preview.input.wallThickness !== input.wallThickness)
    throw new Error("Wait for the latest valid native Shell preview before applying.");
  assertNativeSolidPreview(preview.result, preview.document.id);
  useCadStore.getState().setFileError(undefined);
  useCadStore.getState().updateDocument(document => {
    if (document !== preview.frame.document) throw new Error("Project changed before Shell was applied.");
    return preview.document;
  });
  // The synchronous store rebinds expressions into a new document object.
  const state = useCadStore.getState();
  if (state.fileError || state.history.present === preview.frame.document || state.documentSession !== preview.frame.session)
    throw new Error(state.fileError ?? "Shell could not be saved. Review the project diagnostics.");
  issuedPreviews.delete(preview);
  cancelShell();
  state.select({ kind: "feature", id: preview.featureId, documentId: preview.document.id });
  reportAppliedCommand(preview.request, preview.receipt);
}
