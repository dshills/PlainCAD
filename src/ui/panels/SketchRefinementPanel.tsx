import { canReviewAiSketchCanvasPreview, clearAiSketchCanvasPreview, publishAiSketchCanvasPreview, useAiSketchCanvasPreview } from "../commands/aiSketchCanvasPreview";
import { ProviderSketchRefinementPanel } from "./ProviderSketchRefinementPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildSketchRefinement, type SketchRefinement } from "../../ai/sketchRefinement";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { applySketchRefinement, previewSketchRefinement, captureSketchRefinementFrame,
  currentSketchRefinementFrame, useSketchRefinement, type SketchRefinementFrame } from "../commands/sketchRefinementCommand";

interface Proposal { frame: SketchRefinementFrame; plan: SketchRefinement; result: RebuildResult; native: boolean; volume: number; solved: ResolvedSketch }
export function SketchRefinementPanel() {
  const canvasProposal = useAiSketchCanvasPreview(state => state.proposal);
  const document = useCadStore((s) => s.history.present);
  const session = useCadStore((s) => s.documentSession);
  const component = useCadStore((s) => s.activeComponentId);
  const busyFile = useCadStore((s) => s.fileBusy);
  const kernelReady = useCadStore((s) => s.rebuild.kernelReady);
  const active = useSketchCanvas((s) => s.active);
  const selection = useSketchCanvas((s) => s.selection);
  const providerCancel = useRef<(() => void) | undefined>(undefined);
  const registerProviderCancel = useCallback((action: (() => void) | undefined) => { providerCancel.current = action; }, []);
  const [mode, setMode] = useState<"local" | "provider">("local");
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Describe a rectangle size or selected-line relation. These bounded edits run locally without a provider request.");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const request = useRef<SketchRefinementFrame | undefined>(undefined);
  const cancel = (message = "Refinement canceled. The project is unchanged.") => {
    controller.current?.abort(); controller.current = undefined; if (request.current) clearAiSketchCanvasPreview(request.current); request.current = undefined;
    useSketchRefinement.setState({ frame: undefined }); setBusy(false); setProposal(undefined); setStatus(message);
  };
  useEffect(() => {
    if (request.current && !currentSketchRefinementFrame(request.current))
      cancel("Project, sketch or selection changed. Preview the current sketch again.");
  }, [document, session, component, busyFile, active, selection]);
  useEffect(() => () => { controller.current?.abort(); controller.current = undefined; if (request.current) clearAiSketchCanvasPreview(request.current); request.current = undefined; useSketchRefinement.setState({ frame: undefined }); }, []);
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
      if (!publishAiSketchCanvasPreview(frame, geometry.solved)) {
        cancel("Preview unavailable. The project is unchanged.");
        setError("The AI canvas context changed. Open AI and preview the current sketch again.");
        return;
      }
      setProposal({ frame, plan, result, ...geometry });
      setStatus(geometry.native ? "Native refinement preview ready. Review cyan changes on the drawing canvas, then Apply." : `Sketch refinement preview ready: successful solve, ${plan.profileCount} closed profile(s). No solid was modeled.`);
    } catch (failure) {
      if (abort && controller.current !== abort) return;
      setError(abort?.signal.aborted ? "Refinement timed out. Try a simpler sketch." : failure instanceof Error ? failure.message : "Sketch refinement failed.");
      setStatus("The project is unchanged."); request.current = undefined; useSketchRefinement.setState({ frame: undefined });
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!abort || controller.current === abort) { controller.current = undefined; setBusy(false); }
    }
  };
  const reviewable = proposal && canvasProposal?.frame === proposal.frame && canReviewAiSketchCanvasPreview(proposal.frame, proposal.solved);
  const modeChoice = <label>Sketch refinement method<select value={mode} onChange={(event) => { cancel(); setError(""); setMode(event.target.value as "local" | "provider"); }}>
    <option value="local">Local edits · no provider request</option>
    <option value="provider">Conversational AI provider</option>
  </select></label>;
  if (mode === "provider") return <div id="ai-drawer-content" aria-label="Sketch refinement" onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation(); providerCancel.current?.();
    }
  }}>{modeChoice}<ProviderSketchRefinementPanel onCancelReady={registerProviderCancel} /></div>;
  return <div id="ai-drawer-content" className="ai-drawer-content" aria-label="Sketch refinement" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); setError(""); }
  }}>
    <div className="ai-composer">
      {modeChoice}
      <h3>Refine your sketch</h3>
      <label>Sketch refinement request<textarea value={prompt} maxLength={1000} rows={3}
        placeholder="Make this rectangle 60 x 40 mm"
        onChange={(event) => { cancel("Request changed. Preview before Apply."); setError(""); setPrompt(event.target.value); }}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void preview(); } }} /></label>
      <p>Select one rectangle’s edges if there are multiple regions. For horizontal/vertical relations, select only the lines to change.</p>
      <p>Existing parameter bindings are preserved. Unsupported or conflicting requests produce a diagnostic; no provider request is sent.</p>
      <button type="button" disabled={busy || busyFile || !kernelReady || !prompt.trim()} onClick={() => void preview()}>Preview sketch refinement</button>
      <button type="button" onClick={() => { cancel(); setError(""); }}>Cancel refinement</button>
      <button type="button" disabled={!proposal || busy || canvasProposal?.frame !== proposal.frame || !canReviewAiSketchCanvasPreview(proposal.frame, proposal.solved)} onClick={() => {
        if (!proposal) return;
        try { if (!canReviewAiSketchCanvasPreview(proposal.frame, proposal.solved)) throw new Error("The canvas proposal is no longer available. Generate a fresh preview."); applySketchRefinement(proposal.frame, proposal.plan, proposal.result); cancel("Refinement applied in one undo step. Continue drawing or finish the sketch."); setError(""); }
        catch (failure) { cancel(); setError(failure instanceof Error ? failure.message : "Refinement could not be applied."); }
      }}>Apply sketch refinement</button>
    </div>
    <div className="ai-result">
      <p role="status" aria-label="Sketch refinement status">{proposal && !reviewable ? "The canvas proposal is no longer current. Generate a fresh sketch preview." : status}</p>
      {error ? <p role="alert">{error}</p> : null}
      {reviewable ? <><ul aria-label="Proposed sketch changes">{proposal.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul>
        {proposal.native ? <><p>{proposal.result.meshes.length} native bodies · {proposal.volume.toFixed(3)} mm³</p></> : <p>Review the proposed dimensions and relations on the drawing canvas. Apply updates the sketch; it does not create a solid.</p>}</> : null}
    </div>
  </div>;
}
