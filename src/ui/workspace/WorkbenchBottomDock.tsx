import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbenchState } from "../../state/useWorkbenchState";
import { useAiDrawer } from "../commands/aiCommand";
import { runCommand, type CommandContext } from "../commands/commandRegistry";
import { useCadStore } from "../../state/useCadStore";
import { FeatureTimeline } from "../panels/FeatureTimeline";
import { RebuildErrorsPanel } from "../panels/RebuildErrorsPanel";
import {
  ClockCounterClockwiseIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "../design-system/Icons";
import { RetainedPanel } from "./RetainedPanel";
import { DockResize } from "./DockResize";
import { AiDockContent } from "./AiDockContent";
import { actionableIssueCount } from "./diagnosticPresentation";
export function WorkbenchBottomDock({
  context,
  enabled,
}: {
  context: CommandContext;
  enabled: boolean;
}) {
  const dock = useWorkbenchState(
    useShallow(({ bottomTab, bottomOpen, showBottom }) => ({
      bottomTab,
      bottomOpen,
      showBottom,
    })),
  );
  const aiOpen = useAiDrawer((state) => state.open);
  const rebuild = useCadStore((state) => state.rebuild);
  const documentId = useCadStore((state) => state.history.present.id);
  const fileError = useCadStore((state) => state.fileError);
  const settled = rebuild.status === "succeeded" || rebuild.status === "failed";
  const issues = (settled && rebuild.result?.documentId === documentId
    ? actionableIssueCount(rebuild.result) : 0) + (fileError ? 1 : 0) +
    (rebuild.status === "failed" && !rebuild.result ? 1 : 0);
  const toggleAi = useCallback(async () => {
    try {
      await runCommand("ai.toggle");
    } catch {
      useCadStore.getState().setFileError("Command failed: Toggle AI assistant. Please try again.");
    }
  }, []);
  const closeAi = useCallback(async () => {
    try {
      await runCommand("ai.close");
    } catch {
      useCadStore.getState().setFileError("Command failed: Close AI assistant. Please try again.");
    }
  }, []);
  const previousAiOpen = useRef(false);
  // An AI command opens its tab; switching/collapsing the dock closes AI.
  useEffect(() => {
    const justOpened = aiOpen && !previousAiOpen.current;
    previousAiOpen.current = aiOpen;
    const current = useWorkbenchState.getState();
    if (justOpened) current.showBottom("ai");
    else if (aiOpen && (!current.bottomOpen || current.bottomTab !== "ai")) void closeAi();
    else if (!aiOpen && current.bottomTab === "ai" && current.bottomOpen)
      useWorkbenchState.setState({ bottomOpen: false });
  }, [aiOpen, dock.bottomTab, dock.bottomOpen, closeAi]);
  const tab = dock.bottomTab;
  const open = dock.bottomOpen && (tab === "ai" ? aiOpen : enabled);
  const aiVisible = open && aiOpen && tab === "ai";
  const close = () => {
    if (tab === "ai") void closeAi();
    else useWorkbenchState.setState({ bottomOpen: false });
    window.document.getElementById(tab === "ai" ? "workbench-ai-toggle" : tab === "issues" ? "workbench-issues-toggle" : "workspace-history-toggle")?.focus();
  };
  return (
    <section
      className={`workbench-bottom${open ? " expanded" : ""}`}
      aria-label={enabled ? "History, AI and issues" : "AI dock"}
    >
      <div
        className="dock-header bottom-tabs"
        role="group"
        aria-label="Bottom dock tabs"
      >
        {enabled ? <button
          type="button"
          id="workspace-history-toggle"
          aria-expanded={open && tab === "history"}
          aria-controls="workspace-history"
          aria-pressed={open && tab === "history"}
          onClick={() => {
            if (open && tab === "history") close();
            else dock.showBottom("history");
          }}
        >
          <ClockCounterClockwiseIcon size={18} aria-hidden={true} />
          History
        </button> : null}
        <button
          type="button"
          id="workbench-ai-toggle"
          aria-label={aiVisible ? "Close AI assistant" : "Open AI assistant"}
          aria-expanded={aiVisible}
          aria-controls="workbench-ai"
          aria-pressed={aiVisible}
          onClick={() => { if (aiVisible) close(); else void toggleAi(); }}
        >
          <SparkleIcon size={18} aria-hidden={true} />
          AI
        </button>
        {enabled ? <button
          type="button"
          id="workbench-issues-toggle"
          aria-pressed={open && tab === "issues"}
          aria-expanded={open && tab === "issues"}
          aria-controls="workbench-issues"
          className={issues ? "has-issues" : ""}
          onClick={() => {
            if (open && tab === "issues") close();
            else dock.showBottom("issues");
          }}
        >
          <WarningCircleIcon size={18} aria-hidden={true} />
          Issues{issues ? ` (${issues})` : ""}
        </button> : null}
        <span className="bottom-hint">
          {open ? "" : "Local project · changes stay on this device"}
        </span>
        {open ? (
          <button
            type="button"
            className="dock-close"
            aria-label="Close bottom dock"
            onClick={close}
          >
            <XIcon size={16} aria-hidden={true} />
          </button>
        ) : null}
      </div>
      {enabled ? <div
        hidden={!open || tab !== "history"}
        id="workspace-history"
        className="bottom-dock-body"
      >
        <RetainedPanel visible={open && tab === "history"}>
          <FeatureTimeline commandContext={context} />
        </RetainedPanel>
      </div> : null}
      {enabled ? <div
        hidden={!open || tab !== "issues"}
        id="workbench-issues"
        className="bottom-dock-body"
      >
        <RetainedPanel visible={open && tab === "issues"}>
          <RebuildErrorsPanel />
        </RetainedPanel>
      </div> : null}
      <div hidden={!aiVisible} id="workbench-ai" className="bottom-dock-body" onKeyDown={event => {
        if (aiVisible && event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented && !window.document.querySelector("dialog[open]")) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}>
        <RetainedPanel visible={aiVisible}><AiDockContent visible={aiVisible} /></RetainedPanel>
      </div>
      {open ? <DockResize dock="bottom" /> : null}
    </section>
  );
}
