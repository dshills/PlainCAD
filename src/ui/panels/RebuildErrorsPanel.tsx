import { useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { runCommand } from "../commands/commandRegistry";
import { repairGuidance, selectionForRepairIssue, useRepairFocus, type RepairIssue } from "../commands/repairCommand";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { isOptionalSketchGuidance } from "../workspace/diagnosticPresentation";

export function RebuildErrorsPanel() {
  const rebuild = useCadStore((state) => state.rebuild);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const fileError = useCadStore((state) => state.fileError);
  const setFileError = useCadStore((state) => state.setFileError);
  const active = useSketchCanvas((state) => state.active);
  const focus = useRepairFocus((state) => state.focus);
  const enabled = useCommandEnablement();
  const [actionError, setActionError] = useState<{ document: typeof document; message: string }>();
  const result = rebuild.result;
  const current = result?.documentId === document.id && (rebuild.status === "succeeded" || rebuild.status === "failed");
  const guidance = current ? result.warnings.filter(isOptionalSketchGuidance) : [];
  const warnings = current ? result.warnings.filter((warning) => !isOptionalSketchGuidance(warning)) : [];
  const issueCard = (issue: RepairIssue, warning = false) => {
    if (!result) return null;
    const advice = current ? repairGuidance(issue, document, result) : undefined;
    const source = current ? selectionForRepairIssue(issue, document) : undefined;
    const canFocus = current && enabled.repairModel && Boolean(source) && (!active || (source?.kind === "sketch" && source.id === active.sketchId));
    const hintId = `repair-hint-${warning ? "warning" : "error"}-${encodeURIComponent(issue.id)}`;
    const hint = !current ? "Waiting for current model diagnostics." : !source ? "This diagnostic has no editable source. Inspect its message and model inputs." : !enabled.repairModel ? "Finish or cancel the current task before repairing model issues." : active && !canFocus ? "Finish the current sketch to inspect another source." : undefined;
    const run = (command: string) => {
      setActionError(undefined);
      try {
        const action = runCommand(command, { repair: { document, result, session, issueId: issue.id } });
        if (action instanceof Promise) void action.catch((error: unknown) => setActionError({ document, message: error instanceof Error ? error.message : "Repair could not be prepared." }));
      } catch (error) {
        setActionError({ document, message: error instanceof Error ? error.message : "Repair could not be prepared." });
      }
    };
    return <article key={`${warning ? "warning" : "error"}:${issue.id}`} className={`item-card repair-card ${warning ? "warning-text" : "error-text"}`}>
      <strong>{advice?.title ?? "Model diagnostics updating"}</strong>
      <button type="button" aria-label={`${issue.source}: ${issue.message}`} aria-describedby={hint ? hintId : undefined} disabled={!canFocus} onClick={() => run("repair.focus")}>
        {issue.source}: {issue.message}
      </button>
      <p>{advice?.guidance ?? "Wait for the current rebuild before choosing a repair."}</p>
      {source ? <button type="button" aria-describedby={hint ? hintId : undefined} disabled={!canFocus} onClick={() => run("repair.focus")}>Show and repair</button> : null}
      {advice?.closingEdge ? <button type="button" disabled={!canFocus || active?.sketchId !== advice.sketch?.id || focus?.document !== document || focus.session !== session || focus.sketchId !== advice.sketch?.id || focus.closingEdge?.startId !== advice.closingEdge.startId || focus.closingEdge.endId !== advice.closingEdge.endId} onClick={() => run("repair.closeOutline")}>Add missing closing edge</button> : null}
      {hint ? <p id={hintId} className="muted">{hint}</p> : null}
    </article>;
  };
  return <section className="panel" aria-labelledby="rebuild-heading">
    <h2 id="rebuild-heading">Rebuild</h2>
    <p className="muted">Status {rebuild.status}{result ? `, ${result.durationMs.toFixed(1)}ms, ${result.meshes.length} mesh(es)` : ""}</p>
    {fileError ? <button className="item-card error-text" onClick={() => setFileError(undefined)}>File: {fileError}</button> : null}
    {actionError?.document === document ? <p role="alert" className="error-text">{actionError.message}</p> : null}
    {!current && rebuild.status !== "failed" ? <p role="status">Updating model diagnostics…</p> : null}
    {rebuild.status === "failed" && !current ? <p role="alert" className="error-text">{rebuild.message ?? "Rebuild failed. Try rebuilding again to obtain model diagnostics."}</p> : null}
    {current ? result.errors.map((issue) => issueCard(issue)) : null}
    {warnings.map((issue) => issueCard(issue, true))}
    {current && result.success && !result.errors.length && !warnings.length && !fileError ? <p className="muted">No rebuild issues.</p> : null}
    {guidance.length ? <details className="sketch-guidance">
      <summary>Optional sketch guidance ({guidance.length})</summary>
      <p className="muted">These sketches can still move. You can model from a closed outline now, or add dimensions and constraints when you need precise control.</p>
      {guidance.map((issue) => <p key={issue.id}>{document.sketches[issue.sourceId ?? ""]?.name ?? "Sketch"}: {issue.message}</p>)}
    </details> : null}
  </section>;
}
