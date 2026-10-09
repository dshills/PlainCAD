import { useEffect, useRef, useState } from "react";
import { useCommandPlan } from "../../state/commandPlanState";
import { useCadStore } from "../../state/useCadStore";
import { useWorkbenchState } from "../../state/useWorkbenchState";
import { useAiCanvasPreview } from "../../state/aiCanvasPreview";
import { executeCommand, isRegisteredCommandAvailable } from "../../commands/registry";
import { AiCanvasPreviewControls } from "./AiCanvasPreviewControls";

export function CommandPlanPanel() {
  const { status, frame, progress, error } = useCommandPlan();
  useAiCanvasPreview(state => state.preview);
  const executing = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { useWorkbenchState.getState().showRight("task"); }, []);
  const run = async (command: string) => {
    if (executing.current || command === "plan.apply" && !frame) return;
    executing.current = true; setBusy(true);
    try {
      const response = await executeCommand({ command, session: useCadStore.getState().documentSession,
        arguments: command === "plan.apply" ? { planId: frame!.id } : {} });
      if (!response.ok) useCadStore.getState().setFileError(response.error.message);
    } catch (error) { useCadStore.getState().setFileError(error instanceof Error ? error.message : "Command plan action failed."); }
    finally { executing.current = false; setBusy(false); }
  };
  if (status === "idle") return null;
  return <section className="panel" aria-label="Command plan preview">
    <h2>{frame?.label ?? "Command plan"}</h2>
    <p>Your accepted project stays unchanged until you apply this plan.</p>
    {status === "previewing" ? <p role="status">{progress}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {status === "ready" && frame ? <>
      <p>{frame.steps} command{frame.steps === 1 ? "" : "s"} · native geometry validated</p>
      <ul>{frame.result?.meshes.map(mesh => <li key={mesh.bodyId}>
        {mesh.geometryAssertions?.solidCount} solid · {mesh.geometryAssertions?.volume.toFixed(2)} mm³
      </li>)}</ul>
      <AiCanvasPreviewControls />
      <p>Apply creates one history step. Undo restores the previous project.</p>
    </> : null}
    <div className="ai-actions">
      <button type="button" disabled={busy || status !== "ready" || !frame || !isRegisteredCommandAvailable("plan.apply", "domain")} onClick={() => void run("plan.apply")}>Apply command plan</button>
      <button type="button" disabled={busy} onClick={() => void run("plan.cancel")}>{status === "failed" ? "Dismiss command plan" : "Cancel command plan"}</button>
    </div>
  </section>;
}
