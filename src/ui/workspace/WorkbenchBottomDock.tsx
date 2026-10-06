import { useShallow } from "zustand/react/shallow";
import { useEffect } from "react";
import { useWorkbenchState } from "../../state/useWorkbenchState";
import { useAiDrawer } from "../commands/aiCommand";
import { runCommand, type CommandContext } from "../commands/commandRegistry";
import { useCadStore } from "../../state/useCadStore";
import { AiDrawer } from "../panels/AiDrawer";
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
  const issues =
    (rebuild.result?.errors.length ?? 0) +
    (rebuild.result?.warnings.length ?? 0);
  // Commands elsewhere (e.g. start screen or palette) open this same AI surface.
  useEffect(() => {
    if (!enabled) return;
    if (aiOpen) useWorkbenchState.getState().showBottom("ai");
    else if (useWorkbenchState.getState().bottomTab === "ai")
      useWorkbenchState.setState({ bottomOpen: false });
  }, [enabled, aiOpen]);
  const tab = aiOpen ? "ai" : dock.bottomTab;
  const open = aiOpen || dock.bottomOpen;
  const close = () => {
    if (aiOpen) void runCommand("ai.toggle");
    useWorkbenchState.setState({ bottomOpen: false });
    window.document
      .getElementById(
        aiOpen
          ? "workbench-ai-toggle"
          : dock.bottomTab === "issues"
            ? "workbench-issues-toggle"
            : "workspace-history-toggle",
      )
      ?.focus();
  };
  return (
    <section
      className={
        enabled
          ? `workbench-bottom${open ? " expanded" : ""}`
          : "legacy-ai-container"
      }
      aria-label={enabled ? "History, AI and issues" : undefined}
    >
      {enabled ? (
        <>
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
                if (aiOpen) void runCommand("ai.toggle");
                if (open && tab === "history") close();
                else dock.showBottom("history");
              }}
            >
              <ClockCounterClockwiseIcon size={18} aria-hidden={true} />
              History
            </button>
            <button
              type="button"
              id="workbench-ai-toggle"
              aria-label={aiOpen ? "Close AI drawer" : "Open AI drawer"}
              aria-expanded={aiOpen}
              aria-controls="ai-drawer-content"
              aria-pressed={aiOpen}
              onClick={() => {
                if (aiOpen) close();
                else void runCommand("ai.toggle");
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
                if (aiOpen) void runCommand("ai.toggle");
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
        </>
      ) : null}
      <div hidden={enabled && (!open || tab !== "ai")}>
        <AiDrawer embedded={enabled} />
      </div>
    </section>
  );
}
