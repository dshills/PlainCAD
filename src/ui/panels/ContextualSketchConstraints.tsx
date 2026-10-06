import { useEffect, useMemo, useRef, useState } from "react";
import { contextualConstraintOptions, buildContextualConstraint, sketchConstraintStatus, type ContextualConstraintPlan, type ContextualConstraintType } from "../../cad/sketch/contextualConstraints";
import { useCadStore } from "../../state/useCadStore";
import { canvasContext, selectedCanvasEntities, useSketchCanvas } from "../commands/sketchCanvasCommand";
import { captureContextualConstraintFrame, currentContextualConstraintFrame, previewContextualConstraint, applyContextualConstraint, useContextualConstraintDraft, type ContextualConstraintFrame } from "../commands/contextualConstraintCommand";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import { SketchRefinementPreview } from "./SketchRefinementPreview";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";

const PREVIEW_TIMEOUT_MS = 120000;
interface Proposal { frame: ContextualConstraintFrame; plan: ContextualConstraintPlan; result: RebuildResult; solved: ResolvedSketch; native: boolean; volume: number; }
export function ContextualSketchConstraints() {
  const cadDocument = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const component = useCadStore((state) => state.activeComponentId);
  const fileBusy = useCadStore((state) => state.fileBusy);
  const kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const rebuild = useCadStore((state) => state.rebuild);
  const active = useSketchCanvas((state) => state.active);
  const selection = useSketchCanvas((state) => state.selection);
  const selected = useMemo(() => selectedCanvasEntities(), [cadDocument, session, component, fileBusy, active, selection]);
  const { context, unavailable } = useMemo(() => {
    try { return { context: active ? canvasContext(active, undefined, true) : undefined, unavailable: "" }; }
    catch (failure) { return { context: undefined, unavailable: failure instanceof Error ? failure.message : "Sketch context is unavailable. Repair the sketch first." }; }
  }, [cadDocument, session, component, fileBusy, active, rebuild]);
  const needsRepair = Boolean(unavailable || context?.solved.errors.some((diagnostic) => diagnostic.severity === "error"));
  const options = useMemo(() => selected ? contextualConstraintOptions(selected.sketch, selected.entityIds) : [], [selected]);
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Select geometry, choose a relation, and review its preview before Apply.");
  const [error, setError] = useState("");
  const previewTrigger = useRef<HTMLButtonElement | undefined>(undefined);
  const restoreFocus = () => window.requestAnimationFrame(() => {
    if (previewTrigger.current?.isConnected) previewTrigger.current.focus();
    else window.document.querySelector<HTMLButtonElement>('button[aria-label="Draw tool: select"]')?.focus();
  });
  const controller = useRef<AbortController | undefined>(undefined);
  const request = useRef<ContextualConstraintFrame | undefined>(undefined);
  const cancel = (message = "Constraint preview canceled. The sketch is unchanged.") => {
    controller.current?.abort(); controller.current = undefined; request.current = undefined;
    useContextualConstraintDraft.setState({ frame: undefined }); setBusy(false); setProposal(undefined); setStatus(message);
  };
  useEffect(() => {
    if (request.current && !currentContextualConstraintFrame(request.current)) cancel("Project, sketch or selection changed. Preview the current geometry again.");
  }, [cadDocument, session, component, fileBusy, active, selection, rebuild]);
  useEffect(() => () => { controller.current?.abort(); controller.current = undefined; request.current = undefined; useContextualConstraintDraft.setState({ frame: undefined }); }, []);
  const preview = async (type: ContextualConstraintType, trigger: HTMLButtonElement) => {
    previewTrigger.current = trigger;
    if (busy || !kernelReady || fileBusy) return;
    cancel(); setError("");
    let abort: AbortController | undefined;
    let timer: number | undefined;
    try {
      window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
      const frame = captureContextualConstraintFrame();
      const plan = buildContextualConstraint(frame.document, frame.active.sketchId, frame.selectedIds, type);
      request.current = frame; useContextualConstraintDraft.setState({ frame });
      abort = new AbortController(); controller.current = abort;
      timer = window.setTimeout(() => abort?.abort(), PREVIEW_TIMEOUT_MS);
      setBusy(true); setStatus("Solving the relation and checking downstream geometry…");
      const { result, ...geometry } = await previewContextualConstraint(plan, abort.signal);
      if (controller.current !== abort) return;
      if (!currentContextualConstraintFrame(frame)) { cancel("Selection changed. Preview again."); return; }
      setProposal({ frame, plan, result, ...geometry });
      setStatus(geometry.native ? "Native constraint preview ready. Review geometry, then Apply." : "Sketch constraint preview ready. No solid was modeled.");
    } catch (failure) {
      if (abort && controller.current !== abort) return;
      const timedOut = abort?.signal.aborted === true;
      cancel("The sketch is unchanged.");
      setError(timedOut ? "Constraint preview timed out. Try a simpler sketch." : failure instanceof Error ? failure.message : "Constraint preview failed.");
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!abort || controller.current === abort) { controller.current = undefined; setBusy(false); }
    }
  };
  return <section className="contextual-sketch-constraints" aria-label="Selected geometry relations" onKeyDown={(event) => {
    if (event.key === "Escape" && (busy || proposal)) { event.preventDefault(); event.stopPropagation(); cancel(); restoreFocus(); setError(""); }
  }}>
    <h3>Constrain selected geometry</h3>
    {unavailable ? <p role="status" aria-label="Sketch relations unavailable">Relations unavailable: {unavailable}</p> : null}
    {context ? <p aria-label="Current sketch constraint state">{context.pending && !needsRepair ? "Waiting for the current sketch solve." : sketchConstraintStatus(context.solved)}</p> : null}
    {!options.length ? <p>Select one or more lines for orientation; two lines for Parallel or Perpendicular; two points for Coincident; or a line and circle/arc, or two circles/arcs, for Tangent. At most 32 selected items.</p> : <div className="canvas-toolbar" aria-label="Available sketch relations">{options.map((option) => <button type="button" key={option.type} disabled={busy || fileBusy || !kernelReady || needsRepair} onClick={(event) => void preview(option.type, event.currentTarget)}>Preview {option.label}</button>)}</div>}
    <p role="status" aria-label="Constraint preview status">{status}</p>
    {error ? <p role="alert">{error}</p> : null}
    {proposal ? <><ul>{proposal.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul><p>{sketchConstraintStatus(proposal.solved)}</p><SketchRefinementPreview solved={proposal.solved} />{proposal.native ? <><ExtrudePreview meshes={proposal.result.meshes} label="Native constraint preview" /><p>{proposal.result.meshes.length} native bodies · {proposal.volume.toFixed(3)} mm³</p></> : null}</> : null}
    {busy || proposal ? <div className="canvas-toolbar"><button type="button" disabled={busy || !proposal || !currentContextualConstraintFrame(proposal.frame)} onClick={() => {
      if (!proposal) return;
      try { applyContextualConstraint(proposal.frame, proposal.plan, proposal.result); cancel("Relation applied in one undo step. Continue drawing."); restoreFocus(); setError(""); }
      catch (failure) { cancel("The relation was not applied. The sketch is unchanged."); restoreFocus(); setError(failure instanceof Error ? failure.message : "Relation could not be applied."); }
    }}>Apply relation</button><button type="button" onClick={() => { cancel(); restoreFocus(); setError(""); }}>Cancel relation</button></div> : null}
  </section>;
}
