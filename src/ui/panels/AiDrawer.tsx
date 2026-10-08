import { resolveAiFollowUp, type FailedAiRequest } from "../../ai/followUp";
import { aiHistoryIntent, handleAiHistoryPrompt } from "../commands/aiHistoryPrompt";
import { AiCanvasHistoryControls } from "./AiCanvasHistoryControls";
import { useSolidDimensionEdit } from "../commands/solidDimensionCommand";
import { SketchRefinementPanel } from "./SketchRefinementPanel";
import { useHoleDraft } from "../commands/holeCommand";
import { useGuidedHole } from "../commands/guidedHoleCommand";
import { useOperationDrop } from "../commands/operationDropCommand";
import { useExtrudeDraft } from "../commands/extrudeCommand";
import { useModelingDraft } from "../commands/modelingDraftCommand";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAiProviders, requestAiPlan } from "../../ai/client";
import { buildAiPlan } from "../../ai/buildPlan";
import { aiEditContext, buildAiParameterEdit } from "../../ai/editPlan";
import {
  aiFeatureEditContext,
  buildAiFeatureEdit,
} from "../../ai/featureEditPlan";
import {
  assertAiIntentPlan,
  resolveAiIntent,
  type AiScope,
  type AiIntent,
} from "../../ai/contextualIntent";
import {
  aiClarificationTargets,
  aiDimensionLabel,
  type AiClarificationTarget,
} from "../../ai/clarificationTargets";
import { showGeometryHighlight } from "../../state/useGeometryHighlight";
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
import { clearAiCanvasPreview, currentAiCanvasPreview, publishAiCanvasPreview, useAiCanvasPreview, type AiCanvasPreview } from "../../state/aiCanvasPreview";
import { AiCanvasPreviewControls } from "./AiCanvasPreviewControls";
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
import { AiFeatureAdditionPanel } from "./AiFeatureAdditionPanel";
import { selectionAiTarget, assertSelectionAiPlan, type SelectionAiTarget } from "../../ai/selectionTarget";
import { facePocketFaces } from "../commands/facePocketCommand";
import { useAiFacePicking, clearAiFacePicking } from "../../state/aiFacePicking";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { hiddenViewerBodies, useViewerState } from "../../state/viewerState";
import { useShallow } from "zustand/react/shallow";

