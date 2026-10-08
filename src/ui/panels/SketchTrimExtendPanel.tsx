import { useLocalTaskPreview } from "./useLocalTaskPreview";
import { useEffect, useRef, useState } from "react";
import { buildSketchTrimExtend, type SketchTrimExtendPlan } from "../../cad/sketch/trimExtend";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { applySketchTrimExtend, cancelSketchTrimExtend, currentSketchTrimExtendFrame, previewSketchTrimExtend,
  setSketchTrimExtendPick, useSketchTrimExtend, type SketchTrimExtendFrame } from "../commands/sketchTrimExtendCommand";
import { SketchRefinementPreview } from "./SketchRefinementPreview";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import "./SketchTrimExtendPanel.css";

interface Proposal { frame: SketchTrimExtendFrame; plan: SketchTrimExtendPlan; result: RebuildResult; solved: ResolvedSketch }
export function SketchTrimExtendPanel() {
  const frame = useSketchTrimExtend((state) => state.frame);
  const mode = useSketchTrimExtend((state) => state.mode);
  const pick = useSketchTrimExtend((state) => state.pick);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const component = useCadStore((state) => state.activeComponentId);
  const fileBusy = useCadStore((state) => state.fileBusy);
  const kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const active = useSketchCanvas((state) => state.active);
  const [lineId, setLineId] = useState(frame?.lineId ?? "");
  const [x, setX] = useState(""), [y, setY] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const [detailsOpen, setDetailsOpen] = useState(!pick), previousPick = useRef(pick);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [status, setStatus] = useState("Choose a curve, then click the segment to trim or the endpoint side to extend.");
  const restoreFocus = (applied = false) => window.requestAnimationFrame(() => {
    const label = applied ? "Draw tool: select" : mode === "trim" ? "Trim sketch lines" : "Extend sketch lines";
    window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();
  });
  const controller = useRef<AbortController | undefined>(undefined);
  const invalidate = () => { controller.current?.abort(); controller.current = undefined; setBusy(false); setProposal(undefined); setStatus("Inputs changed. Preview updates automatically after you pause."); };
  useEffect(() => {
    invalidate(); setError(""); setLineId(frame?.lineId ?? "");
    const currentPick = useSketchTrimExtend.getState().pick;
    previousPick.current = currentPick; setDetailsOpen(!currentPick);
    setX(currentPick ? String(currentPick.x) : ""); setY(currentPick ? String(currentPick.y) : "");
    setStatus("Choose a curve, then click the segment to trim or the endpoint side to extend.");
  }, [frame, mode]);
  useEffect(() => {
    if (pick && !previousPick.current) setDetailsOpen(false);
    previousPick.current = pick;
    if (pick) { invalidate(); setX(String(pick.x)); setY(String(pick.y)); setStatus("Pick updated. Preview updates automatically after you pause."); }
  }, [pick]);
  useEffect(() => {
    if (frame && !currentSketchTrimExtendFrame(frame)) { invalidate(); cancelSketchTrimExtend(); }
  }, [frame, document, session, component, fileBusy, active]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const sketch = frame?.document.sketches[frame.active.sketchId];
  const cancelScheduled = useLocalTaskPreview(frame, JSON.stringify([mode, lineId, x, y]), Boolean(frame && kernelReady && !fileBusy && lineId && x.trim() && y.trim()), () => void preview());
  const preview = async () => {
    cancelScheduled();
    if (!frame || !kernelReady || fileBusy) return;
    invalidate(); setError("");
    let abort: AbortController | undefined, timer: number | undefined;
    try {
      if (!currentSketchTrimExtendFrame(frame)) throw new Error("Project changed. Open Trim or Extend again.");
      if (!x.trim() || !y.trim()) throw new Error("Click the sketch or enter both pick coordinates in millimeters.");
      const pickX = Number(x), pickY = Number(y);
      if (!Number.isFinite(pickX) || !Number.isFinite(pickY)) throw new Error("Pick coordinates must be finite numbers in millimeters.");
      const plan = buildSketchTrimExtend(frame.document, frame.active.sketchId, lineId, mode, { x: pickX, y: pickY });
      abort = new AbortController(); controller.current = abort;
      timer = window.setTimeout(() => { if (controller.current !== abort) return; invalidate(); setError("Preview timed out. Try a simpler sketch."); setStatus("The project is unchanged."); }, 120000);
      setBusy(true); setStatus("Solving the edited sketch and checking downstream geometry…");
      const result = await previewSketchTrimExtend(plan, abort.signal);
      if (controller.current !== abort || !currentSketchTrimExtendFrame(frame)) return;
      setProposal({ frame, plan, ...result });
      setStatus(result.result.meshes.length ? "Native geometry preview ready. Review the change, then Apply." : "Sketch preview ready. No solid was modeled.");
    } catch (failure) {
      if (abort && controller.current !== abort) return;
      setError(failure instanceof Error ? failure.message : "Trim/extend failed.");
      setStatus("The project is unchanged.");
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!abort || controller.current === abort) { controller.current = undefined; setBusy(false); }
    }
  };
  if (!frame || !sketch) return null;
  return <section className="sketch-trim-extend" aria-label={mode === "trim" ? "Trim sketch lines" : "Extend sketch lines"} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); invalidate(); cancelSketchTrimExtend(); restoreFocus(); }
  }}>
    <h3>{mode === "trim" ? "Trim a curve segment" : "Extend a line or arc"}</h3>
    <p>{mode === "trim" ? "Choose a line, arc or circle, then click between its finite crossing contacts." : "Choose a line or arc and click nearer the endpoint to extend to the nearest finite boundary."}</p>
    <p>The pick is projected onto the line or radially onto the curve. Review the proposed result before Apply.</p>
    <label>Curve to edit<select aria-label="Line to edit" value={lineId} onChange={(event) => { invalidate(); setError(""); setLineId(event.target.value); }}>
      <option value="">Choose a curve</option>
      {Object.values(sketch.entities).filter((entity) => entity.type !== "point").map((curve, index) => <option key={curve.id} value={curve.id}>{curve.type[0].toUpperCase() + curve.type.slice(1)} {index + 1}{curve.construction ? " (construction)" : ""}</option>)}
    </select></label>
    {pick ? <p>Canvas pick: {x}, {y} mm. Edit precise coordinates in Details.</p> : null}
    <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary>Details · exact pick coordinates</summary>
    <div className="sketch-trim-extend-pick">
      <label>Pick X (mm)<input type="number" value={x} onChange={(event) => { invalidate(); setX(event.target.value); }} /></label>
      <label>Pick Y (mm)<input type="number" value={y} onChange={(event) => { invalidate(); setY(event.target.value); }} /></label>
    </div></details>
    <button type="button" disabled={busy || !kernelReady || fileBusy || !lineId} onClick={() => void preview()}>Preview {mode}</button>
    <button type="button" disabled={!proposal || busy || !currentSketchTrimExtendFrame(frame)} onClick={() => {
      if (!proposal) return;
      try { applySketchTrimExtend(proposal.frame, proposal.plan, proposal.result); restoreFocus(true); }
      catch (failure) { invalidate(); setError(failure instanceof Error ? failure.message : "Could not apply the edit."); }
    }}>Apply {mode}</button>
    <button type="button" onClick={() => { invalidate(); cancelSketchTrimExtend(); restoreFocus(); }}>Cancel {mode}</button>
    <p role="status" aria-label="Trim extend status">{status}</p>
    {error ? <p role="alert">{error}</p> : null}
    {proposal ? <><ul aria-label="Proposed trim extend changes">{proposal.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul>
      <SketchRefinementPreview solved={proposal.solved} />
      {proposal.result.meshes.length ? <ExtrudePreview meshes={proposal.result.meshes} label="Native trim extend preview" /> : null}</> : null}
    <p>Finite line, arc and circle boundaries. Circles can be trimmed into arcs; circles have no endpoints to extend. Tangencies, coincident supports and protected design intent produce diagnostics.</p>
    {pick ? <button type="button" onClick={() => setSketchTrimExtendPick({ ...pick })}>Use canvas pick again</button> : null}
  </section>;
}
