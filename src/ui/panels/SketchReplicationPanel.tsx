import { useEffect, useRef, useState } from "react";
import { buildSketchReplication, MAX_SKETCH_REPLICATION_COUNT, type SketchReplicationInput, type SketchReplicationPlan } from "../../cad/sketch/sketchReplication";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { useSketchReplication, currentSketchReplicationFrame, cancelSketchReplication, previewSketchReplication, applySketchReplication, subscribeSketchReplicationEnvironment, type SketchReplicationFrame } from "../commands/sketchReplicationCommand";
import { SketchRefinementPreview } from "./SketchRefinementPreview";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";

interface Proposal { frame: SketchReplicationFrame; plan: SketchReplicationPlan; result: RebuildResult; solved: ResolvedSketch; native: boolean; volume: number; }
const PREVIEW_TIMEOUT_MS = 120000;
export function SketchReplicationPanel() {
  const { frame, mode } = useSketchReplication();
  const cadDocument = useCadStore((state) => state.history.present), session = useCadStore((state) => state.documentSession), component = useCadStore((state) => state.activeComponentId), fileBusy = useCadStore((state) => state.fileBusy), kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const active = useSketchCanvas((state) => state.active), selection = useSketchCanvas((state) => state.selection);
  const [axisLineId, setAxisLineId] = useState(""), [count, setCount] = useState("3"), [spacing, setSpacing] = useState("10mm"), [direction, setDirection] = useState<"X" | "Y" | "vector">("X"), [vectorX, setVectorX] = useState("1"), [vectorY, setVectorY] = useState("0");
  const [proposal, setProposal] = useState<Proposal>(), [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("Choose inputs, then preview before Apply.");
  const controller = useRef<AbortController | undefined>(undefined);
  const invalidate = () => { controller.current?.abort(); controller.current = undefined; setBusy(false); setProposal(undefined); setStatus("Inputs changed. Preview before Apply."); };
  const restoreFocus = (applied = false) => window.requestAnimationFrame(() => {
    if (useSketchCanvas.getState().active !== frame?.active || window.document.querySelector("dialog[open]")) return;
    const label = applied ? "Draw tool: select" : mode === "mirror" ? "Mirror selected sketch geometry" : "Linear pattern selected sketch geometry";
    window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();
  });
  useEffect(() => {
    invalidate(); setError("");
    const sketch = frame?.document.sketches[frame.active.sketchId];
    const selectedAxis = frame?.selectedIds.find((id) => sketch?.entities[id]?.type === "line" && sketch.entities[id].construction);
    const fallback = Object.values(sketch?.entities ?? {}).find((entity) => entity.type === "line" && entity.construction);
    setAxisLineId(selectedAxis ?? fallback?.id ?? "");
  }, [frame, mode]);
  useEffect(() => { if (frame && !currentSketchReplicationFrame(frame)) { invalidate(); cancelSketchReplication(); } }, [frame, cadDocument, session, component, fileBusy, active, selection]);
  useEffect(() => subscribeSketchReplicationEnvironment(() => { if (frame && !currentSketchReplicationFrame(frame)) { invalidate(); cancelSketchReplication(); } }), [frame]);
  useEffect(() => () => { controller.current?.abort(); controller.current = undefined; }, []);
  if (!frame) return null;
  const sketch = frame.document.sketches[frame.active.sketchId];
  const preview = async () => {
    invalidate(); setError("");
    let abort: AbortController | undefined, timer: number | undefined;
    try {
      if (!currentSketchReplicationFrame(frame)) throw new Error("Project changed. Select current geometry and open a new copy task.");
      const input: SketchReplicationInput = mode === "mirror" ? { mode, axisLineId } : { mode, count: Number(count), spacing, direction, vector: { x: Number(vectorX), y: Number(vectorY) } };
      const plan = buildSketchReplication(frame.document, frame.active.sketchId, frame.selectedIds, input);
      abort = new AbortController(); controller.current = abort; timer = window.setTimeout(() => abort?.abort(), PREVIEW_TIMEOUT_MS);
      setBusy(true); setStatus("Solving copies and checking downstream geometry…");
      const geometry = await previewSketchReplication(frame, plan, abort.signal);
      if (controller.current !== abort || !currentSketchReplicationFrame(frame)) return;
      setProposal({ frame, plan, ...geometry }); setStatus(geometry.native ? "Native copy preview ready. Review geometry and dimensions, then Apply." : "Sketch copy preview ready. No solid was modeled.");
    } catch (failure) {
      if (abort && controller.current !== abort) return;
      setError(abort?.signal.aborted ? "Copy preview timed out. Reduce count or simplify the sketch." : failure instanceof Error ? failure.message : "Sketch copying failed."); setStatus("The project is unchanged.");
    } finally { if (timer !== undefined) window.clearTimeout(timer); if (!abort || controller.current === abort) { controller.current = undefined; setBusy(false); } }
  };
  const change = (action: () => void) => { invalidate(); setError(""); action(); };
  const close = () => { invalidate(); cancelSketchReplication(); restoreFocus(); };
  return <section aria-label={mode === "mirror" ? "Mirror sketch geometry" : "Linear sketch pattern"} className="canvas-constraint-controls" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <h3>{mode === "mirror" ? "Mirror selected geometry" : "Pattern selected geometry"}</h3>
    <p>{frame.selectedIds.length} selected items. Referenced endpoints and centers are copied with new IDs. Select every reference of any dimension or constraint touching this selection.</p>
    {mode === "mirror" ? <label>Mirror axis<select value={axisLineId} onChange={(event) => change(() => setAxisLineId(event.target.value))}><option value="">Choose a line</option>{Object.values(sketch.entities).filter((entity) => entity.type === "line").map((entity, index) => <option key={entity.id} value={entity.id}>Line {index + 1}{entity.construction ? " (construction)" : ""}</option>)}</select></label> : <><label>Total instance count (including source)<input type="number" min={2} max={MAX_SKETCH_REPLICATION_COUNT} step={1} value={count} onChange={(event) => change(() => setCount(event.target.value))} /></label><label>Pattern spacing<input value={spacing} maxLength={120} onChange={(event) => change(() => setSpacing(event.target.value))} /></label><label>Pattern direction<select value={direction} onChange={(event) => change(() => setDirection(event.target.value as "X" | "Y" | "vector"))}><option value="X">X axis</option><option value="Y">Y axis</option><option value="vector">Custom vector</option></select></label>{direction === "vector" ? <><label>Direction X<input type="number" value={vectorX} onChange={(event) => change(() => setVectorX(event.target.value))} /></label><label>Direction Y<input type="number" value={vectorY} onChange={(event) => change(() => setVectorY(event.target.value))} /></label></> : null}</>}
    <p>Creation-time copies, not an associative pattern feature. Count and the mirror axis are not stored as editable pattern settings. Shared parameter bindings remain shared; copied geometry and dimensions can be edited separately.</p>
    <div className="canvas-toolbar"><button type="button" disabled={busy || fileBusy || !kernelReady} onClick={() => void preview()}>Preview copies</button><button type="button" onClick={close}>Cancel copies</button><button type="button" disabled={busy || !proposal || !currentSketchReplicationFrame(frame)} onClick={() => {
      if (!proposal) return;
      try { applySketchReplication(frame, proposal.plan, proposal.result); restoreFocus(true); }
      catch (failure) { invalidate(); setError(failure instanceof Error ? failure.message : "Copies could not be applied."); }
    }}>Apply copies</button></div>
    <p role="status" aria-label="Sketch copy status">{status}</p>{error ? <p role="alert">{error}</p> : null}
    {proposal ? <><ul aria-label="Proposed sketch copies">{proposal.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul><SketchRefinementPreview solved={proposal.solved} />{proposal.native ? <><ExtrudePreview meshes={proposal.result.meshes} label="Native sketch copy preview" /><p>{proposal.volume.toFixed(3)} mm³</p></> : null}</> : null}
  </section>;
}
