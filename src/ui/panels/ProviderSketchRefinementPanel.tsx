import { aiHistoryIntent, handleAiHistoryPrompt } from "../commands/aiHistoryPrompt";
import { canReviewAiSketchCanvasPreview, clearAiSketchCanvasPreview, publishAiSketchCanvasPreview, useAiSketchCanvasPreview } from "../commands/aiSketchCanvasPreview";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAiDrawer } from "../commands/aiCommand";
import { resolveAiFollowUp, type FailedAiRequest } from "../../ai/followUp";
import { fetchAiProviders } from "../../ai/client";
import { prepareAiSketchRequest, requestAiSketchProposal } from "../../ai/sketchAiClient";
import { aiSketchContext, buildAiSketchEdit, type AiSketchProposal, type SketchBindingPolicy } from "../../ai/sketchEditPlan";
import { AI_LIMITS, type AiProvider, type AiProviderStatus } from "../../ai/plan";
import type { AiMessage } from "../../ai/conversation";
import type { SketchRefinement } from "../../ai/sketchRefinement";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { applySketchRefinement, captureSketchRefinementFrame, currentSketchRefinementFrame,
  previewSketchRefinement, useSketchRefinement, type SketchRefinementFrame } from "../commands/sketchRefinementCommand";

interface Preview {
  frame: SketchRefinementFrame;
  plan: SketchRefinement;
  proposal: AiSketchProposal;
  result: RebuildResult;
  native: boolean;
  volume: number;
  solved: ResolvedSketch;
}
export function ProviderSketchRefinementPanel({ onCancelReady }: { onCancelReady?: (cancel: (() => void) | undefined) => void } = {}) {
  const assistantOpen = useAiDrawer(state => state.open);
  const canvasProposal = useAiSketchCanvasPreview(state => state.proposal);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const component = useCadStore((state) => state.activeComponentId);
  const fileBusy = useCadStore((state) => state.fileBusy);
  const kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const active = useSketchCanvas((state) => state.active);
  const selection = useSketchCanvas((state) => state.selection);
  const sharedFrame = useSketchRefinement((state) => state.frame);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [consent, setConsent] = useState(false);
  const [policy, setPolicy] = useState<SketchBindingPolicy>("preserve");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [answer, setAnswer] = useState<AiSketchProposal>();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Checking local provider configuration…");
  const controller = useRef<AbortController | undefined>(undefined);
  const ownedFrame = useRef<SketchRefinementFrame | undefined>(undefined);
  const consentFrame = useRef<SketchRefinementFrame | undefined>(undefined);
  const conversationFrame = useRef<SketchRefinementFrame | undefined>(undefined);
  const [lastFailure, setLastFailure] = useState<(FailedAiRequest & { frame: SketchRefinementFrame })>();
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const configuration = providers.find((item) => item.id === provider);
  const context = useMemo(() => {
    try {
      if (!active) throw new Error("Open a sketch before asking AI to edit it.");
      const frame = captureSketchRefinementFrame();
      return { value: aiSketchContext(frame.document, frame.active.sketchId, frame.selectedIds, policy), error: "" };
    } catch (failure) { return { value: undefined, error: failure instanceof Error ? failure.message : "Sketch context is unavailable." }; }
  }, [document, session, component, active, selection, fileBusy, policy]);
  const followUp = resolveAiFollowUp(prompt, lastFailure && currentSketchRefinementFrame(lastFailure.frame) ? lastFailure : undefined);
  const requestReview = useMemo(() => {
    if (!context.value || !configuration || !prompt.trim()) return { value: undefined, error: "" };
    try { return { value: prepareAiSketchRequest(provider, configuration.model, followUp.prompt, messages, context.value), error: "" }; }
    catch (failure) { return { value: undefined, error: failure instanceof Error ? failure.message : "Request exceeds its limits." }; }
  }, [context.value, configuration, provider, followUp.prompt, messages]);
  const release = () => {
    controller.current?.abort(); controller.current = undefined;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    if (ownedFrame.current && useSketchRefinement.getState().frame === ownedFrame.current)
      useSketchRefinement.setState({ frame: undefined });
    if (ownedFrame.current) clearAiSketchCanvasPreview(ownedFrame.current);
    ownedFrame.current = undefined;
  };
  const cancel = (message = "AI refinement canceled. The project is unchanged.") => {
    release(); setPreview(undefined); setBusy(false); setStatus(message);
  };
  const reset = () => {
    cancel("Conversation reset. The project is unchanged.");
    conversationFrame.current = undefined; setLastFailure(undefined); setMessages([]); setAnswer(undefined); setError("");
  };
  useEffect(() => {
    onCancelReady?.(() => { cancel(); setError(""); promptInput.current?.focus(); });
    return () => onCancelReady?.(undefined);
  }, [onCancelReady]);
  useEffect(() => {
    const abort = new AbortController();
    void fetchAiProviders(abort.signal).then((items) => {
      if (abort.signal.aborted) return;
      setProvidersLoaded(true); setProviders(items);
      setProvider(items.find((item) => item.available)?.id ?? "anthropic");
      setStatus(items.some((item) => item.available) ? "Choose a provider and explicitly allow sharing this sketch context." : "No AI provider is configured on the local server. Local refinement remains available.");
    }).catch((failure) => {
      if (abort.signal.aborted) return;
      setProvidersLoaded(true);
      setStatus("Provider configuration is unavailable. Local sketch refinement remains available.");
      setError(failure instanceof Error ? failure.message : "Provider configuration failed.");
    });
    return () => { abort.abort(); release(); };
  }, []);
  useEffect(() => {
    const sourceChanged = (!assistantOpen && Boolean(conversationFrame.current || consentFrame.current || lastFailure)) || (conversationFrame.current && !currentSketchRefinementFrame(conversationFrame.current)) ||
      (consentFrame.current && !currentSketchRefinementFrame(consentFrame.current));
    const draftChanged = ownedFrame.current && useSketchRefinement.getState().frame !== ownedFrame.current;
    if (sourceChanged || draftChanged) {
      reset(); consentFrame.current = undefined; setConsent(false);
      setStatus("Project, sketch or selection changed. Start a fresh conversation and allow sharing the current context.");
    }
  }, [document, session, component, active, selection, fileBusy, sharedFrame, assistantOpen]);
  const generate = async () => {
    if (busy || fileBusy) return;
    if (aiHistoryIntent(prompt)) {
      cancel(); setError("");
      const outcome = handleAiHistoryPrompt(prompt);
      setStatus(outcome?.message ?? "AI history is unavailable.");
      return;
    }
    if (followUp.clarification) { cancel(followUp.clarification); setError(""); setAnswer(undefined); return; }
    if (busy || fileBusy || !kernelReady || !consent || !consentFrame.current || !currentSketchRefinementFrame(consentFrame.current) || !configuration?.available || !prompt.trim() || !context.value || requestReview.error) return;
    cancel(); setError(""); setAnswer(undefined); setLastFailure(undefined);
    const abort = new AbortController(); controller.current = abort;
    timer.current = setTimeout(() => {
      if (controller.current !== abort) return;
      cancel("The project is unchanged."); setError("AI refinement timed out. Try a simpler request.");
    }, 120000);
    let capturedFrame: SketchRefinementFrame | undefined;
    try {
      window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
      const frame = captureSketchRefinementFrame();
      const captured = aiSketchContext(frame.document, frame.active.sketchId, frame.selectedIds, policy);
      if (frame.document !== document || frame.active !== active || frame.session !== session || frame.componentId !== component ||
          JSON.stringify(captured) !== JSON.stringify(context.value))
        throw new Error("The sketch context changed. Review its current data and allow sharing before trying again.");
      capturedFrame = frame; ownedFrame.current = frame; conversationFrame.current = frame;
      useSketchRefinement.setState({ frame }); setBusy(true);
      setStatus("Asking the selected provider for bounded sketch edits…");
      const proposal = await requestAiSketchProposal(provider, configuration.model, followUp.prompt, messages, captured, abort.signal);
      if (controller.current !== abort || abort.signal.aborted || !currentSketchRefinementFrame(frame) || useSketchRefinement.getState().frame !== frame) return;
      setLastFailure(undefined);
      setAnswer(proposal);
      setMessages([...messages, { role: "user", content: followUp.prompt }, { role: "assistant", content: JSON.stringify(proposal) }].slice(-AI_LIMITS.transcriptMessages) as AiMessage[]);
      if (!proposal.actions.length) {
        release(); setBusy(false); setStatus("AI needs clarification. Answer below; no edit has been proposed or applied.");
        return;
      }
      const plan = buildAiSketchEdit(frame.document, frame.active.sketchId, frame.selectedIds, proposal, policy);
      setStatus("Solving the proposed edits and validating downstream native geometry…");
      const geometry = await previewSketchRefinement(plan, abort.signal);
      if (controller.current !== abort || abort.signal.aborted || !currentSketchRefinementFrame(frame) || useSketchRefinement.getState().frame !== frame) return;
      if (!publishAiSketchCanvasPreview(frame, geometry.solved)) {
        cancel("Preview unavailable. The project is unchanged.");
        setError("The AI canvas context changed. Open AI and preview the current sketch again.");
        return;
      }
      setLastFailure(undefined);
      setPreview({ frame, plan, proposal, ...geometry }); setBusy(false);
      setStatus(geometry.native ? "Native AI sketch preview ready. Review cyan changes on the drawing canvas before Apply." : "Solved AI sketch preview ready. No solid was modeled; Apply changes only the sketch.");
      controller.current = undefined;
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
    } catch (failure) {
      if (controller.current !== abort) return;
      const diagnostic = failure instanceof Error ? failure.message : "AI sketch refinement failed.";
      if (capturedFrame && currentSketchRefinementFrame(capturedFrame)) setLastFailure({ frame: capturedFrame, prompt: followUp.prompt === prompt.trim() ? followUp.prompt : lastFailure?.prompt ?? followUp.prompt, diagnostic });
      cancel("The project is unchanged.");
      setError(diagnostic);
    }
  };
  const reviewable = preview && canvasProposal?.frame === preview.frame && canReviewAiSketchCanvasPreview(preview.frame, preview.solved);
  return <div className="ai-drawer-content" aria-label="Provider sketch refinement" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); setError(""); promptInput.current?.focus(); }
  }}>
    <div className="ai-composer">
      <h3>Ask AI to edit this sketch</h3>
      <label>Sketch AI provider<select value={provider} disabled={busy} onChange={(event) => { reset(); consentFrame.current = undefined; setConsent(false); setProvider(event.target.value as AiProvider); }}>
        {providers.length ? providers.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " · not configured"}</option>) : <option value="anthropic">{providersLoaded ? "Provider configuration unavailable" : "Checking providers…"}</option>}
      </select></label>
      {configuration ? <p className="muted">Configured model: {configuration.model}</p> : null}
      <label>AI sketch binding policy<select value={policy} disabled={busy} onChange={(event) => { reset(); consentFrame.current = undefined; setConsent(false); setPolicy(event.target.value as SketchBindingPolicy); }}>
        <option value="preserve">Preserve existing parameter bindings</option>
        <option value="replace">Explicitly replace sketch dimension expressions</option>
        {context.value?.parameters.map((parameter) => <option key={parameter.id} value={`parameter:${parameter.id}`} disabled={!parameter.editable}>Change shared parameter: {parameter.name}{parameter.editable ? "" : " · locked or derived"}</option>)}
      </select></label>
      <p>{policy === "replace" ? "AI may replace dimension formulas in this sketch. Existing project parameters remain intact." : policy.startsWith("parameter:") ? "Changing this shared parameter may rebuild other sketches and parts. Review the listed downstream effects before Apply." : "AI cannot replace bound dimension formulas or change shared parameters."}</p>
      <label><input type="checkbox" checked={consent} onChange={(event) => {
        cancel(); setError(""); consentFrame.current = undefined;
        if (!event.target.checked) { setConsent(false); return; }
        try {
          const source = captureSketchRefinementFrame();
          if (!context.value || source.document !== document || source.active !== active ||
              JSON.stringify(aiSketchContext(source.document, source.active.sketchId, source.selectedIds, policy)) !== JSON.stringify(context.value))
            throw new Error("The sketch context changed. Review its current data before allowing sharing.");
          consentFrame.current = source; setConsent(true);
        } catch (failure) { setConsent(false); setError(failure instanceof Error ? failure.message : "Sketch context is unavailable."); }
      }} />Allow sending this sketch's bounded geometry, selected IDs, dimensions, constraints and referenced parameter names/expressions to the selected AI provider</label>
      <p className="muted">The local server holds credentials. This sends one sketch context and recent conversation turns; it does not send the project file, bodies or meshes.</p>
      <details>
        <summary>Review data sent to the provider</summary>
        <p>One sketch in local millimeters, selected IDs, dimensions, constraints and only referenced parameters. Maximum total request: 32000 bytes. No project file, bodies, meshes or credentials.</p>
        {context.value ? <pre aria-label="Bounded sketch context" style={{ maxHeight: "240px", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(context.value, null, 2)}</pre> : null}
        {requestReview.value ? <><p>{requestReview.value.body.history.length} recent conversation messages will be sent; {requestReview.value.omittedTurns} older complete turn(s) omitted.</p>
          <pre aria-label="Sketch conversation data" style={{ maxHeight: "160px", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(requestReview.value.body.history, null, 2)}</pre></> : <p>Enter a request to review its conversation budget.</p>}
      </details>
      <label>Provider sketch request<textarea ref={promptInput} value={prompt} rows={3} maxLength={AI_LIMITS.promptCharacters} placeholder="Make these two selected lines perpendicular"
        onChange={(event) => { cancel("Request changed. Generate a fresh preview before Apply."); setError(""); setPrompt(event.target.value); }}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void generate(); } }} /></label>
      <button type="button" disabled={busy || fileBusy || !prompt.trim() || (!aiHistoryIntent(prompt) && !followUp.clarification && (fileBusy || !kernelReady || !consent || !configuration?.available || !context.value || Boolean(requestReview.error)))} onClick={() => void generate()}>Generate AI sketch preview</button>
      <button type="button" onClick={() => { cancel(); setError(""); promptInput.current?.focus(); }}>Cancel AI sketch refinement</button>
      <button type="button" onClick={reset}>Start new sketch conversation</button>
      {preview ? <button type="button" disabled={busy || canvasProposal?.frame !== preview.frame || !canReviewAiSketchCanvasPreview(preview.frame, preview.solved) || sharedFrame !== preview.frame} onClick={() => {
        try {
          if (!canReviewAiSketchCanvasPreview(preview.frame, preview.solved)) throw new Error("The canvas proposal is no longer available. Generate a fresh preview.");
          applySketchRefinement(preview.frame, preview.plan, preview.result);
          consentFrame.current = undefined; setLastFailure(undefined); setAnswer(undefined); setConsent(false);
          let retained = true;
          try { conversationFrame.current = captureSketchRefinementFrame(); }
          catch { conversationFrame.current = undefined; setMessages([]); retained = false; }
          cancel(`AI sketch refinement applied in one undo step.${retained ? " Review the updated context and allow sharing for a follow-up." : " The sketch context changed, so the conversation was reset."}`); setError(""); promptInput.current?.focus();
        }
        catch (failure) { cancel(); setError(failure instanceof Error ? failure.message : "AI sketch edit could not be applied."); promptInput.current?.focus(); }
      }}>Apply AI sketch refinement</button> : null}
    </div>
    <div className="ai-result">
      <p role="status" aria-label="Provider sketch refinement status">{preview && !reviewable ? "The canvas proposal is no longer current. Generate a fresh sketch preview." : status}</p>
      {context.error ? <p role="alert">{context.error}</p> : null}
      {requestReview.error ? <p role="alert">{requestReview.error}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {answer ? <><p>{answer.summary}</p>{answer.warnings.length ? <ul aria-label="AI sketch assumptions">{answer.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</> : null}
      {reviewable ? <><ul aria-label="AI proposed sketch changes">{preview.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul>
        {preview.native ? <><p>{preview.result.meshes.length} bodies · {preview.volume.toFixed(3)} mm³</p></> : null}</> : null}
    </div>
  </div>;
}
