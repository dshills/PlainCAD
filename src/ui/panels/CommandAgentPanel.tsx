import { useCallback, useEffect, useRef, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useCommandPlan } from "../../state/commandPlanState";
import { cancelCommandPlan, markAiCommandPlan } from "../../commands/commandPlans";
import { executeCommand } from "../../commands/registry";
import { fetchAiProviders } from "../../ai/client";
import { captureCommandAgentContext, requestCommandAgentProposal } from "../../ai/commandAgentClient";
import type { CommandAgentProposal } from "../../ai/commandAgentPlan";
import { AI_LIMITS, type AiProvider, type AiProviderStatus } from "../../ai/plan";
import type { AiMessage } from "../../ai/conversation";
import type { CadDocument } from "../../cad/document/schema";
import "./CommandAgentPanel.css";
interface Source { document: CadDocument; session: number; component: string; selection: string; }
function source() {
  const state = useCadStore.getState();
  return { document: state.history.present, session: state.documentSession, component: state.activeComponentId, selection: JSON.stringify(state.selection.selectedIds) };
}
function current(frame: Source) {
  const value = source();
  return value.document === frame.document && value.session === frame.session && value.component === frame.component && value.selection === frame.selection && !useCadStore.getState().fileBusy;
}
export function CommandAgentPanel({ active }: { active: boolean }) {
  const document = useCadStore(state => state.history.present), session = useCadStore(state => state.documentSession);
  const component = useCadStore(state => state.activeComponentId), selection = useCadStore(state => state.selection), fileBusy = useCadStore(state => state.fileBusy);
  const plan = useCommandPlan();
  const [providers, setProviders] = useState<AiProviderStatus[]>([]), [provider, setProvider] = useState<AiProvider>("anthropic"), [model, setModel] = useState("");
  const [prompt, setPrompt] = useState(""), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([]), [proposal, setProposal] = useState<CommandAgentProposal>();
  const [error, setError] = useState(""), [status, setStatus] = useState("Describe a creation or edit. The agent inspects this project and proposes a native preview.");
  const [ownedPlanId, setOwnedPlanId] = useState<string>();
  const providerInitialized = useRef(false);
  const conversationSource = useRef<Source | undefined>(undefined);
  const sharedSource = useRef<Source | undefined>(undefined), abort = useRef<AbortController | undefined>(undefined), ownedPlan = useRef<string | undefined>(undefined);
  const release = useCallback(() => {
    abort.current?.abort(); abort.current = undefined;
    if (ownedPlan.current && useCommandPlan.getState().frame?.id === ownedPlan.current) cancelCommandPlan();
    ownedPlan.current = undefined; setOwnedPlanId(undefined); setBusy(false);
  }, []);
  useEffect(() => {
    if (!active) { release(); setConsent(false); sharedSource.current = undefined; return; }
    const controller = new AbortController();
    void fetchAiProviders(controller.signal).then(items => {
      if (controller.signal.aborted) return;
      setError(""); setProviders(items); setConsent(false); sharedSource.current = undefined;
      const available = items.find(item => item.available);
      if (available && !providerInitialized.current) { providerInitialized.current = true; setProvider(available.id); setModel(available.model); }
    }, failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Providers are unavailable."); });
    return () => { controller.abort(); release(); };
  }, [active, release]);
  useEffect(() => {
    if ((sharedSource.current && !current(sharedSource.current)) || (conversationSource.current && !current(conversationSource.current))) {
      release(); sharedSource.current = undefined; conversationSource.current = undefined; setConsent(false); setMessages([]); setProposal(undefined);
      setStatus("The project or selection changed. Review the current project and allow sharing again.");
    }
  }, [document, session, component, selection, fileBusy, release]);
  const generate = async () => {
    const frame = sharedSource.current;
    if (!active || busy || !consent || !frame || !current(frame) || !providers.find(item => item.id === provider)?.available || !prompt.trim()) return;
    const history = conversationSource.current && current(conversationSource.current) ? messages : [];
    if (!history.length) setMessages([]);
    conversationSource.current = frame;
    release(); setError(""); setProposal(undefined); setBusy(true);
    const controller = new AbortController(); abort.current = controller;
    const timeout = setTimeout(() => { if (abort.current === controller) { release(); setError("Command request timed out. The accepted project is unchanged."); } }, 120000);
    const ensureCurrent = () => {
      if (controller.signal.aborted || abort.current !== controller || !current(frame)) throw new Error("The request became stale or was canceled. The accepted project is unchanged.");
    };
    try {
      const context = await captureCommandAgentContext(); ensureCurrent();
      setStatus("Inspecting project context and asking for a bounded command plan…");
      const answer = await requestCommandAgentProposal(provider, model, prompt, history, context, controller.signal); ensureCurrent();
      setProposal(answer);
      setMessages([...history, { role: "user", content: prompt.trim() }, { role: "assistant", content: JSON.stringify(answer) }].slice(-AI_LIMITS.transcriptMessages) as AiMessage[]);
      if (answer.kind === "clarification") { setStatus("Answer the clarification below. No geometry was changed."); return; }
      setStatus("Checking each operation with the native kernel…");
      const previousPlanId = useCommandPlan.getState().frame?.id;
      const pending = executeCommand({ command: "plan.preview", session: frame.session, arguments: { label: answer.label, steps: answer.steps } });
      const started = useCommandPlan.getState().frame;
      if (started && started.id !== previousPlanId && started.source === frame.document && started.session === frame.session) { ownedPlan.current = started.id; setOwnedPlanId(started.id); }
      const response = await pending; ensureCurrent();
      if (!response.ok) throw new Error(response.error.message);
      const result = response.value as { planId: string };
      if (!result || typeof result.planId !== "string" || useCommandPlan.getState().frame?.id !== result.planId) throw new Error("The native plan proof is no longer current.");
      markAiCommandPlan(result.planId);
      ownedPlan.current = result.planId; setOwnedPlanId(result.planId);
      setStatus("Native preview ready in the model. Review changes before Apply.");
    } catch (failure) {
      if (abort.current !== controller) return;
      release(); setError(failure instanceof Error ? failure.message : "Command proposal failed.");
    } finally {
      clearTimeout(timeout);
      if (abort.current === controller) { abort.current = undefined; setBusy(false); }
    }
  };
  const cancel = () => {
    if (ownedPlan.current && useCommandPlan.getState().frame?.id === ownedPlan.current) void executeCommand({ command: "plan.cancel", session: useCadStore.getState().documentSession, arguments: {} });
    release(); setStatus("Proposal canceled. The accepted project is unchanged.");
  };
  const apply = async () => {
    const id = ownedPlan.current, frame = sharedSource.current;
    if (!id || !frame || !current(frame) || useCommandPlan.getState().frame?.id !== id) { setError("The plan or project changed. Generate a fresh preview."); return; }
    sharedSource.current = undefined; conversationSource.current = undefined; setConsent(false); setMessages([]);
    try {
      const response = await executeCommand({ command: "plan.apply", session, arguments: { planId: id } });
      if (!response.ok) throw new Error(response.error.message);
      ownedPlan.current = undefined; setOwnedPlanId(undefined); setStatus("Applied as one project edit. Use Undo to revert the whole plan.");
    } catch (failure) { release(); setError(failure instanceof Error ? failure.message : "The plan could not apply."); }
  };
  const owned = ownedPlanId && plan.frame?.id === ownedPlanId;
  return <div className="command-agent-panel" aria-label="AI command agent" onKeyDown={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && (busy || owned)) { event.preventDefault(); event.stopPropagation(); cancel(); }
  }}>
    <p>Inspect, clarify, preview, apply. Command plans create and modify editable geometry in the main viewport.</p>
    <div className="ai-actions">
      <label>Command agent provider<select value={provider} disabled={busy || Boolean(owned)} onChange={event => {
        const next = event.target.value as AiProvider; setProvider(next); setModel(providers.find(item => item.id === next)?.model ?? ""); setConsent(false); sharedSource.current = undefined; conversationSource.current = undefined; setMessages([]);
      }}>{providers.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{!item.available ? " (not configured)" : ""}</option>)}</select></label>
      <label>Command agent model<input value={model} disabled={busy || Boolean(owned)} maxLength={100} onChange={event => { setModel(event.target.value); setConsent(false); sharedSource.current = undefined; }} /></label>
    </div>
    <label><input type="checkbox" checked={consent} disabled={busy || Boolean(owned)} onChange={event => {
      sharedSource.current = event.target.checked ? source() : undefined; setConsent(event.target.checked);
    }} />Allow sending this project's editable JSON, selection, diagnostics and conversation to {providers.find(item => item.id === provider)?.label ?? "the selected provider"}. Meshes and API keys stay local.</label>
    <label>Describe command agent changes<textarea value={prompt} maxLength={AI_LIMITS.promptCharacters} disabled={busy || Boolean(owned)} onChange={event => setPrompt(event.target.value)} /></label>
    <div className="ai-actions">
      <button type="button" disabled={!active || busy || Boolean(owned) || fileBusy || !consent || !prompt.trim() || !/^[A-Za-z0-9._-]{1,100}$/.test(model) || !providers.find(item => item.id === provider)?.available} onClick={() => void generate()}>Generate command preview</button>
      {busy || owned ? <button type="button" onClick={cancel}>Cancel command proposal</button> : null}
      {owned && plan.status === "ready" ? <button type="button" onClick={() => void apply()}>Apply command plan</button> : null}
      <button type="button" disabled={busy || Boolean(owned)} onClick={() => { setMessages([]); setProposal(undefined); setConsent(false); sharedSource.current = undefined; conversationSource.current = undefined; setError(""); }}>New command conversation</button>
    </div>
    {proposal ? <div><h3>{proposal.label}</h3><p>{proposal.summary}</p>{proposal.warnings.map((warning, index) => <p key={index}>{warning}</p>)}{proposal.steps.length ? <ol>{proposal.steps.map((step, index) => <li key={index}><strong>{step.command}</strong><pre>{JSON.stringify(step.arguments, null, 2)}</pre></li>)}</ol> : null}</div> : null}
    <p role="status" aria-label="Command agent status">{owned && plan.progress ? plan.progress : status}</p>
    {error || (owned && plan.error) ? <p role="alert">{error || plan.error}</p> : null}
  </div>;
}
