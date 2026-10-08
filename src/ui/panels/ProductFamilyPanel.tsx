import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { useCadStore } from "../../state/useCadStore";
import { captureConfiguration, configurationDocument, deleteConfiguration, editConfigurationExpression } from "../../cad/document/productConfigurations";
import { applyFamilyVariant, cancelFamily, captureFamilyFrame, compareFamily, currentFamily, downloadFamily, exportFamily, useProductFamily, type FamilyVariant } from "../commands/productFamilyCommand";
import type { FamilySession } from "../commands/productFamilyState";
import type { CadDocument } from "../../cad/document/schema";
import { nativeTaskReady } from "../commands/nativeTaskAvailability";
export function ProductFamilyPanel() { const owner = useProductFamily(state => state.frame); return owner ? <FamilyDialog key={owner.session} owner={owner} /> : null; }
function FamilyDialog({ owner }: { owner: FamilySession }) {
  const document = useCadStore(state => state.history.present), result = useCadStore(state => state.rebuild.result);
  const ready = useCadStore(state => currentFamily(owner) && nativeTaskReady(state, "family"));
  const [name, setName] = useState(""), [selected, setSelected] = useState<string[]>([]), [editing, setEditing] = useState(""), [values, setValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<FamilyVariant[]>([]), [previewId, setPreviewId] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => { active.current?.abort(); setBusy(false); setRows([]); setMessage(""); setError(""); setSelected(ids => ids.filter(id => document.configurations?.some(configuration => configuration.id === id))); }, [document, result]);
  useEffect(() => () => active.current?.abort(), []);
  const edit = (action: (document: CadDocument) => CadDocument) => {
    try {
      if (!ready || busy) throw new Error("Wait for the current native model and finish the batch task first.");
      const live = useCadStore.getState();
      if (!currentFamily(owner) || live.history.present !== document || !nativeTaskReady(live, "family")) throw new Error("Project changed. Reopen configurations.");
      // Compute before the store callback so validation errors stay in this task.
      const candidate = action(document);
      useCadStore.getState().updateDocument(current => current === document ? candidate : current);
      if (useCadStore.getState().history.present === document) throw new Error(useCadStore.getState().fileError ?? "Project changed. Reopen configurations.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const job = async (exporting: boolean) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try {
      if (exporting) { const file = await exportFamily(rows, controller.signal, setMessage); if (!controller.signal.aborted) { downloadFamily(rows, file); setMessage("Configuration archive downloaded"); } }
      else { const frame = captureFamilyFrame(owner); setRows([]); const rows = await compareFamily(frame, [...selected], controller.signal, setMessage); if (!controller.signal.aborted) { setRows(rows); setPreviewId(rows.find(row => row.result)?.id ?? ""); setMessage("Comparison complete"); } }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (active.current === controller) { active.current = undefined; setBusy(false); } }
  };
  const beginEditing = (id: string) => {
    setEditing(id); setError("");
    try { const candidate = configurationDocument(document, id); const configuration = document.configurations!.find(configuration => configuration.id === id)!; setValues(Object.fromEntries(configuration.parameters.map(entry => [entry.parameterId, Object.values(candidate.parameters).find(parameter => parameter.id === entry.parameterId)!.expression]))); }
    catch { setValues(Object.fromEntries(document.configurations!.find(configuration => configuration.id === id)!.parameters.map(entry => [entry.parameterId, entry.expression.expression]))); }
  };
  const validBatch = rows.length === selected.length && rows.length > 0 && rows.every(row => row.result && !row.error && selected.includes(row.id));
  const shown = rows.find(row => row.id === previewId);
  return <ModalDialog label="Product configurations" className="file-dialog model-dialog extrude-dialog" onDismiss={cancelFamily}><section>
    <h2>Product configurations</h2><p>Save parameter expressions as named variants. New parameters inherit the current project; locked parameters are excluded. Bodies are rebuilt for comparison and export.</p>
    <label>Configuration name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
    <button type="button" disabled={!ready || busy || !name.trim()} onClick={() => { edit(current => captureConfiguration(current, name)); setName(""); }}>Save current configuration</button>
    <ul>{document.configurations?.map(configuration => <li key={configuration.id}>
      <label><input type="checkbox" checked={selected.includes(configuration.id)} disabled={busy} onChange={event => { setRows([]); setSelected(ids => event.target.checked ? [...ids, configuration.id] : ids.filter(id => id !== configuration.id)); }} />Compare {configuration.name}</label>
      <button type="button" disabled={!ready || busy} onClick={() => beginEditing(configuration.id)}>Edit {configuration.name}</button>
      <button type="button" disabled={!ready || busy} onClick={() => edit(current => captureConfiguration(current, configuration.name, configuration.id))}>Recapture {configuration.name}</button>
      <button type="button" disabled={!ready || busy} onClick={() => { edit(current => deleteConfiguration(current, configuration.id)); if (editing === configuration.id) setEditing(""); }}>Delete {configuration.name}</button>
    </li>)}</ul>
    {editing ? <fieldset><legend>Configuration expressions</legend>{document.configurations?.find(configuration => configuration.id === editing)?.parameters.map(entry => {
      const parameter = Object.values(document.parameters).find(parameter => parameter.id === entry.parameterId);
      return <label key={entry.parameterId}>{parameter?.name ?? "Deleted parameter"}<input disabled={!parameter || parameter.locked || busy} value={values[entry.parameterId] ?? entry.expression.expression} onChange={event => setValues(values => ({ ...values, [entry.parameterId]: event.target.value }))} /></label>;
    })}<button type="button" disabled={!ready || busy} onClick={() => { edit(current => Object.entries(values).reduce((candidate, [id, expression]) => editConfigurationExpression(candidate, editing, id, expression), current)); }}>Save configuration expressions</button><button type="button" onClick={() => setEditing("")}>Close expression editor</button></fieldset> : null}
    <button type="button" disabled={!ready || busy || !selected.length || selected.length > 8} onClick={() => void job(false)}>Compare selected configurations</button>
    <p role="status">{!currentFamily(owner) ? "Project changed. Close and reopen configurations." : !ready ? "Waiting for native model…" : message || "Select up to 8 configurations"}</p>
    {rows.length ? <table><caption>Native comparison · mm and mm³</caption><thead><tr><th>Configuration</th><th>Size X × Y × Z per body</th><th>Volume</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><th>{row.name}</th><td>{row.result?.meshes.map(mesh => <div key={mesh.bodyId}>{mesh.bounds.max.map((value, axis) => (value - mesh.bounds.min[axis]).toFixed(2)).join(" × ")}</div>) ?? row.error}</td><td>{row.result?.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0).toFixed(3) ?? "Unavailable"}</td><td><button type="button" disabled={!row.result || busy} onClick={() => setPreviewId(row.id)}>Preview {row.name}</button><button type="button" disabled={!row.result || busy || !ready} onClick={() => { try { applyFamilyVariant(row); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Apply {row.name}</button></td></tr>)}</tbody></table> : null}
    {shown?.result ? <ExtrudePreview meshes={shown.result.meshes} label={`Native configuration preview: ${shown.name}`} /> : null}
    <button type="button" disabled={!ready || busy || !validBatch} onClick={() => void job(true)}>Download configuration STL archive</button>
    {busy ? <button type="button" onClick={() => { active.current?.abort(); setMessage("Task canceled"); }}>Cancel configuration task</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    <p>Comparison keeps at most 250,000 triangles / 64 MiB; exports validate each separate part and cap the archive at 64 MiB. Geometry variants do not change the current model until Apply.</p>
    <button type="button" onClick={cancelFamily}>Close configurations</button>
  </section></ModalDialog>;
}
