import { lazy, Suspense, useEffect, useRef } from "react";
import { useAiDrawer } from "../commands/aiCommand";
import { runCommand } from "../commands/commandRegistry";
import { LazyPanelBoundary } from "../design-system/LazyPanelBoundary";
import { SparkleIcon } from "../design-system/Icons";
import { useCadStore } from "../../state/useCadStore";
import { RetainedPanel } from "./RetainedPanel";
import "./AiCanvasAssistant.css";

const AiDrawer = lazy(() => import("../panels/AiDrawer").then(module => ({ default: module.AiDrawer })));

function CanvasContent({ open }: { open: boolean }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) Array.from(content.current?.querySelectorAll<HTMLTextAreaElement>("textarea") ?? [])
      .find(input => !input.closest("[hidden]"))?.focus();
  }, [open]);
  return <div ref={content}><AiDrawer embedded /></div>;
}

/** The assistant shares the modeling canvas; opening it never resizes a dock. */
export function AiCanvasAssistant() {
  const open = useAiDrawer(state => state.open);
  const toggle = async () => {
    try {
      await runCommand("ai.toggle");
    } catch {
      useCadStore.getState().setFileError("Command failed: Toggle AI assistant. Please try again.");
    }
  };
  const close = async () => {
    if (useAiDrawer.getState().open) await toggle();
    if (!useAiDrawer.getState().open) window.document.getElementById("workbench-ai-toggle")?.focus();
  };
  return <div className={`ai-canvas-assistant${open ? " expanded" : ""}`} onKeyDown={event => {
    if (open && event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented && !window.document.querySelector("dialog[open]")) {
      event.preventDefault();
      event.stopPropagation();
      void close();
    }
  }}>
    <div className="ai-canvas-header">
      <button type="button" id="workbench-ai-toggle"
        aria-expanded={open} aria-controls="ai-canvas-content" onClick={() => {
          if (open) void close();
          else void toggle();
        }}>
        <SparkleIcon size={18} aria-hidden={true} />
        {open ? "Close AI assistant" : "Open AI assistant"}
      </button>
      {open ? <span>Work directly on your model</span> : null}
    </div>
    <div id="ai-canvas-content" hidden={!open} className="ai-canvas-content">
      <RetainedPanel visible={open}>
        <LazyPanelBoundary label="AI assistant">
          <Suspense fallback={<p role="status">Loading AI assistant…</p>}>
            <CanvasContent open={open} />
          </Suspense>
        </LazyPanelBoundary>
      </RetainedPanel>
    </div>
  </div>;
}
