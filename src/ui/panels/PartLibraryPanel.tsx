import { useEffect, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import type { PartLibraryEntry } from "../../persistence/partLibrary";
import { ModalDialog } from "../ModalDialog";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { applyLibraryPlacement, beginLibraryPlacement, cancelLibraryPlacement, cancelPartLibrary, libraryFrameCurrent, PART_LIBRARY_DRAG_TYPE, recoverLibraryPart, removeSavedLibraryPart, renameSavedLibraryPart, resetDamagedLibrary, saveActiveLibraryPart, usePartLibrary } from "../commands/partLibraryCommand";
import "./PartLibraryPanel.css";
function SavedPartCard({ entry, disabled, canRename }: { entry: PartLibraryEntry; disabled: boolean; canRename: boolean }) {
  const [name, setName] = useState(entry.name);
  return <li className="part-library-card" draggable={!disabled} onDragStart={event => {
    if (disabled) { event.preventDefault(); return; }
    event.dataTransfer.setData(PART_LIBRARY_DRAG_TYPE, entry.id);
    event.dataTransfer.effectAllowed = "copy";
  }}>
    <img src={entry.thumbnail} width={96} height={96} alt={`${entry.name} native geometry thumbnail`} draggable={false}/>
    <div><strong>{entry.name}</strong><p>Drag onto the XY ground plane, or insert at its origin.</p></div>
    <button type="button" disabled={disabled} onClick={() => void beginLibraryPlacement(entry.id)}>Insert {entry.name} at origin</button>
    <label>Saved part name<input value={name} maxLength={120} disabled={disabled} onChange={event => setName(event.target.value)}/></label>
    <button type="button" disabled={disabled || !canRename || name.trim() === entry.name || !name.trim()} onClick={() => void renameSavedLibraryPart(entry.id, name)}>Rename {entry.name}</button>
    <button type="button" disabled={disabled} onClick={() => void removeSavedLibraryPart(entry.id)}>Delete saved copy of {entry.name}</button>
  </li>;
}
export function PartLibraryPanel() {
  useCommandEnablement();
  const frame = usePartLibrary(state => state.frame);
  const current = useCadStore(state => Boolean(frame && libraryFrameCurrent(frame, state)));
  const sourceName = frame?.document.components[frame.componentId]?.name ?? "";
  const [name, setName] = useState<string | undefined>();
  const [resetConfirmed, setResetConfirmed] = useState(false);
  useEffect(() => { setName(undefined); setResetConfirmed(false); }, [frame?.document.id, frame?.session, frame?.componentId]);
  if (!frame) return null;
  const title = name ?? (frame.componentId === frame.document.rootComponentId ? frame.document.name : sourceName);
  const needsRecovery = frame.damaged.length > 0 || frame.limited;
  if (frame.placement) return <ModalDialog label="Place library part" className="model-dialog part-library-placement" onDismiss={cancelLibraryPlacement}>
    <h2>Place {frame.placement.entry.name}</h2>
    <p>Component origin: X {frame.placement.origin.x.toFixed(3)} mm, Y {frame.placement.origin.y.toFixed(3)} mm, Z {frame.placement.origin.z.toFixed(3)} mm.</p>
    <p>Preview rebuilds the entire candidate project with native geometry. Apply adds an independent editable component in one undo step. Use Move component after insertion for precise position and rotation.</p>
    {frame.busy ? <p role="status">Validating native insertion preview…</p> : null}
    {frame.placement.result && current ? <ExtrudePreview meshes={frame.placement.result.meshes} label="Native library insertion preview"/> : null}
    {!current ? <p role="alert">The project or active component changed. Cancel and reopen the library.</p> : null}
    {frame.error ? <p role="alert">{frame.error}</p> : null}
    <button type="button" disabled={frame.busy || !frame.placement.result || !current || Boolean(frame.error)} onClick={applyLibraryPlacement}>Apply library insertion</button>
    <button type="button" onClick={cancelLibraryPlacement}>Cancel placement</button>
  </ModalDialog>;
  return <section role="region" aria-label="Local part library" className="part-library-panel" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelPartLibrary(); } }}>
    <div className="part-library-heading"><h2>Local part library</h2><button type="button" onClick={cancelPartLibrary}>Close library</button></div>
    <p>Saved on this browser only. Download project files separately for backups. Drag a saved part into the model, or use Insert at origin.</p>
    <label>Name for active component<input value={title} maxLength={120} disabled={frame.busy || !current} onChange={event => setName(event.target.value)}/></label>
    <button type="button" disabled={frame.busy || !current || !title.trim() || needsRecovery} onClick={() => void saveActiveLibraryPart(title)}>Save active component to library</button>
    <p>Save a self-contained component with native solids. References to other components must be repaired before saving. Saved parameters remain editable and insert independently.</p>
    {frame.busy ? <p role="status">Reading or updating local parts…</p> : null}
    {frame.notice ? <p role="status">{frame.notice}</p> : null}
    {!current ? <p role="alert">The project or active component changed. Close and reopen the library.</p> : null}
    {frame.error ? <p role="alert">{frame.error}</p> : null}
    {needsRecovery ? <section aria-label="Recover local part library">
      <p role="alert">Some saved copies could not be loaded safely. Delete damaged copies before saving or renaming parts. Valid parts can still be inserted or deleted.</p>
      {frame.limited ? <p>Only the first bounded page was loaded. Delete saved copies, then close and reopen the library to load the next page.</p> : null}
      {frame.damaged.map((entry, index) => <div key={`${index}:${entry.label}`}>
        <strong>{entry.label}</strong><p>{entry.message}</p>
        {entry.key !== undefined ? <button type="button" disabled={frame.busy || !current} onClick={() => void recoverLibraryPart(entry.key)}>Delete damaged saved copy {entry.label}</button> : <p>This storage key cannot be deleted individually. Reset the saved library copies below.</p>}
      </div>)}
      <label><input type="checkbox" checked={resetConfirmed} disabled={frame.busy || !current} onChange={event => setResetConfirmed(event.target.checked)}/>Delete all saved library copies permanently; keep my open project and inserted components.</label>
      <button type="button" disabled={!resetConfirmed || frame.busy || !current} onClick={() => void resetDamagedLibrary()}>Delete all saved library copies</button>
    </section> : null}
    {!frame.entries.length && !frame.busy ? <p>No saved parts yet.</p> : null}
    <ul className="part-library-list">{frame.entries.map(entry => <SavedPartCard key={entry.id} entry={entry} disabled={frame.busy || !current} canRename={!needsRecovery}/>)}</ul>
  </section>;
}
