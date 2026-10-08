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
  const tab = dock.bottomTab === "ai" ? "history" : dock.bottomTab;
  const open = dock.bottomOpen && dock.bottomTab !== "ai";
  const close = () => {
    useWorkbenchState.setState({ bottomOpen: false });
    window.document.getElementById(tab === "issues" ? "workbench-issues-toggle" : "workspace-history-toggle")?.focus();
  };
  if (!enabled) return null;
  return (
    <section
      className={`workbench-bottom${open ? " expanded" : ""}`}
      aria-label="History and issues"
    >
      <div
        className="dock-header bottom-tabs"
        role="group"
        aria-label="Bottom dock tabs"
      >
        <button
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
        </button>
        <button
          type="button"
          id="workbench-ai-launcher"
          aria-label="Toggle AI assistant"
          aria-expanded={aiOpen}
          aria-controls="ai-canvas-content"
          aria-pressed={aiOpen}
          onClick={async () => {
            try {
              await runCommand("ai.toggle");
            } catch {
              useCadStore.getState().setFileError("Command failed: Toggle AI assistant. Please try again.");
            }
          }}
        >
          <SparkleIcon size={18} aria-hidden={true} />
          AI
        </button>
        <button
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
        </button>
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
      <div
        hidden={!open || tab !== "history"}
        id="workspace-history"
        className="bottom-dock-body"
      >
        <RetainedPanel visible={open && tab === "history"}>
          <FeatureTimeline commandContext={context} />
        </RetainedPanel>
      </div>
      <div
        hidden={!open || tab !== "issues"}
        id="workbench-issues"
        className="bottom-dock-body"
      >
        <RetainedPanel visible={open && tab === "issues"}>
          <RebuildErrorsPanel />
        </RetainedPanel>
      </div>
      {open ? <DockResize dock="bottom" /> : null}
    </section>
  );
}
