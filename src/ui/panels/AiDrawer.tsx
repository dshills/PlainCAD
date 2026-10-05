import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAiProviders, requestAiPlan } from "../../ai/client";
import { buildAiPlan } from "../../ai/buildPlan";
import { aiEditContext, buildAiParameterEdit } from "../../ai/editPlan";
import {
  aiFeatureEditContext,
  buildAiFeatureEdit,
} from "../../ai/featureEditPlan";
import { reviseAiParameters } from "../../ai/revisePlan";
import {
  createAiConversationBudget,
  prepareAiRepairPrompt,
  type AiMessage,
} from "../../ai/conversation";
import {
  AI_LIMITS,
  type AiPlan,
  type AiProvider,
  type AiProviderStatus,
} from "../../ai/plan";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import {
  applyAiPlan,
  assertAiGeometry,
  currentAiFrame,
  useAiDrawer,
  previewAiPlan,
  type AiDraftFrame,
  type AiStaged,
} from "../commands/aiCommand";
import { runCommand } from "../commands/commandRegistry";

interface Proposal {
  frame: AiDraftFrame;
  plan: AiPlan;
  staged: AiStaged;
  result: RebuildResult;
  operationResult?: RebuildResult;
  geometry: ReturnType<typeof assertAiGeometry>;
}
type Message = AiMessage & { summary?: string };
export function AiDrawer() {
  // Layout seeds the initial disclosure; later layout changes preserve the user’s choice.
  const [settingsOpen, setSettingsOpen] = useState(
    () => useWorkspaceState.getState().layout === "full",
  );
  const open = useAiDrawer((state) => state.open);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const componentId = useCadStore((state) => state.activeComponentId);
  const selected = useCadStore((state) => state.selection.selectedIds[0]);
  const selectedFeatureId =
    selected?.kind === "feature" && selected.documentId === document.id
      ? selected.id
      : undefined;
  const fileBusy = useCadStore((state) => state.fileBusy);
  const kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const canvasActive = Boolean(useSketchCanvas((state) => state.active));
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<"create" | "edit" | "feature">("create");
  const editingFeatureId = task === "feature" ? selectedFeatureId : undefined;
  const editing = useMemo(() => {
    if (task === "create") return {};
    try {
      return {
        context:
          task === "feature"
            ? aiFeatureEditContext(
                document,
                componentId,
                editingFeatureId ?? "",
              )
            : aiEditContext(document, componentId),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Component parameters are unavailable.",
      };
    }
  }, [document, componentId, task, editingFeatureId]);
  const [history, setHistory] = useState<Message[]>([]);
  const [reply, setReply] = useState<AiPlan>();
  const [dimensionDrafts, setDimensionDrafts] = useState<
    Record<string, string>
  >({});
  const [replyFrame, setReplyFrame] = useState<AiDraftFrame>();
  const [proposal, setProposal] = useState<Proposal>();
  useEffect(() => {
    if (!reply) {
      setReplyFrame(undefined);
      setDimensionDrafts({});
    }
  }, [reply]);
  const [status, setStatus] = useState("Describe the part you want to make.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const frame = useRef<AiDraftFrame>(undefined);
  const preference = useRef({ provider, model });
  const conversationBudget = useMemo(() => {
    try {
      return {
        prepare: createAiConversationBudget(
          provider,
          model,
          history,
          task !== "create" ? editing.context : undefined,
        ),
      };
    } catch (failure) {
      return {
        error:
          failure instanceof Error
            ? failure.message
            : "Conversation context is unavailable.",
      };
    }
  }, [provider, model, history, task, editing.context]);
  const conversation = useMemo(() => {
    try {
      return {
        prepared: conversationBudget.prepare?.(prompt),
        error: conversationBudget.error,
      };
    } catch (failure) {
      return {
        error:
          failure instanceof Error
            ? failure.message
            : "Conversation context is unavailable.",
      };
    }
  }, [conversationBudget, prompt]);
  useEffect(() => {
    preference.current = { provider, model };
  }, [provider, model]);
  const current = proposal && currentAiFrame(proposal.frame);
  const canGenerate =
    !busy &&
    !fileBusy &&
    !canvasActive &&
    kernelReady &&
    Boolean(prompt.trim()) &&
    prompt.length <= AI_LIMITS.promptCharacters &&
    /^[A-Za-z0-9._-]{1,100}$/.test(model) &&
    !configError &&
    !conversation.error &&
    !editing.error &&
    (task === "create" || Boolean(editing.context?.parameters.length)) &&
    providers.some((p) => p.id === provider && p.available);
  const cancel = (message = "Request canceled. The project is unchanged.") => {
    controller.current?.abort();
    controller.current = undefined;
    frame.current = undefined;
    setBusy(false);
    setProposal(undefined);
    setStatus(message);
  };
  useEffect(() => {
    if (!open) {
      if (controller.current || frame.current)
        cancel("Drawer closed. Describe a part to generate another preview.");
      return;
    }
    input.current?.focus();
    const abort = new AbortController();
    setConfigError("");
    void fetchAiProviders(abort.signal)
      .then((items) => {
        if (abort.signal.aborted) return;
        setProviders(items);
        const selected =
          items.find(
            (item) => item.id === preference.current.provider && item.available,
          ) ??
          items.find((item) => item.available) ??
          items[0];
        if (!selected) {
          setConfigError("No AI providers are available.");
          return;
        }
        const previous = preference.current;
        setProvider(selected.id);
        setModel(
          previous.model && previous.provider === selected.id
            ? previous.model
            : selected.model,
        );
      })
      .catch((failure) => {
        if (!abort.signal.aborted)
          setConfigError(
            failure instanceof Error
              ? failure.message
              : "AI configuration is unavailable.",
          );
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [open, refresh]);
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [open]);
  useEffect(() => {
    if (frame.current && !currentAiFrame(frame.current))
      cancel("Project or component changed. Generate a fresh preview.");
  }, [
    document,
    session,
    componentId,
    selectedFeatureId,
    fileBusy,
    canvasActive,
  ]);
  useEffect(() => {
    setHistory([]);
    setReply(undefined);
    setError("");
  }, [session]);
  useEffect(() => {
    if (task !== "create") {
      setHistory([]);
      setReply(undefined);
    }
  }, [componentId, task, editingFeatureId]);
  const requireFeatureId = (base: AiDraftFrame) => {
    if (!base.featureId)
      throw new Error("Select a feature before editing dimensions.");
    return base.featureId;
  };
  const generate = async () => {
    if (!canGenerate) return;
    if (task === "feature" && !selectedFeatureId) {
      setError("Select a feature before generating dimension edits.");
      return;
    }
    cancel();
    const abort = new AbortController(),
      timer = window.setTimeout(() => abort.abort(), 120000);
    controller.current = abort;
    const base: AiDraftFrame = {
      document,
      session,
      componentId,
      ...(task === "feature" ? { featureId: selectedFeatureId } : {}),
    };
    frame.current = base;
    setBusy(true);
    setError("");
    setReply(undefined);
    setStatus("Asking AI to propose your part…");
    const description = prompt.trim();
    try {
      const plan = await requestAiPlan(
        provider,
        model,
        description,
        history,
        abort.signal,
        task !== "create" ? editing.context : undefined,
      );
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        !currentAiFrame(base)
      )
        return;
      setReply(plan);
      setReplyFrame(base);
      setDimensionDrafts(
        Object.fromEntries(
          plan.parameters.map((p) => [p.name, String(p.value)]),
        ),
      );
      const nextHistory: Message[] = [
        ...history,
        { role: "user", content: description },
        {
          role: "assistant",
          content: JSON.stringify(plan),
          summary: [plan.summary, ...plan.warnings].join("\n"),
        },
      ];
      setHistory(nextHistory.slice(-AI_LIMITS.transcriptMessages));
      if (
        !plan.steps.length &&
        (task === "create" || !plan.parameters.length)
      ) {
        setStatus(
          "More information is needed, or this request is unsupported.",
        );
        return;
      }
      const staged =
        task === "feature"
          ? buildAiFeatureEdit(
              document,
              componentId,
              requireFeatureId(base),
              plan,
            )
          : task === "edit"
            ? buildAiParameterEdit(document, componentId, plan)
            : buildAiPlan(document, plan);
      setStatus("Checking native geometry…");
      const { result, operationResult } = await previewAiPlan(
        staged,
        abort.signal,
      );
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        !currentAiFrame(base)
      )
        return;
      const geometry = assertAiGeometry(staged, result);
      setProposal({
        frame: base,
        plan,
        staged,
        result,
        operationResult,
        geometry,
      });
      setStatus(
        task !== "create"
          ? "Native preview ready. Apply updates the existing component in one undo step."
          : "Native preview ready. Apply adds one editable component.",
      );
    } catch (failure) {
      if (controller.current !== abort || !currentAiFrame(base)) return;
      setError(
        abort.signal.aborted
          ? "AI request timed out. Try a simpler description."
          : failure instanceof Error
            ? failure.message
            : "AI generation failed.",
      );
      setStatus("The project is unchanged.");
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) {
        controller.current = undefined;
        setBusy(false);
      }
    }
  };
  const canPreviewDimensions = Boolean(
    reply?.parameters.length &&
    replyFrame &&
    currentAiFrame(replyFrame) &&
    !busy &&
    kernelReady &&
    !fileBusy &&
    !canvasActive,
  );
  const previewDimensions = async () => {
    if (!canPreviewDimensions || !reply || !replyFrame) return;
    const base = replyFrame;
    cancel("Checking edited dimensions…");
    const abort = new AbortController();
    controller.current = abort;
    frame.current = base;
    setBusy(true);
    setError("");
    try {
      const plan = reviseAiParameters(reply, dimensionDrafts);
      const staged =
        task === "feature"
          ? buildAiFeatureEdit(
              base.document,
              base.componentId,
              requireFeatureId(base),
              plan,
            )
          : task === "edit"
            ? buildAiParameterEdit(base.document, base.componentId, plan)
            : buildAiPlan(base.document, plan);
      const { result, operationResult } = await previewAiPlan(
        staged,
        abort.signal,
      );
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        !currentAiFrame(base)
      )
        return;
      const geometry = assertAiGeometry(staged, result);
      setReply(plan);
      setProposal({
        frame: base,
        plan,
        staged,
        result,
        operationResult,
        geometry,
      });
      setHistory((entries) =>
        entries.map((entry, index) =>
          index === entries.length - 1 && entry.role === "assistant"
            ? {
                ...entry,
                content: JSON.stringify(plan),
                summary: [plan.summary, ...plan.warnings].join("\n"),
              }
            : entry,
        ),
      );
      setStatus(
        "Native preview ready with edited dimensions. No additional AI request was sent.",
      );
    } catch (failure) {
      if (controller.current !== abort || !currentAiFrame(base)) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Edited dimensions could not be previewed.",
      );
      setStatus("The project is unchanged. Repair the proposed dimensions.");
    } finally {
      if (controller.current === abort) {
        controller.current = undefined;
        setBusy(false);
      }
    }
  };
  const apply = () => {
    if (!proposal || !current) return;
    try {
      applyAiPlan(
        proposal.frame,
        proposal.staged,
        proposal.result,
        proposal.operationResult,
      );
      setProposal(undefined);
      setStatus(
        proposal.staged.editedFeature
          ? "Updated selected feature dimensions. IDs and downstream geometry are preserved."
          : proposal.staged.changes
            ? "Updated component parameters. Feature and sketch IDs are preserved."
            : `Added ${proposal.plan.name}. You can edit its parameters, sketches and features.`,
      );
      frame.current = undefined;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "AI component could not be applied.",
      );
    }
  };
  const selectedProvider = providers.find((p) => p.id === provider);
  return (
    <section
      className={`ai-drawer${open ? " open" : ""}`}
      aria-label="AI modeling assistant"
    >
      <div className="ai-drawer-header">
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={open ? "ai-drawer-content" : undefined}
          onClick={() => void runCommand("ai.toggle")}
        >
          {open ? "Close AI drawer" : "Open AI drawer"}
        </button>
        <span>Describe a part</span>
      </div>
      {open ? (
        <div
          id="ai-drawer-content"
          className="ai-drawer-content"
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !window.document.querySelector("dialog[open]")
            ) {
              event.preventDefault();
              event.stopPropagation();
              void runCommand("ai.toggle");
              toggle.current?.focus();
            }
          }}
        >
          <div className="ai-composer">
            <label>
              AI task
              <select
                aria-label="AI task"
                value={task}
                disabled={busy}
                onChange={(event) => {
                  cancel("AI task changed. Generate a fresh preview.");
                  setTask(event.target.value as "create" | "edit" | "feature");
                  setHistory([]);
                  setReply(undefined);
                  setError("");
                }}
              >
                <option value="create">Create new component</option>
                <option value="edit">Edit active component parameters</option>
                <option value="feature">
                  Edit selected feature dimensions
                </option>
              </select>
            </label>
            {task !== "create" ? (
              <div>
                <p>
                  Editing{" "}
                  {editing.context?.feature?.name ??
                    document.components[componentId]?.name}
                  . Listed names, expressions and values will be sent to the
                  provider.
                  {task === "edit"
                    ? " Shared, locked and derived parameters are excluded."
                    : ""}{" "}
                  Dependent face references are rebuilt throughout the project.
                </p>
                {task === "feature" ? (
                  <p>
                    Only selected-feature dimensions are sent. Sketch, profile,
                    axis, operation, centers and targets stay unchanged. Changed
                    fields replace their parameter binding with the proposed
                    literal; project parameters stay intact.
                  </p>
                ) : null}
                {editing.error ? (
                  <p role="alert">{editing.error}</p>
                ) : editing.context?.parameters.length ? (
                  <details>
                    <summary>
                      Editable{" "}
                      {task === "feature" ? "dimensions" : "parameters"} (
                      {editing.context.parameters.length})
                    </summary>
                    <ul>
                      {editing.context.parameters.map((p) => (
                        <li key={p.id}>
                          {p.name}: {p.expression}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p role="status">
                    This component has no independent, exclusive length/angle
                    parameters. Select a parameterized component or use ordinary
                    feature controls.
                  </p>
                )}
              </div>
            ) : null}
            <p className="ai-provider-summary">
              Provider:{" "}
              {selectedProvider?.label ?? provider}
              {selectedProvider?.available === false
                ? " — key not configured; open AI settings"
                : ""}
            </p>
            <details
              className="ai-settings"
              open={settingsOpen}
              onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
            >
              <summary>AI settings</summary>
              <div className="ai-provider-controls">
                <label>
                  AI provider
                  <select
                    aria-label="AI provider"
                    value={provider}
                    disabled={busy}
                    onChange={(event) => {
                      cancel("Provider changed. Generate a new preview.");
                      setReply(undefined);
                      setError("");
                      setHistory([]);
                      const id = event.target.value as AiProvider;
                      setProvider(id);
                      setModel(providers.find((p) => p.id === id)?.model ?? "");
                    }}
                  >
                    {providers.length ? (
                      providers.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.available}>
                          {p.label}
                          {p.available ? "" : " — key not configured"}
                        </option>
                      ))
                    ) : (
                      <option value={provider}>Loading providers…</option>
                    )}
                  </select>
                </label>
                <label>
                  AI model
                  <input
                    value={model}
                    disabled={busy}
                    maxLength={100}
                    onChange={(event) => {
                      cancel("Model changed. Generate a new preview.");
                      setModel(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Refresh providers
                </button>
              </div>
            </details>
            <label htmlFor="ai-description">What would you like to make?</label>
            <textarea
              ref={input}
              id="ai-description"
              rows={3}
              maxLength={AI_LIMITS.promptCharacters}
              placeholder="A 60 × 40 × 5 mm plate with four 4 mm mounting holes, 6 mm from each corner…"
              value={prompt}
              disabled={busy}
              onChange={(event) => {
                if (proposal)
                  cancel("Description changed. Generate a fresh preview.");
                setPrompt(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void generate();
                }
              }}
            />
            <p className="muted">
              Your description and recent AI conversation go to the selected
              provider.{" "}
              {task === "feature"
                ? "Apply updates the selected feature dimensions."
                : task === "edit"
                  ? "Apply updates the listed parameters of the active component."
                  : "Apply adds a new component; current parts stay in place."}{" "}
              Ctrl/Cmd+Enter generates a preview.
            </p>
            {canvasActive ? (
              <p role="status">
                Finish sketch editing to generate an AI component.
              </p>
            ) : null}
            <p role="status" aria-label="AI conversation context">
              {prompt.length > AI_LIMITS.promptCharacters
                ? `Shorten the description to ${AI_LIMITS.promptCharacters} characters before generating.`
                : (conversation.error ??
                  (conversation.prepared?.omittedTurns
                    ? `${conversation.prepared.omittedTurns} older ${conversation.prepared.omittedTurns === 1 ? "turn" : "turns"} omitted from the next request; the latest complete proposal is retained.`
                    : `The latest complete proposal and up to ${AI_LIMITS.history / 2} recent turns accompany follow-ups.`))}
            </p>
            <div className="ai-actions">
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => void generate()}
              >
                Generate preview
              </button>
              <button
                type="button"
                disabled={!busy && !proposal}
                onClick={() => cancel()}
              >
                Cancel AI proposal
              </button>
              <button
                type="button"
                disabled={!proposal || !current || busy || fileBusy}
                onClick={apply}
              >
                {task === "feature"
                  ? "Apply AI feature edits"
                  : task === "edit"
                    ? "Apply AI parameter edits"
                    : "Apply AI component"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  cancel("Conversation cleared. Describe a new part.");
                  setHistory([]);
                  setReply(undefined);
                  setPrompt("");
                  setError("");
                  input.current?.focus();
                }}
              >
                New conversation
              </button>
            </div>
          </div>
          <div className="ai-result">
            {history.length ? (
              <details open className="ai-conversation">
                <summary>Conversation ({history.length / 2} turns)</summary>
                <ol aria-label="AI conversation">
                  {history.map((entry, index) => (
                    <li key={index}>
                      <strong>
                        {entry.role === "user" ? "You" : "Assistant"}
                      </strong>
                      <p style={{ whiteSpace: "pre-wrap" }}>
                        {entry.role === "user"
                          ? entry.content
                          : entry.summary || "Proposed component"}
                      </p>
                    </li>
                  ))}
                </ol>
                <p className="muted">
                  Up to {AI_LIMITS.transcriptMessages / 2} turns stay in this
                  session. New conversation clears them; chat is never saved in
                  a project.
                </p>
              </details>
            ) : null}
            <p role="status" aria-label="AI modeling status">
              {status}
            </p>
            {configError ? <p role="alert">{configError}</p> : null}
            {!configError &&
            providers.length > 0 &&
            !providers.some((p) => p.available) ? (
              <p role="alert">
                No AI keys are configured. Set ANTHROPIC_API_KEY,
                OPENAI_API_KEY, or GOOGLE_API_KEY/GEMINI_API_KEY on the local
                server and restart it.
              </p>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            {error &&
            reply &&
            !busy &&
            replyFrame &&
            currentAiFrame(replyFrame) ? (
              <button
                type="button"
                onClick={() => {
                  const repair = prepareAiRepairPrompt(prompt, error);
                  cancel(repair.notice);
                  setPrompt(repair.text);
                  setError("");
                  input.current?.focus();
                }}
              >
                Use preview diagnostic in next description
              </button>
            ) : null}
            {reply ? (
              <>
                <strong>{reply.name}</strong>
                <p>{reply.summary}</p>
                {reply.parameters.length ? (
                  <fieldset>
                    <legend>Proposed dimensions</legend>
                    {reply.parameters.map((parameter) => (
                      <label key={parameter.name}>
                        Proposed {parameter.name} ({parameter.unit})
                        <input
                          inputMode="decimal"
                          maxLength={64}
                          value={
                            dimensionDrafts[parameter.name] ??
                            String(parameter.value)
                          }
                          disabled={!canPreviewDimensions}
                          onChange={(event) => {
                            cancel(
                              "Dimensions changed. Preview edited dimensions before Apply.",
                            );
                            setError("");
                            setDimensionDrafts((values) => ({
                              ...values,
                              [parameter.name]: event.target.value,
                            }));
                          }}
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      disabled={!canPreviewDimensions}
                      onClick={() => void previewDimensions()}
                    >
                      Preview dimension changes
                    </button>
                    <p className="muted">
                      Adjust numeric values in the displayed units, then preview
                      locally. Geometry is rebuilt before Apply; no AI request
                      is needed.
                    </p>
                  </fieldset>
                ) : null}
                {reply.warnings.length ? (
                  <ul>
                    {reply.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
            {proposal && current ? (
              <>
                {proposal.staged.changes ? (
                  <ul aria-label="Proposed parameter changes">
                    {proposal.staged.changes.map((change) => (
                      <li key={change.name}>
                        {change.name}: {change.before} → {change.after}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ExtrudePreview
                  meshes={proposal.geometry.meshes}
                  label="Native AI component preview"
                />
                <p>
                  {proposal.staged.bodyIds.length} native{" "}
                  {proposal.staged.bodyIds.length === 1 ? "body" : "bodies"} ·{" "}
                  {proposal.geometry.volume.toFixed(3)} mm³
                </p>
                <details>
                  <summary>
                    Modeling steps ({proposal.plan.steps.length})
                  </summary>
                  <ol>
                    {proposal.plan.steps.map((step) => (
                      <li key={step.id}>
                        {step.name} · {step.type}
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
