import { useState } from "react";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { useProjectDrop } from "../commands/projectDropCommand";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { applyInsertProject, cancelInsertProject, readReusableProject, reusablePartCurrent, useReusablePart } from "../commands/reusablePartCommand";
export function ReusablePartPanel() {
  // Shared task subscriptions keep readiness reactive when another runtime store changes.
  useCommandEnablement();
  useProjectDrop((s) => s.pending);
  const busy = useCadStore((s) => Boolean(s.fileBusy));
  const frame = useReusablePart((s) => s.frame);
  const current = useCadStore((s) => Boolean(frame && reusablePartCurrent(frame, s)));
  const [scope, setScope] = useState("");
  if (!frame)
    return null;
  return <ModalDialog label="Insert reusable part" className="workflow-dialog" onDismiss={cancelInsertProject}>
  <h2>Insert reusable part</h2>
  <p>Copy editable components into <strong>{frame.document.name}</strong>. The open project and its undo history are kept.</p>
  <label>Source project<input type="file" accept=".pcaddoc,.json" disabled={frame.reading || busy || !current} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      setScope("");
      if (file)
        void readReusableProject(file);
      event.currentTarget.value = "";
    }}/></label>
  {frame.reading ? <p role="status">Validating source project…</p> : null}
  {frame.source ? <>
   <p>{frame.filename}: {frame.source.name}</p>
   <label>Insert scope<select disabled={frame.reading || busy || !current} value={scope} onChange={(event) => setScope(event.target.value)}>
    <option value="">All source components</option>
    {Object.values(frame.source.components).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
   </select></label>
   <p>Components keep their source coordinates at the shared project origin. Parts may overlap. Placement transforms and assembly joints are unavailable.</p>
   <p>All source parameters are copied independently. Conflicting parameter names receive a numeric suffix; linked expressions follow the new names. References outside a selected component require inserting all components.</p>
   <p>Source cameras, metadata, and project identity are excluded.</p>
  </> : null}
  {!current ? <p role="alert">The current project changed. Cancel and start insertion again.</p> : null}
  {frame.error ? <p role="alert">{frame.error}</p> : null}
  <button type="button" disabled={!frame.source || frame.reading || busy || !current} onClick={() => applyInsertProject({ componentId: scope || undefined })}>Insert components</button>
  <button type="button" onClick={cancelInsertProject}>Cancel insertion</button>
 </ModalDialog>;
}
