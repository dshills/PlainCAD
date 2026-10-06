import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { useFileJobs } from "../../persistence/fileJobs";
import { runCommand } from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { operationDropCurrent, operationDropTargets, useOperationDrop } from "../commands/operationDropCommand";
import {
  cancelSketchSolidHandoff,
  refreshSketchSolidHandoff,
  sketchSolidHandoffCurrent,
  useSketchSolidHandoff,
} from "../commands/sketchSolidHandoffCommand";
import { useExtrudeDraft } from "../commands/extrudeCommand";
import { useModelingDraft } from "../commands/modelingDraftCommand";
import { useHoleDraft } from "../commands/holeCommand";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { useGuidedHole } from "../commands/guidedHoleCommand";
import { useTargetScopeCapture } from "../commands/targetScopeCaptureCommand";
import { nextModelingAction } from "../workspace/modelingReadiness";
import "./SketchSolidHandoffPanel.css";

export function SketchSolidHandoffPanel() {
  const state = useCadStore(useShallow((store) => ({
    history: store.history, documentSession: store.documentSession,
    activeComponentId: store.activeComponentId, rebuild: store.rebuild,
    fileBusy: store.fileBusy,
  })));
  const view = useViewerState(useShallow((store) => ({
    session: store.session, hiddenSketchIds: store.hiddenSketchIds,
    hiddenComponentIds: store.hiddenComponentIds,
  })));
  const exportOpen = useFileJobs((jobs) => jobs.exportOpen);
  const extrude = useExtrudeDraft((drafts) => drafts.draft);
  const modeling = useModelingDraft((drafts) => drafts.draft);
  const hole = useHoleDraft((drafts) => drafts.draft);
  const guidedHole = useGuidedHole((drafts) => drafts.draft);
  const scopeBusy = useTargetScopeCapture((capture) => capture.busy);
  const canvas = useSketchCanvas((drawing) => drawing.active);
  const { source, selectedTargetId, error } = useSketchSolidHandoff();
  const { frame, error: pickingError } = useOperationDrop();
  const enablement = useCommandEnablement();
  const current = Boolean(source && sketchSolidHandoffCurrent(source, state));
  useEffect(() => {
    if (!source) return;
    if (!current) { cancelSketchSolidHandoff(); return; }
    refreshSketchSolidHandoff(source);
  }, [source, current, state.rebuild, view, frame, extrude, modeling, hole, guidedHole, scopeBusy, canvas, exportOpen]);
  if (!source || !current) return null;
  const nativeTargets = operationDropTargets("extrude", state, source.sketchId);
  const currentFrame = frame?.handoffSketchId === source.sketchId && operationDropCurrent(frame, state) ? frame : undefined;
  const selected = nativeTargets.find((target) => target.id === selectedTargetId);
  const readiness = nextModelingAction({ ...state, selection: { selectedIds: [{ kind: "sketch", id: source.sketchId, documentId: source.document.id }] } });
  const perform = async (command: string, targetId?: string) => {
    try { await runCommand(command, { operationFrame: currentFrame, operationTargetId: targetId }); }
    catch (failure) { useSketchSolidHandoff.setState({ error: failure instanceof Error ? failure.message : String(failure) }); }
  };
  const description = nativeTargets.length && !currentFrame
    ? "Finish or cancel the current modeling task before choosing this sketch's region."
    : nativeTargets.length
    ? nativeTargets.length === 1
      ? "Your closed region is selected. Make solid opens a thickness preview; Apply creates the feature."
      : "Click a highlighted region in the canvas, or choose it below. Make solid opens its thickness preview."
    : readiness.state === "ready-sketch" && !state.rebuild.kernelReady
      ? "OpenCascade is required to check these regions and make a native solid. Inspect Issues if the kernel could not load."
      : readiness.description;
  return <section className="sketch-solid-handoff" aria-label="Make solid from finished sketch">
    <h2>{source.document.sketches[source.sketchId].name}: make it solid</h2>
    <p role="status">{description}</p>
    {nativeTargets.length ? <div className="sketch-solid-regions" role="group" aria-label="Closed sketch regions">
      {nativeTargets.map((target) => <button key={target.id} type="button"
        aria-pressed={target.id === selected?.id} disabled={!currentFrame}
        onClick={() => void perform("sketch.solidRegion", target.id)}
        onPointerEnter={() => useOperationDrop.setState({ hoverId: target.id })}
        onPointerLeave={() => useOperationDrop.setState({ hoverId: selected?.id })}
        onFocus={() => useOperationDrop.setState({ hoverId: target.id })}
        onBlur={() => useOperationDrop.setState({ hoverId: selected?.id })}>{target.label}</button>)}
    </div> : null}
    {nativeTargets.length > 1 && !selected ? <p>Choose one region before continuing. Separate regions create separate features.</p> : null}
    {readiness.note ? <p className="muted">{readiness.note}</p> : null}
    {error || pickingError ? <p role="alert">{error || pickingError}</p> : null}
    <div className="sketch-solid-actions">
      <button type="button" onClick={() => void perform("sketch.cancelSolidHandoff")}>Cancel</button>
      <button type="button" onClick={async () => {
        try {
          if (!sketchSolidHandoffCurrent(source))
            throw new Error("The sketch or project changed. Select the sketch and try again.");
          // The picker must release its transient task before the drawing command
          // is available. Surface failures globally after that release.
          cancelSketchSolidHandoff();
          useCadStore.getState().select({ kind: "sketch", id: source.sketchId, documentId: source.document.id });
          await runCommand("sketch.editCanvas");
          if (useSketchCanvas.getState().active?.sketchId !== source.sketchId)
            throw new Error("Sketch editing is unavailable. Select the sketch and try again.");
        } catch (failure) {
          useCadStore.getState().setFileError(`Could not reopen sketch: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }}>Edit sketch</button>
      <button type="button" disabled={!enablement.makeSketchSolid} onClick={() => void perform("sketch.makeSolid")}>Make solid</button>
    </div>
  </section>;
}
