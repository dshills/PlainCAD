import { upsertFeature } from "../../cad/document/CadDocument";
import { addComponent } from "../../cad/document/components";
import { createId } from "../../cad/document/ids";
import { STEP_IMPORT_MAX_BYTES, stepSourceDiagnostic } from "../../cad/document/stepImportSource";
import { validateDocument } from "../../cad/document/validate";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { beginFileJob, fileJobCurrent, finishFileJob, useFileJobs } from "../../persistence/fileJobs";
import { serializeProject } from "../../persistence/exportProject";
import { PROJECT_IMPORT_LIMITS } from "../../persistence/importSafety";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { assertNativeSolidPreview } from "./modelingDraftCommand";
import { canApplyStepImport, canOpenStepImport, consumeStepImportPreview, issueStepImportPreview, stepImportFrameCurrent } from "./stepImportAvailability";
import { stepImportSourceMatches, useStepImport, type StepImportFrame } from "./stepImportState";

let activeImport: AbortController | undefined;

export function stepImportCurrent(frame: StepImportFrame, state = useCadStore.getState()) {
  return stepImportFrameCurrent(frame, state, Boolean(activeImport && fileJobCurrent(activeImport)));
}

export async function beginStepImport(file: File | undefined, expected: CadStore) {
  const state = useCadStore.getState();
  if (state.history.present !== expected.history.present || state.documentSession !== expected.documentSession ||
      state.rebuild.result !== expected.rebuild.result)
    throw new Error("Project changed before starting STEP import. Open the tool again.");
  if (!canOpenStepImport(state)) throw new Error(state.rebuild.result?.stepImportDiagnostic ??
    "Wait for a current native rebuild and finish other tasks before importing STEP.");
  useStepImport.setState({
    frame: { source: state.history.present, sourceResult: state.rebuild.result, session: state.documentSession, busy: false },
  });
  if (file) await readStepImport(file);
}

export function cancelStepImport() {
  const controller = activeImport;
  activeImport = undefined;
  useStepImport.setState({ frame: undefined });
  if (controller && fileJobCurrent(controller)) useFileJobs.getState().cancel();
  controller?.abort();
}

useCadStore.subscribe(state => {
  const frame = useStepImport.getState().frame;
  if (frame && !stepImportSourceMatches(frame, state)) cancelStepImport();
});

export async function readStepImport(file: File) {
  const frame = useStepImport.getState().frame;
  if (!frame || frame.busy || !stepImportCurrent(frame)) throw new Error("Open a current STEP import task first.");
  const name = file.name.replace(/\.(step|stp)$/i, "").replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 120) || "Imported solid";
  const running: StepImportFrame = { ...frame, busy: true, name, error: undefined, preview: undefined };
  useStepImport.setState({ frame: running });
  const controller = beginFileJob("Validating STEP solid…");
  activeImport = controller;
  let finished: StepImportFrame = { ...running, busy: false };
  try {
    if (file.size > STEP_IMPORT_MAX_BYTES) throw new Error("STEP source exceeds the 512 KiB import limit. Export a smaller single solid.");
    const source = await file.text();
    if (!stepImportCurrent(running) || controller.signal.aborted) throw new Error("STEP import was canceled or became stale.");
    const sourceError = stepSourceDiagnostic(source);
    if (sourceError) throw new Error(sourceError);
    const { document: withComponent, component } = addComponent(frame.source, name);
    const featureId = createId("feature");
    const candidate = upsertFeature(withComponent, { type: "stepImport", operation: "newBody", id: featureId, componentId: component.id, name, stepSource: source });
    const issue = validateDocument(candidate)[0];
    if (issue) throw new Error(issue.message);
    if (new TextEncoder().encode(serializeProject(candidate)).byteLength > PROJECT_IMPORT_LIMITS.maxBytes)
      throw new Error("This import would exceed the editable project file size limit.");
    const result = await previewModeling(candidate, controller.signal);
    if (!stepImportCurrent(running) || controller.signal.aborted) throw new Error("STEP import was canceled or became stale.");
    assertNativeSolidPreview(result, candidate.id);
    const mesh = result.meshes.find(item => item.bodyId === `body:${featureId}`);
    if (!mesh || mesh.kernelOperation !== "stepImport" || mesh.geometryAssertions?.solidCount !== 1)
      throw new Error("STEP import did not produce its own validated native solid.");
    const preview = { document: candidate, result, componentId: component.id, featureId };
    issueStepImportPreview(preview);
    finished = { ...finished, preview };
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : "STEP source could not be read.";
    finished = { ...finished, error };
    throw new Error(error);
  } finally {
    finishFileJob(controller);
    if (activeImport === controller) activeImport = undefined;
    if (useStepImport.getState().frame === running)
      useStepImport.setState({ frame: finished });
  }
}

export function applyStepImport(expected: StepImportFrame | undefined) {
  const state = useCadStore.getState();
  const frame = useStepImport.getState().frame;
  if (!frame?.preview || frame !== expected || !canApplyStepImport(state))
    throw new Error("Wait for a current validated STEP preview.");
  const { document, componentId, featureId } = frame.preview;
  state.updateDocument(current => current === frame.source ? document : current);
  if (useCadStore.getState().history.present === frame.source)
    throw new Error("STEP solid could not be added. Review project diagnostics.");
  consumeStepImportPreview(frame.preview);
  cancelStepImport();
  useCadStore.getState().activateComponent(componentId);
  useCadStore.getState().select({ kind: "body", id: `body:${featureId}`, documentId: document.id });
}
