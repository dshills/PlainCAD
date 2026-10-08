import { assertStepSelection } from "../../fabrication/stepExport";
import { downloadArrayBuffer, projectFilename } from "../../persistence/exportProject";
import { beginFileJob, fileJobCurrent, finishFileJob, useFileJobs } from "../../persistence/fileJobs";
import { useCadStore } from "../../state/useCadStore";
import { stepExportRuntime, useStepExport } from "./stepExportState";
import { cancelStepExport, stepExportCurrent } from "./stepExportCommand";
export async function prepareStepExport() {
  const current = useStepExport.getState().frame;
  if (!current || current.busy || !stepExportCurrent(current)) return;
  const frame = { ...current, busy: true, prepared: undefined, error: undefined };
  useStepExport.setState({ frame });
  const controller = beginFileJob("Preparing validated native STEP export…"); stepExportRuntime.controller = controller;
  const unsubscribe = useCadStore.subscribe(state => { if (!stepExportCurrent(frame, state)) controller.abort(); });
  try {
    assertStepSelection(frame.bodyIds, frame.result.meshes.map(mesh => mesh.bodyId));
    const { exportStepDocument } = await import("../../fabrication/stepExportClient");
    const prepared = await exportStepDocument(frame.document, [...frame.bodyIds], frame.session, controller.signal, message => {
      if (fileJobCurrent(controller)) useFileJobs.setState({ message });
    });
    if (useStepExport.getState().frame !== frame) return;
    if (!fileJobCurrent(controller) || !stepExportCurrent(frame)) throw new Error("Project changed during STEP export. Reopen and generate the current native model again.");
    useStepExport.setState({ frame: { ...frame, busy: false, prepared } });
  } catch (error) {
    if (useStepExport.getState().frame === frame) useStepExport.setState({ frame: { ...frame, busy: false, error: error instanceof Error ? error.message : "STEP export failed." } });
  } finally { unsubscribe(); finishFileJob(controller); if (stepExportRuntime.controller === controller) stepExportRuntime.controller = undefined; }
}
export function downloadPreparedStep() {
  const frame = useStepExport.getState().frame;
  if (!frame?.prepared || frame.busy) return;
  if (!stepExportCurrent(frame)) {
    useStepExport.setState({ frame: { ...frame, prepared: undefined, error: "Model changed after STEP validation. Reopen and generate STEP again before downloading." } }); return;
  }
  try {
    downloadArrayBuffer(frame.prepared.bytes, projectFilename(frame.document, ".step"), "model/step");
    cancelStepExport();
  } catch (error) { useStepExport.setState({ frame: { ...frame, error: error instanceof Error ? error.message : "STEP download failed." } }); }
}
