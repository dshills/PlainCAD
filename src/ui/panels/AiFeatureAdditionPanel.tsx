import { aiHistoryIntent, handleAiHistoryPrompt } from "../commands/aiHistoryPrompt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAiFollowUp, type FailedAiRequest } from "../../ai/followUp";
import { fetchAiProviders } from "../../ai/client";
import { prepareAiFeatureAddRequest, requestAiFeatureAddProposal } from "../../ai/featureAddAiClient";
import { buildAiFeatureAddition, type AiFeatureAddProposal } from "../../ai/featureAddPlan";
import { AI_LIMITS, type AiProvider, type AiProviderStatus } from "../../ai/plan";
import type { AiMessage } from "../../ai/conversation";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { facePocketFaces } from "../commands/facePocketCommand";
import { captureAiFeatureAddition, currentAiFeatureAddition, featureAdditionContext, previewAiFeatureAddition, applyAiFeatureAddition, useAiFeatureAddition, type AiFeatureAdditionFrame, type AiFeatureAdditionPlan } from "../commands/aiFeatureAdditionCommand";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { clearAiCanvasPreview, currentAiCanvasPreview, publishAiCanvasPreview, useAiCanvasPreview, type AiCanvasPreview } from "../../state/aiCanvasPreview";
import { AiCanvasPreviewControls } from "./AiCanvasPreviewControls";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
interface ConversationSource { document: AiFeatureAdditionFrame["document"]; session: number; componentId: string; selection: string; faceId: string; bodyId?: string }
interface Preview { canvasPreview: AiCanvasPreview; frame: AiFeatureAdditionFrame; plan: AiFeatureAdditionPlan; result: RebuildResult; volume: number; before: number }
export function AiFeatureAdditionPanel({ active = true, targetFaceId }: { active?: boolean; targetFaceId?: string }) {
  const cadDocument = useCadStore((s) => s.history.present), session = useCadStore((s) => s.documentSession), component = useCadStore((s) => s.activeComponentId);
  const rebuild = useCadStore((s) => s.rebuild), fileBusy = useCadStore((s) => s.fileBusy), selection = useCadStore((s) => s.selection);
  const viewerSession = useViewerState((s) => s.session);
  const hiddenBodies = useViewerState((s) => s.hiddenBodyIds);
  const hiddenComponents = useViewerState((s) => s.hiddenComponentIds);
  const shared = useAiFeatureAddition((s) => s.frame), enablement = useCommandEnablement();
  const [faceId, setFaceId] = useState("");
  const [providers, setProviders] = useState<AiProviderStatus[]>([]), [provider, setProvider] = useState<AiProvider>("anthropic");
  const [consent, setConsent] = useState(false), [prompt, setPrompt] = useState(""), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose a supported face and review the data before requesting new features."), [error, setError] = useState("");
  const [answer, setAnswer] = useState<AiFeatureAddProposal>(), [preview, setPreview] = useState<Preview>(), [messages, setMessages] = useState<AiMessage[]>([]);
  const canvasPreview = useAiCanvasPreview(state => state.preview);
  const ownedCanvasPreview = useRef<AiCanvasPreview | undefined>(undefined);
  const owned = useRef<AiFeatureAdditionFrame | undefined>(undefined), consentFrame = useRef<AiFeatureAdditionFrame | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationSource = useRef<ConversationSource | undefined>(undefined);
  const awaitingAppliedFace = useRef(false);
  const previousAppliedResult = useRef<RebuildResult | undefined>(undefined);
  const [lastFailure, setLastFailure] = useState<(FailedAiRequest & { frame: AiFeatureAdditionFrame })>();
  const input = useRef<HTMLTextAreaElement>(null);
  const choices = useMemo(() => active ? facePocketFaces() : [], [active, cadDocument, session, component, rebuild, fileBusy, viewerSession, hiddenBodies, hiddenComponents]);
  const configuration = providers.find((p) => p.id === provider);
  const context = useMemo(() => {
    if (!active) return { frame: undefined, value: undefined, error: "" };
    try { if (awaitingAppliedFace.current && rebuild.result === previousAppliedResult.current) throw new Error("Waiting for the current native rebuild before reviewing this face."); const frame = captureAiFeatureAddition(faceId); return { frame, value: featureAdditionContext(frame), error: "" }; }
    catch (failure) { return { frame: undefined, value: undefined, error: failure instanceof Error ? failure.message : "Face context is unavailable." }; }
  }, [active, cadDocument, session, component, rebuild, fileBusy, faceId, selection, viewerSession, hiddenBodies, hiddenComponents]);
  const followUp = resolveAiFollowUp(prompt, lastFailure && currentAiFeatureAddition(lastFailure.frame) ? lastFailure : undefined);
  const budget = useMemo(() => {
    if (!context.value || !configuration || !prompt.trim()) return { value: undefined, error: "" };
    try { return { value: prepareAiFeatureAddRequest(provider, configuration.model, followUp.prompt, messages, context.value), error: "" }; }
    catch (failure) { return { value: undefined, error: failure instanceof Error ? failure.message : "Request exceeds its limit." }; }
  }, [context.value, configuration, provider, followUp.prompt, messages]);
  const release = useCallback(() => {
    controller.current?.abort(); controller.current = undefined;
    if (ownedCanvasPreview.current) clearAiCanvasPreview(ownedCanvasPreview.current);
    ownedCanvasPreview.current = undefined;
    if (timer.current !== undefined) clearTimeout(timer.current); timer.current = undefined;
    if (owned.current && useAiFeatureAddition.getState().frame === owned.current) useAiFeatureAddition.setState({ frame: undefined });
    owned.current = undefined;
  }, []);
  const cancel = useCallback((message = "Feature proposal canceled. The project is unchanged.") => { release(); setPreview(undefined); setBusy(false); setStatus(message); }, [release]);
  useEffect(() => {
    if (preview && canvasPreview !== preview.canvasPreview)
      cancel("The native canvas preview closed. Generate a fresh preview before Apply.");
  }, [preview, canvasPreview, cancel]);
  const reset = useCallback(() => { conversationSource.current = undefined; awaitingAppliedFace.current = false; previousAppliedResult.current = undefined; setLastFailure(undefined); cancel(); consentFrame.current = undefined; setConsent(false); setMessages([]); setAnswer(undefined); setError(""); }, [cancel]);
  useEffect(() => {
    if (!targetFaceId) return;
    conversationSource.current = undefined; awaitingAppliedFace.current = false; previousAppliedResult.current = undefined; setMessages([]); setLastFailure(undefined);
    cancel("Selected face ready. Review its target and allow sharing before generating a preview.");
    setFaceId(targetFaceId); consentFrame.current = undefined; setConsent(false); setAnswer(undefined); setError("");
  }, [targetFaceId, cancel]);
  useEffect(() => {
    if (!active) { reset(); setStatus("Mode closed. Your description is kept; review the current face before requesting a follow-up."); return; }
    const abort = new AbortController();
    void fetchAiProviders(abort.signal).then((items) => { if (!abort.signal.aborted) { setProviders(items); setProvider((previous) => items.some((item) => item.id === previous && item.available) ? previous : items.find((item) => item.available)?.id ?? "anthropic"); } }).catch((failure) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Local providers are unavailable."); });
    return () => { abort.abort(); release(); };
  }, [active, release, reset]);
  useEffect(() => {
    const source = conversationSource.current;
    const sourceChanged = source && (cadDocument !== source.document || session !== source.session || component !== source.componentId || JSON.stringify(selection.selectedIds) !== source.selection || faceId !== source.faceId || fileBusy || hiddenBodies.includes(source.bodyId ?? "") || hiddenComponents.includes(source.componentId));
    if (sourceChanged || (consentFrame.current && !currentAiFeatureAddition(consentFrame.current)) || (owned.current && shared !== owned.current)) {
      reset(); setStatus("The part, selection or task changed. Choose a current face and allow sharing again.");
    } else if (source && rebuild.status === "succeeded" && (!awaitingAppliedFace.current || rebuild.result !== previousAppliedResult.current) && !choices.some(choice => choice.id === source.faceId)) {
      reset(); setStatus("The conversation target face is no longer supported. Choose a current face to start a new conversation.");
    } else if (awaitingAppliedFace.current && rebuild.status === "succeeded" && rebuild.result !== previousAppliedResult.current) {
      awaitingAppliedFace.current = false; previousAppliedResult.current = undefined;
      if (!context.frame) {
        reset(); setStatus("The conversation target face is no longer supported. Choose a current face to start a new conversation.");
      } else setStatus("Feature plan applied in one undo step. The same native face is ready; review its updated context and allow sharing for a follow-up.");
    } else if (awaitingAppliedFace.current && rebuild.status === "failed") {
      reset(); setStatus("Feature plan applied, but the rebuild failed. Review diagnostics and choose a current supported face before continuing.");
    }
  }, [active, cadDocument, session, component, rebuild, selection, faceId, shared, fileBusy, enablement.editProject, viewerSession, hiddenBodies, hiddenComponents, context.frame, choices, reset]);
  const generate = async () => {
    if (!active || busy || fileBusy) return;
    if (aiHistoryIntent(prompt)) {
      cancel(); setError("");
      const outcome = handleAiHistoryPrompt(prompt);
      setStatus(outcome?.message ?? "AI history is unavailable.");
      return;
    }
    if (followUp.clarification) { cancel(followUp.clarification); setAnswer(undefined); setError(""); return; }
    const frame = consentFrame.current;
    if (!active || busy || fileBusy || !consent || !frame || !currentAiFeatureAddition(frame) || !configuration?.available || !context.value || !budget.value || budget.error) return;
    cancel(); setError(""); setAnswer(undefined); setLastFailure(undefined);
    const abort = new AbortController(); controller.current = abort;
    conversationSource.current = { document: frame.document, session: frame.session, componentId: frame.componentId, selection: frame.selection, faceId, bodyId: frame.choice.bodyId };
    owned.current = frame; useAiFeatureAddition.setState({ frame }); setBusy(true);
    timer.current = setTimeout(() => { if (controller.current === abort) { cancel(); setError("Feature request timed out. Try a simpler request."); } }, 120000);
    try {
      const captured = featureAdditionContext(frame);
      if (JSON.stringify(captured) !== JSON.stringify(context.value)) throw new Error("Target context changed. Review it and allow sharing again.");
      setStatus("Asking the selected provider for feature additions…");
      const proposal = await requestAiFeatureAddProposal(provider, configuration.model, followUp.prompt, messages, captured, abort.signal);
      if (controller.current !== abort || abort.signal.aborted || !currentAiFeatureAddition(frame) || useAiFeatureAddition.getState().frame !== frame) return;
      setLastFailure(undefined);
      setAnswer(proposal);
      const nextMessages: AiMessage[] = [...messages, { role: "user", content: followUp.prompt }, { role: "assistant", content: JSON.stringify(proposal) }];
      setMessages(nextMessages.slice(-AI_LIMITS.transcriptMessages));
      if (!proposal.actions.length) { cancel("AI needs clarification. Answer below; no feature was applied."); return; }
      const plan = buildAiFeatureAddition(frame.document, frame.componentId, frame.choice, frame.result, captured, proposal);
      setStatus("Validating every operation and the complete native part…");
      const geometry = await previewAiFeatureAddition(frame, plan, abort.signal);
      if (controller.current !== abort || abort.signal.aborted || !currentAiFeatureAddition(frame) || useAiFeatureAddition.getState().frame !== frame) return;
      if (!publishAiCanvasPreview({ document: frame.document, session: frame.session, componentId: frame.componentId,
        selection: JSON.parse(frame.selection), beforeResult: frame.result, result: geometry.result, bodyIds: [frame.choice.bodyId!] }))
        throw new Error("Project, face or accepted geometry changed. Generate a fresh native preview.");
      const published = useAiCanvasPreview.getState().preview;
      if (!published) throw new Error("The native canvas preview is unavailable. Generate a fresh preview.");
      setLastFailure(undefined);
      ownedCanvasPreview.current = published;
      setPreview({ frame, plan, ...geometry, canvasPreview: published }); setBusy(false); setStatus("Native feature preview ready. Review every operation before Apply.");
      controller.current = undefined; if (timer.current !== undefined) clearTimeout(timer.current); timer.current = undefined;
    } catch (failure) {
      if (controller.current !== abort) return;
      const diagnostic = failure instanceof Error ? failure.message : "Feature proposal failed.";
      if (currentAiFeatureAddition(frame)) setLastFailure({ frame, prompt: followUp.prompt === prompt.trim() ? followUp.prompt : lastFailure?.prompt ?? followUp.prompt, diagnostic });
      cancel(); setError(diagnostic);
    }
  };
  return <div className="ai-drawer-content" aria-label="AI feature additions" onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); input.current?.focus(); } }}>
    <div className="ai-composer">
      <h3>Add features to this part</h3>
      <label>Feature target face<select value={faceId} disabled={busy} onChange={(event) => { reset(); setFaceId(event.target.value); }}><option value="">Choose a supported face</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
      <label>Feature AI provider<select value={provider} disabled={busy} onChange={(event) => { reset(); setProvider(event.target.value as AiProvider); }}>{providers.length ? providers.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " · not configured"}</option>) : <option value="anthropic">Provider configuration unavailable</option>}</select></label>
      {configuration ? <p className="muted">Configured model: {configuration.model}</p> : null}
      <p>Holes and pockets cut inward into the chosen body. Existing features and parameter bindings are preserved. New feature expressions may use listed shared parameters.</p>
      <label><input type="checkbox" checked={consent} onChange={(event) => {
        cancel(); consentFrame.current = undefined; setError("");
        if (!event.target.checked) { setConsent(false); return; }
        try { const frame = captureAiFeatureAddition(faceId); if (!context.value || JSON.stringify(featureAdditionContext(frame)) !== JSON.stringify(context.value)) throw new Error("Review the current target context first."); consentFrame.current = frame; setConsent(true); }
        catch (failure) { setConsent(false); setError(failure instanceof Error ? failure.message : "Target context unavailable."); }
      }} />Allow sending the selected face's local bounds, body/edge IDs, project parameter names and expressions, and recent conversation to the selected AI provider</label>
      <details><summary>Review feature data sent to the provider</summary><p>No project file, full geometry, meshes or credentials. Maximum request: 32 KB.</p>{budget.value || context.value ? <pre aria-label="Bounded feature context" style={{ maxHeight: "220px", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(budget.value ?? context.value, null, 2)}</pre> : null}</details>
      <label>Feature request<textarea ref={input} rows={3} value={prompt} maxLength={AI_LIMITS.promptCharacters} placeholder="Add four 3 mm mounting holes at local coordinates…" onChange={(event) => { cancel("Request changed. Generate a fresh preview."); setPrompt(event.target.value); setError(""); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void generate(); } }} /></label>
      <button type="button" disabled={busy || fileBusy || !prompt.trim() || (!aiHistoryIntent(prompt) && !followUp.clarification && (!consent || !configuration?.available || !budget.value || Boolean(budget.error)))} onClick={() => void generate()}>Generate AI feature preview</button>
      <button type="button" onClick={() => { cancel(); setError(""); input.current?.focus(); }}>Cancel AI feature proposal</button>
      <button type="button" onClick={reset}>Start new feature conversation</button>
      {preview ? <button type="button" disabled={busy || canvasPreview !== preview.canvasPreview || !currentAiCanvasPreview(useCadStore.getState()) || !currentAiFeatureAddition(preview.frame) || shared !== preview.frame} onClick={() => {
        try {
          if (canvasPreview !== preview.canvasPreview || !currentAiCanvasPreview(useCadStore.getState())) throw new Error("The native canvas preview is no longer available. Generate a fresh preview.");
          applyAiFeatureAddition(preview.frame, preview.plan, preview.result);
          const updated = useCadStore.getState();
          conversationSource.current = { document: updated.history.present, session: updated.documentSession, componentId: updated.activeComponentId, selection: JSON.stringify(updated.selection.selectedIds), faceId, bodyId: preview.frame.choice.bodyId };
          previousAppliedResult.current = preview.frame.result; awaitingAppliedFace.current = true; consentFrame.current = undefined; setConsent(false); setLastFailure(undefined); setAnswer(undefined);
          cancel("Feature plan applied in one undo step. Waiting for rebuilt native geometry before continuing on this face."); setError(""); input.current?.focus(); }
        catch (failure) { cancel(); setError(failure instanceof Error ? failure.message : "Feature plan could not be applied."); }
      }}>Apply AI feature plan</button> : null}
    </div>
    <div className="ai-result"><p role="status" aria-label="AI feature proposal status">{status}</p>{faceId && context.error ? <p role="alert">{context.error}</p> : null}{error || budget.error ? <p role="alert">{error || budget.error}</p> : null}
      {answer ? <><p>{answer.summary}</p>{answer.warnings.length ? <ul>{answer.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</> : null}
      {preview ? <><ol aria-label="Proposed feature operations">{preview.plan.features.map((feature) => <li key={feature.id}>{feature.name} · {feature.type}</li>)}</ol><AiCanvasPreviewControls /><p>Target volume: {preview.before.toFixed(3)} → {preview.volume.toFixed(3)} mm³</p></> : null}
    </div>
  </div>;
}