interface CanvasAiDraftFrame extends AiDraftFrame { beforeResult?: RebuildResult }
interface Proposal {
  frame: CanvasAiDraftFrame;
  canvasPreview: AiCanvasPreview;
  plan: AiPlan;
  staged: AiStaged;
  result: RebuildResult;
  operationResult?: RebuildResult;
  geometry: ReturnType<typeof assertAiGeometry>;
}
type Message = AiMessage & { summary?: string; display?: string };
export function AiDrawer({ embedded = false }: { embedded?: boolean }) {
  const open = useAiDrawer((state) => state.open), canvas = useSketchCanvas((state) => state.active);
  const [mode, setMode] = useState<"auto" | "ordinary" | "features">(embedded ? "auto" : "ordinary");
  const [followVersion, setFollowVersion] = useState(0);
  const state = useCadStore(useShallow(state => ({ history: state.history, activeComponentId: state.activeComponentId, selection: state.selection, rebuild: state.rebuild, fileBusy: state.fileBusy, documentSession: state.documentSession })));
  const visibility = useViewerState(useShallow(state => [state.session, state.hiddenBodyIds, state.hiddenComponentIds]));
  const target = useMemo(() => selectionAiTarget(state.history.present, state.activeComponentId, state.selection.selectedIds,
    state.rebuild.status === "succeeded" ? state.rebuild.result : undefined, facePocketFaces(),
    hiddenViewerBodies(state.history.present, state.rebuild.result?.meshes.map(mesh => mesh.bodyId) ?? [], state.documentSession, useViewerState.getState())),
    [state.history.present, state.activeComponentId, state.selection, state.rebuild, state.fileBusy, state.documentSession, visibility]);
  const featureActive = Boolean(open && !canvas && (mode === "features" || (mode === "auto" && target.kind === "face")));
  useEffect(() => { if (!open) clearAiFacePicking(); }, [open]);
  return <div className="ai-mode-shell">
    {open ? <AiCanvasHistoryControls /> : null}
    {open && !canvas ? <div role="group" aria-label="AI modeling mode" className="ai-actions" title="Descriptions and conversations are kept when switching modes. Pending previews are canceled.">
      <button type="button" aria-pressed={!featureActive} onClick={() => setMode("ordinary")}>Describe or edit a part</button>
      <button type="button" aria-pressed={featureActive} onClick={() => setMode("features")}>Add features to this part</button>
      {embedded ? <button type="button" onClick={() => { setMode("auto"); setFollowVersion(value => value + 1); }}>Follow current selection</button> : null}
    </div> : null}
    <section hidden={!featureActive} className="ai-drawer open" aria-label="AI modeling assistant">
      {!embedded ? <button type="button" onClick={() => void runCommand("ai.toggle")}>Close AI drawer</button> : null}
      <AiFeatureAdditionPanel active={featureActive} targetFaceId={mode === "auto" ? target.faceId : undefined} />
    </section>
    <div hidden={featureActive} className="ai-mode-pane"><StandardAiDrawer embedded={embedded} active={!featureActive} target={target} followVersion={followVersion} /></div>
  </div>;
}
function StandardAiDrawer({ embedded = false, active = true, target, followVersion }: { embedded?: boolean; active?: boolean; target: SelectionAiTarget; followVersion: number }) {
  // Layout seeds the initial disclosure; later layout changes preserve the user’s choice.
  const [settingsOpen, setSettingsOpen] = useState(
    () => useWorkspaceState.getState().layout === "full",
  );
  const drawerOpen = useAiDrawer((state) => state.open);
  const open = drawerOpen && active;
  const namedPart = useAiDrawer((state) => state.namedPart);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const componentId = useCadStore((state) => state.activeComponentId);
  const selections = useCadStore((state) => state.selection.selectedIds);
  const selected = selections[0];
  const facePicking = useAiFacePicking(state => state.frame);
  const facePickMessage = useAiFacePicking(state => state.message);
  const commandEnablement = useCommandEnablement();
  const selectedFeatureId =
    selected?.kind === "feature" && selected.documentId === document.id
      ? selected.id
      : undefined;
  const fileBusy = useCadStore((state) => state.fileBusy);
  const kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const rebuildResult = useCadStore((state) => state.rebuild.result);
  const rebuildStatus = useCadStore((state) => state.rebuild.status);
  const canvasActive = Boolean(useSketchCanvas((state) => state.active));
  const operationPickerActive = Boolean(
    useOperationDrop((state) => state.frame),
  );
  const operationExtrudeActive = Boolean(
    useExtrudeDraft((state) => state.draft),
  );
  const operationModelingActive = Boolean(
    useModelingDraft((state) => state.draft),
  );
  const holeActive = Boolean(useHoleDraft((state) => state.draft));
  const guidedHoleActive = Boolean(useGuidedHole((state) => state.draft));
  const solidDimensionActive = Boolean(useSolidDimensionEdit((state) => state.frame));
  const operationActive =
    solidDimensionActive ||
    operationPickerActive ||
    operationExtrudeActive ||
    operationModelingActive ||
    holeActive ||
    guidedHoleActive;

  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [manualScope, setTask] = useState<AiScope | undefined>(embedded ? undefined : "create");
  const task = manualScope ?? target.scope;
  const automatic = manualScope === undefined;
  const [chosenTarget, setChosenTarget] = useState<string>();
  const [clarifying, setClarifying] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<string>();
  const [failedRequest, setFailedRequest] = useState<{ frame: CanvasAiDraftFrame; request: FailedAiRequest }>();
  const continuedApply = useRef<{ document: CanvasAiDraftFrame["document"]; session: number; componentId: string; selection: string; scope: AiScope; featureId?: string } | undefined>(undefined);
  const followUp = useMemo(() => resolveAiFollowUp(prompt,
    failedRequest && currentAiFrame(failedRequest.frame) && rebuildResult === failedRequest.frame.beforeResult
      ? failedRequest.request : undefined), [prompt, failedRequest, document, session, componentId, selections, operationActive, rebuildResult, rebuildStatus]);
  useEffect(() => {
    if (failedRequest && (!currentAiFrame(failedRequest.frame) || rebuildResult !== failedRequest.frame.beforeResult)) setFailedRequest(undefined);
  }, [failedRequest, document, session, componentId, selections, operationActive, rebuildResult]);
  const editingFeatureId = task === "feature" ? selectedFeatureId : undefined;
  const editing = useMemo(() => {
    if (task === "create") return {};
    if (automatic) {
      if (target.diagnostic) return { error: target.diagnostic };
      if (target.kind === "sketch") return { error: "Open this sketch to draw or refine its dimensions with AI." };
      if (target.kind === "face") return { error: "Use Add features to this part for the selected face, or choose a scope explicitly." };
      if (target.context) return { context: target.context };
    }
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
  }, [document, componentId, task, editingFeatureId, automatic, target]);
  const intent = useMemo<AiIntent>(() => {
    try {
      return followUp.clarification ? followUp : resolveAiIntent(task, followUp.prompt, editing.context, chosenTarget);
    } catch (failure) {
      return {
        prompt: followUp.prompt,
        clarification:
          failure instanceof Error
            ? failure.message
            : "Describe a valid dimension.",
      };
    }
  }, [task, followUp, editing.context, chosenTarget]);
  const clarification = useMemo(() => {
    if (!clarifying || !intent.choices) return { targets: [] };
    try {
      return {
        targets: aiClarificationTargets(
          document,
          componentId,
          task,
          intent.choices,
          rebuildResult,
          editingFeatureId,
        ),
      };
    } catch {
      // Existing bounded context remains authoritative if read-only dependency
      // tracing fails. Choosing still requires the normal fresh native preview.
      const targets = intent.choices.flatMap((choice) => {
        const dimension = editing.context?.parameters.find(
          (p) => p.id === choice.id && p.name === choice.name,
        );
        return dimension
          ? [
              {
                dimension,
                label: aiDimensionLabel(dimension.name),
                bodyIds: [],
                bodyNames: [],
              },
            ]
          : [];
      });
      return {
        targets,
        geometryError:
          "Related geometry is unavailable. You can choose an allowed dimension and inspect a fresh native preview.",
      };
    }
  }, [
    clarifying,
    intent.choices,
    document,
    componentId,
    task,
    rebuildResult,
    editingFeatureId,
    editing.context,
  ]);
  const clarificationTargets: AiClarificationTarget[] = clarification.targets;
  useEffect(() => {
    setHighlightTarget(undefined);
  }, [
    open,
    document,
    session,
    componentId,
    selected,
    task,
    prompt,
    fileBusy,
    canvasActive,
    clarifying,
    rebuildStatus,
    operationActive,
  ]);
  useEffect(() => {
    if (
      !open ||
      !clarifying ||
      fileBusy ||
      canvasActive ||
      operationActive ||
      rebuildStatus !== "succeeded"
    )
      return;
    const target = clarificationTargets.find(
      (item) => item.dimension.id === highlightTarget,
    );
    if (!target) return;
    return showGeometryHighlight({
      document,
      session,
      componentId,
      result: rebuildResult,
      source: "ai",
      bodyIds: target.bodyIds,
      sketchId: target.sketchId,
      sketchEntityIds: target.sketchEntityIds,
    });
  }, [
    open,
    clarifying,
    fileBusy,
    canvasActive,
    clarificationTargets,
    highlightTarget,
    document,
    session,
    componentId,
    rebuildResult,
    rebuildStatus,
    operationActive,
  ]);
  useEffect(() => {
    if (!open || !automatic || clarifying || fileBusy || operationActive || rebuildStatus !== "succeeded" || target.diagnostic) return;
    if (!target.bodyIds.length && !target.sketchId) return;
    return showGeometryHighlight({ document, session, componentId, result: rebuildResult, source: "ai", bodyIds: target.bodyIds, sketchId: target.sketchId });
  }, [open, automatic, clarifying, fileBusy, operationActive, rebuildStatus, target, document, session, componentId, rebuildResult]);
  const requestContext = useMemo(() => {
    if (!editing.context || !intent.target) return editing.context;
    return {
      ...editing.context,
      parameters: editing.context.parameters.filter(
        (p) => p.name === intent.target,
      ),
    };
  }, [editing.context, intent.target]);
  const [history, setHistory] = useState<Message[]>([]);
  const [reply, setReply] = useState<AiPlan>();
  const [dimensionDrafts, setDimensionDrafts] = useState<
    Record<string, string>
  >({});
  const [replyFrame, setReplyFrame] = useState<CanvasAiDraftFrame>();
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
          task !== "create" ? requestContext : undefined,
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
  }, [provider, model, history, task, requestContext]);
  const conversation = useMemo(() => {
    try {
      return {
        prepared: conversationBudget.prepare?.(intent.prompt),
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
  }, [conversationBudget, intent.prompt]);
  useEffect(() => {
    preference.current = { provider, model };
  }, [provider, model]);
  const ownedCanvasPreview = useRef<AiCanvasPreview | undefined>(undefined);
  const canvasPreview = useAiCanvasPreview(state => state.preview);
  const clearCanvasProposal = useCallback(() => {
    if (ownedCanvasPreview.current) clearAiCanvasPreview(ownedCanvasPreview.current);
    ownedCanvasPreview.current = undefined;
  }, []);
  useEffect(() => () => clearCanvasProposal(), [clearCanvasProposal]);
  const displayProposal = (base: CanvasAiDraftFrame, staged: AiStaged, result: RebuildResult) => {
    if (!publishAiCanvasPreview({ document: base.document, session: base.session, componentId: base.componentId,
      selection: base.selection, beforeResult: base.beforeResult, result, bodyIds: staged.bodyIds }))
      throw new Error("Project, selection or accepted geometry changed. Generate a fresh native preview.");
    const published = useAiCanvasPreview.getState().preview;
    if (!published) throw new Error("The native canvas preview is unavailable. Generate a fresh preview.");
    ownedCanvasPreview.current = published;
    return published;
  };
  const cancel = useCallback((message = "Request canceled. The project is unchanged.") => {
    controller.current?.abort();
    controller.current = undefined;
    clearCanvasProposal();
    frame.current = undefined;
    setBusy(false);
    setProposal(undefined);
    setStatus(message);
  }, []);
  useEffect(() => {
    if (!namedPart) return;
    if (!open || namedPart.document !== document || namedPart.session !== session) {
      useAiDrawer.setState({ namedPart: undefined });
      return;
    }
    cancel("Describe your named part, then review its native preview before Apply.");
    setTask("create");
    setPrompt(`Make a part named "${namedPart.name}". `);
    setHistory([]);
    setReply(undefined);
    setError("");
    setChosenTarget(undefined);
    setClarifying(false);
  }, [namedPart, open, document, session, cancel]);
  useEffect(() => {
    if (!followVersion) return;
    cancel("Following the current selected target. Generate a fresh preview.");
    setTask(undefined); setHistory([]); setReply(undefined); setError(""); setChosenTarget(undefined); setClarifying(false);
  }, [followVersion, cancel]);
  useEffect(() => {
    if (proposal && canvasPreview !== proposal.canvasPreview)
      cancel("The native canvas preview closed. Generate a fresh preview before Apply.");
  }, [proposal, canvasPreview, cancel]);
  const current = proposal && currentAiFrame(proposal.frame) && canvasPreview === proposal.canvasPreview && Boolean(currentAiCanvasPreview(useCadStore.getState()));
  const nativeSourceReady = rebuildStatus === "succeeded" && rebuildResult?.success && rebuildResult.documentId === document.id;
  const canGenerate = !busy && !fileBusy && Boolean(prompt.trim()) &&
    (Boolean(aiHistoryIntent(prompt)) || (
      nativeSourceReady && !canvasActive && !operationActive && kernelReady &&
      prompt.length <= AI_LIMITS.promptCharacters &&
      (Boolean(intent.localPlan || intent.clarification) ||
        (/^[A-Za-z0-9._-]{1,100}$/.test(model) && !configError && !conversation.error &&
          providers.some((p) => p.id === provider && p.available))) &&
      !editing.error && (task === "create" || Boolean(editing.context?.parameters.length))));
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
    if (frame.current && (operationActive || !currentAiFrame(frame.current)))
      cancel(
        "Project, component or active operation changed. Generate a fresh preview.",
      );
  }, [
    document,
    session,
    componentId,
    selectedFeatureId,
    selections,
    target,
    fileBusy,
    canvasActive,
    operationActive,
  ]);
  useEffect(() => {
    setHistory([]);
    setReply(undefined);
    setError("");
    setFailedRequest(undefined);
    continuedApply.current = undefined;
    setChosenTarget(undefined);
    setClarifying(false);
  }, [session]);
  const conversationSelection = automatic ? JSON.stringify(selections) : undefined;
  const previousConversation = useRef({ componentId, task, editingFeatureId, selection: conversationSelection });
  useEffect(() => {
    const continued = continuedApply.current;
    continuedApply.current = undefined;
    const ownApply = continued?.document === document && continued.session === session &&
      continued.componentId === componentId && continued.scope === task && continued.featureId === editingFeatureId &&
      continued.selection === JSON.stringify(selections);
    const previous = previousConversation.current;
    const contextChanged = previous.componentId !== componentId || previous.task !== task ||
      previous.editingFeatureId !== editingFeatureId || previous.selection !== conversationSelection;
    previousConversation.current = { componentId, task, editingFeatureId, selection: conversationSelection };
    if (contextChanged && !ownApply && task !== "create") {
      setHistory([]);
      setReply(undefined);
    }
    if (contextChanged || ownApply) {
      setChosenTarget(undefined);
      setClarifying(false);
    }
  }, [document, session, componentId, task, editingFeatureId, conversationSelection, selections]);
  useEffect(() => {
    if (
      chosenTarget &&
      !editing.context?.parameters.some((p) => p.name === chosenTarget)
    ) {
      setChosenTarget(undefined);
      setClarifying(false);
    }
  }, [editing.context, chosenTarget]);
  const requireFeatureId = (base: AiDraftFrame) => {
    if (!base.featureId)
      throw new Error("Select a feature before editing dimensions.");
    return base.featureId;
  };
  const generate = async () => {
    if (!canGenerate) return;
    if (aiHistoryIntent(prompt)) {
      cancel(); setError("");
      const outcome = handleAiHistoryPrompt(prompt);
      setStatus(outcome?.message ?? "AI history is unavailable.");
      return;
    }
    if (task === "feature" && !selectedFeatureId) {
      setError("Select a feature before generating dimension edits.");
      return;
    }
    if (intent.clarification) {
      setClarifying(true);
      setError("");
      setStatus(
        intent.choices?.length
          ? "Choose the dimension to change before generating a preview."
          : "Clarify your request or choose a different scope before generating a preview.",
      );
      return;
    }
    setClarifying(false);
    cancel();
    const abort = new AbortController(),
      timer = window.setTimeout(() => abort.abort(), 120000);
    controller.current = abort;
    const base: CanvasAiDraftFrame = {
      beforeResult: rebuildStatus === "succeeded" ? rebuildResult : undefined,
      document,
      session,
      componentId,
      selection: selections.map(item => ({ ...item })),
      ...(automatic ? { targetBodyIds: target.bodyIds } : {}),
      ...(task === "feature" ? { featureId: selectedFeatureId } : {}),
    };
    frame.current = base;
    setBusy(true);
    setError("");
    setFailedRequest(undefined);
    setReply(undefined);
    setStatus(
      intent.localPlan
        ? "Checking your dimension locally…"
        : "Asking AI to propose your part…",
    );
    const description = prompt.trim();
    const originalRequest = failedRequest && (followUp.prompt !== description ||
      description === prepareAiRepairPrompt(failedRequest.request.prompt, failedRequest.request.diagnostic).text)
      ? failedRequest.request.prompt : description;
    try {
      const generated =
        intent.localPlan ??
        (await requestAiPlan(
          provider,
          model,
          intent.prompt,
          history,
          abort.signal,
          task !== "create" ? requestContext : undefined,
        ));
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        !currentAiFrame(base)
      )
        return;
      const plan =
        task === "create" &&
        namedPart?.document === document &&
        namedPart.session === session
          ? { ...generated, name: namedPart.name }
          : generated;
      assertAiIntentPlan(intent, plan);
      if (automatic && task !== "create") assertSelectionAiPlan(target, plan);
      setReply(plan);
      setReplyFrame(base);
      setDimensionDrafts(
        Object.fromEntries(
          plan.parameters.map((p) => [p.name, String(p.value)]),
        ),
      );
      const nextHistory: Message[] = [
        ...history,
        { role: "user", content: intent.prompt, display: description },
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
      setFailedRequest(undefined);
      setProposal({
        canvasPreview: displayProposal(base, staged, result),
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
      const diagnostic = abort.signal.aborted ? "AI request timed out. Try a simpler description."
        : failure instanceof Error ? failure.message : "AI generation failed.";
      setError(diagnostic);
      if (abort.signal.aborted) setFailedRequest(undefined);
      else setFailedRequest({ frame: base, request: {
        prompt: originalRequest,
        diagnostic,
      } });
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
      if (automatic && task !== "create") assertSelectionAiPlan(target, plan);
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
        canvasPreview: displayProposal(base, staged, result),
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
      const applied = useCadStore.getState();
      if (embedded && automatic && !proposal.staged.editedFeature) {
        const bodyId = proposal.staged.bodyIds.length === 1 ? proposal.staged.bodyIds[0] : undefined;
        applied.select(bodyId ? { kind: "body", id: bodyId, documentId: applied.history.present.id } : undefined);
        setTask(bodyId ? undefined : "edit");
      }
      const after = useCadStore.getState();
      const nextScope = embedded && automatic && !proposal.staged.editedFeature ? "edit" : task;
      continuedApply.current = { document: after.history.present, session: after.documentSession,
        componentId: after.activeComponentId, selection: JSON.stringify(after.selection.selectedIds), scope: nextScope,
        featureId: nextScope === "feature" ? after.selection.selectedIds[0]?.id : undefined };
      setFailedRequest(undefined);
      clearCanvasProposal();
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
  function changeScope(scope: AiScope) {
    continuedApply.current = undefined; setFailedRequest(undefined);
    cancel("Scope changed. Generate a fresh preview.");
    setTask(scope);
    useAiDrawer.setState({ namedPart: undefined });
    setHistory([]);
    setReply(undefined);
    setError("");
    setChosenTarget(undefined);
    setClarifying(false);
  }
  function followSelection() {
    continuedApply.current = undefined; setFailedRequest(undefined);
    cancel("Following the current selected target. Generate a fresh preview.");
    setTask(undefined); setHistory([]); setReply(undefined); setError(""); setChosenTarget(undefined); setClarifying(false);
  }
  return (
    <section
      className={`ai-drawer${open ? " open" : ""}`}
      aria-label="AI modeling assistant"
    >
      <div className="ai-drawer-header" hidden={embedded}>
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
      {open && canvasActive ? <div id="ai-drawer-content"><SketchRefinementPanel /></div> : null}
      {open && !canvasActive ? (
        <div
          id="ai-drawer-content"
          className="ai-drawer-content"
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !event.nativeEvent.isComposing &&
              !window.document.querySelector("dialog[open]")
            ) {
              event.preventDefault();
              event.stopPropagation();
              void runCommand("ai.toggle");
              if (embedded)
                window.document.getElementById("workbench-ai-toggle")?.focus();
              else toggle.current?.focus();
            }
          }}
        >
          <div className="ai-composer">
            {!nativeSourceReady && !aiHistoryIntent(prompt) ? <p className="muted" aria-label="AI source readiness">
              {rebuildStatus === "failed" ? "Repair the current model’s diagnostics before generating a native AI preview." : "Waiting for the current native rebuild before generating a preview."}
            </p> : null}
              {embedded ? <div className="ai-actions" aria-label="AI selected target">
                <span>Target: <strong>{automatic ? target.label : task === "create" ? "New part" : task === "feature" ? editing.context?.feature?.name ?? "Selected feature" : document.components[componentId]?.name}</strong>{automatic ? " · follows selection" : " · explicit scope"}</span>
                <button type="button" disabled={busy || !commandEnablement.measurementPicking} onClick={() => void runCommand("ai.pickFace")}>Choose face on model</button>
                {facePicking ? <button type="button" onClick={() => void runCommand("ai.cancelFacePick")}>Cancel AI face selection</button> : null}
                {automatic && target.sketchId ? <button type="button" disabled={busy || !commandEnablement.sketchCanvas} onClick={() => void runCommand("sketch.editCanvas")}>Edit selected sketch with AI</button> : null}
              </div> : null}
              {facePickMessage ? <p role="status">{facePickMessage}</p> : null}
            <div className="ai-prompt-entry">
              <fieldset className="ai-scope" aria-label="AI scope">
                <legend>What do you want to work on?</legend>
                {embedded ? (
                  <select
                    aria-label="AI scope"
                    value={manualScope ?? "auto"}
                    disabled={busy}
                    onChange={(event) =>
                      event.target.value === "auto" ? followSelection() : changeScope(event.target.value as AiScope)
                    }
                  >
                    <option value="auto">Follow selection</option>
                    <option value="create">New part</option>
                    <option value="edit">This part</option>
                    <option value="feature">Selected feature</option>
                  </select>
                ) : (
                  <div className="ai-actions">
                    {(
                      [
                        ["create", "New part"],
                        ["edit", "This part"],
                        ["feature", "Selected feature"],
                      ] as const
                    ).map(([scope, label]) => (
                      <button
                        key={scope}
                        type="button"
                        aria-pressed={task === scope}
                        disabled={busy}
                        onClick={() => changeScope(scope)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>

              {namedPart ? (
                <p>
                  New part: <strong>{namedPart.name}</strong>. Nothing is added until Apply.
                </p>
              ) : null}
              <label htmlFor="ai-description">
                What would you like to make?
              </label>
              <textarea
                ref={input}
                id="ai-description"
                rows={embedded ? 2 : 3}
                maxLength={AI_LIMITS.promptCharacters}
                placeholder="A 60 × 40 × 5 mm plate with four 4 mm mounting holes, 6 mm from each corner…"
                value={prompt}
                disabled={busy}
                onChange={(event) => {
                  if (proposal)
                    cancel("Description changed. Generate a fresh preview.");
                  setPrompt(event.target.value);
                  setChosenTarget(undefined);
                  setClarifying(false);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    void generate();
                  }
                }}
              />
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
                    useAiDrawer.setState({ namedPart: undefined });
                    setHistory([]);
                    setReply(undefined);
                    setPrompt("");
                    setChosenTarget(undefined);
                    setClarifying(false);
                    setError("");
                    input.current?.focus();
                  }}
                >
                  New conversation
                </button>
              </div>
            </div>
            {intent.target ? (
              <p role="status" aria-label="AI edit target">
                Target:{" "}
                {editing.context?.feature?.name ??
                  editing.context?.componentName}{" "}
                → {intent.target}. Only this dimension will change.
              </p>
            ) : null}
            {clarifying && intent.clarification ? (
              <div role="status" aria-label="AI clarification">
                <p>{intent.clarification}</p>
                {!clarification.geometryError &&
                !fileBusy &&
                !canvasActive &&
                !operationActive &&
                rebuildStatus === "succeeded" &&
                clarificationTargets.some((target) => target.bodyIds.length) ? (
                  <p>
                    Show related geometry, then choose the dimension explicitly.
                    Highlighting does not select or edit it; the native preview
                    will show the exact change.
                  </p>
                ) : null}
                {clarificationTargets.some((target) => target.bodyIds.length) &&
                (fileBusy ||
                  canvasActive ||
                  operationActive ||
                  rebuildStatus !== "succeeded") ? (
                  <p className="muted">
                    Geometry highlighting is available when rebuilding and file
                    operations have finished, sketch editing is closed, and the
                    active modeling operation is finished.
                  </p>
                ) : null}
                {task === "feature" && clarificationTargets.length > 1 ? (
                  <p>
                    Dimensions of this feature share the related solid. Choose
                    by name and value, then inspect the exact native preview.
                  </p>
                ) : null}
                {clarification.geometryError ? (
                  <p>{clarification.geometryError}</p>
                ) : null}
                <div className="ai-actions">
                  {clarificationTargets.map((target) => {
                    const parameter = target.dimension;
                    const geometryReady =
                      !fileBusy &&
                      !canvasActive &&
                      !operationActive &&
                      rebuildStatus === "succeeded" &&
                      target.bodyIds.length > 0;
                    return (
                      <div
                        key={parameter.id}
                        className="ai-clarification-choice"
                      >
                        <p>
                          <strong>{target.label}</strong>: {parameter.value}
                          {parameter.unit}
                        </p>
                        <p className="muted">
                          {target.bodyNames.length
                            ? `Related geometry: ${target.bodyNames.join(", ")}.`
                            : "No current solid is linked to this dimension."}
                          {target.sketchId
                            ? ` Authoring sketch: ${document.sketches[target.sketchId]?.name ?? target.sketchId}.`
                            : ""}
                        </p>
                        <button
                          type="button"
                          disabled={!geometryReady}
                          aria-pressed={highlightTarget === parameter.id}
                          onClick={() =>
                            setHighlightTarget((current) =>
                              current === parameter.id
                                ? undefined
                                : parameter.id,
                            )
                          }
                        >
                          Show geometry for {target.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            cancel(
                              "Dimension chosen. Generate a fresh preview.",
                            );
                            setChosenTarget(parameter.name);
                            setHistory([]);
                            setReply(undefined);
                            setHighlightTarget(undefined);
                            setClarifying(false);
                          }}
                        >
                          Change {target.label} ({parameter.value}
                          {parameter.unit})
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
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
              Provider: {selectedProvider?.label ?? provider}
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
            <p className="muted" role="note" aria-label="AI next action">
              {task === "create"
                ? "Next: describe a part, review its dimensions and native preview, then Apply."
                : task === "feature"
                  ? "Next: select an Extrude, Hole or Revolve, then describe the dimension change."
                  : "Next: describe a named dimension change. Shared, locked and derived parameters cannot be edited here."}
              {intent.localPlan
                ? " This exact numeric edit will preview locally without an AI request."
                : ""}
            </p>
            <p className="muted">
              For AI requests, your description and recent conversation go to
              the selected provider. Exact numeric dimension edits preview
              locally.{" "}
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
            {operationActive ? (
              <p>
                Finish or cancel the current operation before generating or
                applying an AI edit.
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
                          ? (entry.display ?? entry.content)
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
                  const repair = prepareAiRepairPrompt(failedRequest?.request.prompt ?? prompt, failedRequest?.request.diagnostic ?? error);
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
                <AiCanvasPreviewControls />
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
