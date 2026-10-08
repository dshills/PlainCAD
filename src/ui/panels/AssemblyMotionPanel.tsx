import { bodyComponentId } from "../../cad/document/components";
import { useEffect, useMemo, useState } from "react";
import { withJointMotion } from "../../cad/document/assemblyJoints";
import { withComponentPlacement } from "../../cad/document/componentPlacement";
import { useCadStore } from "../../state/useCadStore";
import { ModalDialog } from "../ModalDialog";
import { ComponentPlacementControls } from "../../viewer/ComponentPlacementControls";
import { applyAssemblyPreview, cancelComponentPlacement, isCurrentComponentPlacement, previewAssemblyDocument, type ComponentPlacementFrame, type ComponentPlacementPreview } from "../commands/componentPlacementCommand";
import { CommitInput } from "./CommitInput";
export function AssemblyMotionPanel({ frame }: { frame: ComponentPlacementFrame }) {
  if (!frame.document.assemblyJoints?.length) return null;
  return <AssemblyMotionDraft key={frame.document.updatedAt} frame={frame} />;
}
function AssemblyMotionDraft({ frame }: { frame: ComponentPlacementFrame }) {
  const document = useCadStore(state => state.history.present), rebuild = useCadStore(state => state.rebuild), fileBusy = useCadStore(state => state.fileBusy), session = useCadStore(state => state.documentSession), activeComponentId = useCadStore(state => state.activeComponentId);
  const [id, setId] = useState(frame.document.assemblyJoints![0].id);
  const joint = frame.document.assemblyJoints!.find(item => item.id === id) ?? frame.document.assemblyJoints![0];
  const [value, setValue] = useState(joint.value), [detach, setDetach] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<ComponentPlacementPreview>(), [busy, setBusy] = useState(false);
  const candidate = useMemo(() => {
    if (detach) {
      const posed = frame.result.componentPlacements?.[joint.childComponentId];
      return { ...(posed ? withComponentPlacement(frame.document, joint.childComponentId, posed) : frame.document), assemblyJoints: frame.document.assemblyJoints!.filter(item => item.id !== id) };
    }
    return withJointMotion(frame.document, id, value);
  }, [frame, id, joint, value, detach]);
  const current = isCurrentComponentPlacement(frame);
  useEffect(() => { if (!isCurrentComponentPlacement(frame)) cancelComponentPlacement(); }, [frame, document, rebuild, fileBusy, session, activeComponentId]);
  useEffect(() => {
    setPreview(undefined); setError(""); setBusy(true); const controller = new AbortController();
    const timer = window.setTimeout(() => void previewAssemblyDocument(frame, candidate, controller.signal).then(result => { if (!controller.signal.aborted) setPreview(result); }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); }), 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [frame, candidate]);
  const result = preview?.result ?? frame.result, placed = result.componentPlacements?.[joint.childComponentId] ?? frame.placement;
  const bodyIds = frame.result.meshes.filter(mesh => bodyComponentId(frame.document, mesh.bodyId) === joint.childComponentId).map(mesh => mesh.bodyId);
  return <ModalDialog label="Assembly motion" className="file-dialog model-dialog extrude-dialog" onDismiss={cancelComponentPlacement}><section aria-label="Assembly joint controls">
    <h3>Assembly motion</h3>
    <label>Joint<select value={id} onChange={event => { const next = frame.document.assemblyJoints!.find(item => item.id === event.target.value)!; setId(next.id); setValue(next.value); setDetach(false); }}>{frame.document.assemblyJoints!.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <p>{frame.document.components[joint.childComponentId].name} follows {frame.document.components[joint.parentComponentId].name} · {joint.type}</p>
    {joint.type !== "rigid" ? <><label>Motion ({joint.type === "hinge" ? "deg" : "mm"})<input type="range" min={joint.minimum} max={joint.maximum} step="0.5" value={value} disabled={detach} onChange={event => setValue(Number(event.target.value))} /></label><label>Exact motion<CommitInput value={String(value)} onCommit={text => { const next = text.trim() ? Number(text) : NaN; if (!Number.isFinite(next) || next < joint.minimum || next > joint.maximum) { setError(`Enter motion between ${joint.minimum} and ${joint.maximum}.`); return; } setValue(next); setError(""); }} /></label></> : <p>Rigid joint: no relative motion.</p>}
    <label><input type="checkbox" checked={detach} onChange={event => setDetach(event.target.checked)} />Detach joint and keep current position</label>
    <ComponentPlacementControls meshes={result.meshes} meshPlacement={placed} placement={placed} bodyIds={bodyIds} disabled onChange={() => {}} onDragging={() => {}} />
    <p role="status">{busy ? "Checking native motion and collisions…" : preview ? preview.result.assemblyCollisionStatus === "incomplete" ? "Collision analysis incomplete. Review diagnostics; clearance is not verified." : `${preview.result.assemblyCollisions?.length ?? 0} native collision pairs. Colliding bodies are orange.` : "Waiting for native preview."}</p>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={!current || busy || !preview || preview.document !== candidate || Boolean(error) || (!detach && value === joint.value)} onClick={() => { if (preview) try { applyAssemblyPreview(preview); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Apply joint motion</button>
    <button type="button" onClick={cancelComponentPlacement}>Cancel motion</button>
    <p>Motion checks this position; it does not simulate a swept collision path. Hinges rotate about the selected parent face origin and normal.</p>
  </section></ModalDialog>;
}
