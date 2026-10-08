import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { nativeTaskReady } from "../commands/nativeTaskAvailability";
import { cancelDrawing, captureDrawingFrame, currentDrawingFrame, currentDrawingSession, downloadShopDrawing, previewShopDrawing, useShopDrawing, type DrawingPreview } from "../commands/shopDrawingCommand";
import type { DrawingSession } from "../commands/shopDrawingState";
import "./ShopDrawingPanel.css";
export function ShopDrawingPanel() { const owner = useShopDrawing(state => state.frame); return owner ? <DrawingDialog key={owner.session} owner={owner} /> : null; }
function DrawingDialog({ owner }: { owner: DrawingSession }) {
  const document = useCadStore(state => state.history.present), result = useCadStore(state => state.rebuild.result), ready = useCadStore(state => currentDrawingSession(owner) && nativeTaskReady(state, "drawing"));
  const [bodyId, setBodyId] = useState(owner.bodyId), [height, setHeight] = useState(""), [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<DrawingPreview>(), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    setPreview(undefined); setError(""); setBusy(false);
    if (!currentDrawingSession(owner)) { setMessage("Project replaced. Close and reopen shop drawing."); return; }
    if (!ready) { setMessage("Waiting for current native geometry…"); return; }
    let frame; try { frame = captureDrawingFrame(owner, bodyId, height.trim() ? Number(height) : undefined); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return; }
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage("Preparing native drawing…");
    const timer = window.setTimeout(() => void previewShopDrawing(frame, controller.signal, value => { if (!controller.signal.aborted) setMessage(value); }).then(value => { if (!controller.signal.aborted) { setPreview(value); setMessage("Native drawing ready"); } }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (active.current === controller) { active.current = undefined; setBusy(false); } }), 200);
    return () => { window.clearTimeout(timer); controller.abort(); if (active.current === controller) active.current = undefined; };
  }, [owner, document, result, ready, bodyId, height, revision]);
  const proven = preview && currentDrawingFrame(preview.frame) && preview.frame.bodyId === bodyId && preview.frame.sectionHeight === (height.trim() ? Number(height) : undefined) ? preview : undefined;
  const labels = result ? bodyDisplayNames(document, result.bodies) : {};
  const download = (kind: "svg" | "csv") => { try { if (proven) downloadShopDrawing(proven, kind); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } };
  return <ModalDialog label="Shop drawing" className="file-dialog drawing-dialog" onDismiss={cancelDrawing}><section>
    <h2>Shop drawing</h2><p>Native dimensions and bore callouts with tessellated orthographic/section illustrations. Regenerates when the project changes.</p>
    <div className="drawing-controls"><label>Drawing part<select value={bodyId} disabled={!ready} onChange={event => setBodyId(event.target.value)}>{!result?.meshes.some(mesh => mesh.bodyId === bodyId) ? <option value={bodyId}>Lost source — select a current part</option> : null}{result?.meshes.map(mesh => <option key={mesh.bodyId} value={mesh.bodyId}>{labels[mesh.bodyId] ?? mesh.bodyId}</option>)}</select></label>
      <label>Section height (world Z, mm)<input type="number" value={height} placeholder="Automatic middle" disabled={!ready} onChange={event => setHeight(event.target.value)} /></label>
      <button type="button" disabled={!ready || busy} onClick={() => setRevision(value => value + 1)}>Regenerate drawing</button>
      <button type="button" disabled={!proven || busy || Boolean(error)} onClick={() => download("svg")}>Download drawing SVG</button>
      <button type="button" disabled={!proven || busy || Boolean(error)} onClick={() => download("csv")}>Download parts list CSV</button>
      <button type="button" onClick={cancelDrawing}>Close shop drawing</button>
    </div>
    <p role="status">{message}</p>{error ? <p role="alert">{error}</p> : null}
    {proven ? <><div className="drawing-preview" aria-label="Associative drawing preview" dangerouslySetInnerHTML={{ __html: proven.drawing.svg }} /><p>Section area: {proven.drawing.sectionAreaMm2.toFixed(3)} mm² · {proven.drawing.bom.length} current bodies in the parts list</p>{proven.drawing.warnings.map(warning => <p role="alert" key={warning}>{warning}</p>)}</> : null}
    <p>Views use world X/Y/Z and fit independently. Native dimensions describe overall bounds; bore lengths describe complete cylindrical walls. Outlines, hidden-edge visibility and sections are mesh approximations. Add tolerances, machining details and GD&amp;T separately.</p>
  </section></ModalDialog>;
}
