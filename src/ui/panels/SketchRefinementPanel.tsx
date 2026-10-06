import { SketchRefinementPreview } from "./SketchRefinementPreview";
import { useEffect, useRef, useState } from "react";
import { buildSketchRefinement, type SketchRefinement } from "../../ai/sketchRefinement";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { applySketchRefinement, previewSketchRefinement, captureSketchRefinementFrame,
  currentSketchRefinementFrame, useSketchRefinement, type SketchRefinementFrame } from "../commands/sketchRefinementCommand";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";

interface Proposal { frame: SketchRefinementFrame; plan: SketchRefinement; result: RebuildResult; native: boolean; volume: number; solved: ResolvedSketch }
export function SketchRefinementPanel() {
  const document = useCadStore((s) => s.history.present);
  const session = useCadStore((s) => s.documentSession);
  const component = useCadStore((s) => s.activeComponentId);
  const busyFile = useCadStore((s) => s.fileBusy);
  const kernelReady = useCadStore((s) => s.rebuild.kernelReady);
  const active = useSketchCanvas((s) => s.active);
  const selection = useSketchCanvas((s) => s.selection);
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Describe a rectangle size or selected-line relation. These bounded edits run locally without a provider request.");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const request = useRef<SketchRefinementFrame | undefined>(undefined);
  const cancel = (message = "Refinement canceled. The project is unchanged.") => {
    controller.current?.abort(); controller.current = undefined; request.current = undefined;
    useSketchRefinement.setState({ frame: undefined }); setBusy(false); setProposal(undefined); setStatus(message);
  };
  useEffect(() => {
    if (request.current && !currentSketchRefinementFrame(request.current))
      cancel("Project, sketch or selection changed. Preview the current sketch again.");
  }, [document, session, component, busyFile, active, selection]);
  useEffect(() => () => { controller.current?.abort(); controller.current = undefined; request.current = undefined; useSketchRefinement.setState({ frame: undefined }); }, []);
  const preview = async () => {
    if (busy || !kernelReady || busyFile || !prompt.trim()) return;
    cancel(); setError("");
    let abort: AbortController | undefined;
    let timer: number | undefined;
    try {
      window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
      const frame = captureSketchRefinementFrame();
      const plan = buildSketchRefinement(frame.document, frame.active.sketchId, frame.selectedIds, prompt);
      request.current = frame; useSketchRefinement.setState({ frame });
      abort = new AbortController(); controller.current = abort;
      timer = window.setTimeout(() => abort?.abort(), 120000);
      setBusy(true); setStatus("Solving sketch and checking downstream native geometry…");
      const { result, ...geometry } = await previewSketchRefinement(plan, abort.signal);
      if (controller.current !== abort) return;
      if (abort.signal.aborted) {
        cancel("The project is unchanged.");
        setError("Refinement timed out. Try a simpler sketch.");
        return;
      }
      if (!currentSketchRefinementFrame(frame)) {
        cancel("Project, sketch or selection changed. Preview the current sketch again.");
        return;
      }
      setProposal({ frame, plan, result, ...geometry });
      setStatus(geometry.native ? "Native refinement preview ready. Review changes, then Apply." : `Sketch refinement preview ready: successful solve, ${plan.profileCount} closed profile(s). No solid was modeled.`);
    } catch (failure) {
      if (abort && controller.current !== abort) return;
      setError(abort?.signal.aborted ? "Refinement timed out. Try a simpler sketch." : failure instanceof Error ? failure.message : "Sketch refinement failed.");
      setStatus("The project is unchanged."); request.current = undefined; useSketchRefinement.setState({ frame: undefined });
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!abort || controller.current === abort) { controller.current = undefined; setBusy(false); }
    }
  };
  return <div id="ai-drawer-content" className="ai-drawer-content" aria-label="Sketch refinement" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); setError(""); }
  }}>
    <div className="ai-composer">
      <h3>Refine your sketch</h3>
      <label>Sketch refinement request<textarea value={prompt} maxLength={1000} rows={3}
        placeholder="Make this rectangle 60 x 40 mm"
        onChange={(event) => { cancel("Request changed. Preview before Apply."); setError(""); setPrompt(event.target.value); }}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void preview(); } }} /></label>
      <p>Select one rectangle’s edges if there are multiple regions. For horizontal/vertical relations, select only the lines to change.</p>
      <p>Existing parameter bindings are preserved. Unsupported or conflicting requests produce a diagnostic; no provider request is sent.</p>
      <button type="button" disabled={busy || busyFile || !kernelReady || !prompt.trim()} onClick={() => void preview()}>Preview sketch refinement</button>
      <button type="button" onClick={() => { cancel(); setError(""); }}>Cancel refinement</button>
      <button type="button" disabled={!proposal || busy || !currentSketchRefinementFrame(proposal.frame)} onClick={() => {
        if (!proposal) return;
        try { applySketchRefinement(proposal.frame, proposal.plan, proposal.result); cancel("Refinement applied in one undo step. Continue drawing or finish the sketch."); setError(""); }
        catch (failure) { cancel(); setError(failure instanceof Error ? failure.message : "Refinement could not be applied."); }
      }}>Apply sketch refinement</button>
    </div>
    <div className="ai-result">
      <p role="status" aria-label="Sketch refinement status">{status}</p>
      {error ? <p role="alert">{error}</p> : null}
      {proposal ? <><ul aria-label="Proposed sketch changes">{proposal.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul>
        <SketchRefinementPreview solved={proposal.solved} />
        {proposal.native ? <><ExtrudePreview meshes={proposal.result.meshes} label="Native sketch refinement preview" /><p>{proposal.result.meshes.length} native bodies · {proposal.volume.toFixed(3)} mm³</p></> : <p>Review the proposed dimensions and relations above. Apply updates the sketch; it does not create a solid.</p>}</> : null}
    </div>
  </div>;
}
