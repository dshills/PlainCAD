import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { useFileJobs } from "../../persistence/fileJobs";
import { cancelStepExport, setStepExportBodies, stepExportCurrent, useStepExport } from "../commands/stepExportCommand";
import { downloadPreparedStep, prepareStepExport } from "../commands/stepExportJob";
import "./StepExportPanel.css";
export function StepExportPanel() {
  const frame = useStepExport(state => state.frame);
  const current = useCadStore(state => Boolean(frame && stepExportCurrent(frame, state)));
  const message = useFileJobs(state => state.message);
  if (!frame) return null;
  const names = bodyDisplayNames(frame.document, frame.result.bodies);
  return <ModalDialog label="Export STEP" className="model-dialog step-export-dialog" onDismiss={cancelStepExport}>
    <h2>Export native STEP solids</h2>
    <p>Selected bodies remain separate solids at their saved world positions. STEP carries millimetre geometry for other CAD tools; assembly joints, component labels and editable feature history remain in the project file.</p>
    <fieldset disabled={frame.busy || !current}><legend>Bodies to export</legend>
      <button type="button" onClick={() => setStepExportBodies(frame.result.meshes.map(mesh => mesh.bodyId))}>Select all STEP bodies</button>
      <button type="button" onClick={() => setStepExportBodies([])}>Clear STEP bodies</button>
      {frame.result.bodies.map(body => <label key={body.id}><input type="checkbox" checked={frame.bodyIds.includes(body.id)} onChange={event => setStepExportBodies(event.target.checked ? [...frame.bodyIds, body.id] : frame.bodyIds.filter(id => id !== body.id))}/>{names[body.id] ?? body.name}</label>)}
    </fieldset>
    {frame.busy ? <p role="status">{message ?? "Validating native STEP round trip…"}</p> : null}
    {!current ? <p role="alert">The model changed. Cancel and reopen STEP export after rebuilding.</p> : null}
    {frame.error ? <p role="alert">{frame.error}</p> : null}
    {frame.prepared && current ? <p role="status">Verified {frame.prepared.after.length} body roots and {frame.prepared.after.reduce((count, proof) => count + proof.solidCount, 0)} valid native solids. Exact volume and world bounds match after native STEP reimport. {(frame.prepared.bytes.byteLength / 1024).toFixed(1)} KiB, millimetres.</p> : null}
    <button type="button" disabled={!current || frame.busy || !frame.bodyIds.length} onClick={() => void prepareStepExport()}>Generate validated STEP</button>
    <button type="button" disabled={!current || frame.busy || !frame.prepared} onClick={downloadPreparedStep}>Download STEP file</button>
    <button type="button" onClick={cancelStepExport}>Cancel STEP export</button>
  </ModalDialog>;
}
