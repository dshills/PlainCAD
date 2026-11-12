import { useCadStore } from "../../state/useCadStore";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { ModalDialog } from "../ModalDialog";
import { runCommand } from "../commands/commandRegistry";
import { readStepImport, stepImportCurrent } from "../commands/stepImportCommand";
import { useStepImport } from "../commands/stepImportState";
import { useCommandEnablement } from "../commands/useCommandEnablement";

export function StepImportPanel() {
  const frame = useStepImport(state => state.frame);
  const current = useCadStore(state => Boolean(frame && stepImportCurrent(frame, state)));
  const { applyStepImport } = useCommandEnablement();
  if (!frame) return null;
  const preview = current ? frame.preview : undefined;
  const mesh = preview?.result.meshes.find(item => item.bodyId === `body:${preview.featureId}`);
  return <ModalDialog label="Import STEP solid" className="file-dialog model-dialog extrude-dialog" onDismiss={() => void runCommand("file.cancelStepImport")}>
    <h2>Import STEP solid</h2>
    <p>Add a solid as a separate component at its original position. The source file has geometry only; its original sketches and feature history do not carry over.</p>
    <label>STEP file<input type="file" accept=".step,.stp" disabled={frame.busy || !current} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void readStepImport(file).catch(() => { /* The task reports the source error. */ });
    }} /></label>
    {mesh && preview ? <ExtrudePreview meshes={preview.result.meshes} label="Native STEP solid preview" /> : null}
    <p role="status">{frame.busy ? "Validating STEP solid…" : mesh ? `Native solid ready: ${frame.name} · ${mesh.geometryAssertions?.volume.toFixed(3)} mm³` : "Choose a STEP file containing one closed solid."}</p>
    {frame.error ? <p role="alert">{frame.error}</p> : null}
    <button type="button" disabled={!mesh || !applyStepImport} onClick={() => void runCommand("file.applyStepImport")}>Add STEP solid</button>
    <button type="button" onClick={() => void runCommand("file.cancelStepImport")}>Cancel STEP import</button>
  </ModalDialog>;
}
