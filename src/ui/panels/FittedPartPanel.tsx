import { useEffect, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { useCadStore } from "../../state/useCadStore";
import { bodyComponentId } from "../../cad/document/components";
import { applyFit, cancelFit, currentFit, previewFit, useFittedPart, type FitFrame, type FitInput, type FitPreview } from "../commands/fittedPartCommand";
export function FittedPartPanel() {
  const frame = useFittedPart(state => state.frame);
  return frame ? <FitDialog key={`${frame.featureId}:${frame.session}`} frame={frame} /> : null;
}
function FitDialog({ frame }: { frame: FitFrame }) {
  const current = useCadStore(() => currentFit(frame));
  const [input, setInput] = useState<FitInput>({ name: frame.feature?.name ?? "Fitted enclosure", sourceBodyId: frame.sourceBodyId, style: frame.feature?.style ?? "enclosure", clearance: frame.feature?.clearance.expression ?? "2mm", wallThickness: frame.feature?.wallThickness.expression ?? "2mm", follow: frame.feature?.followSourcePlacement ?? true });
  const [preview, setPreview] = useState<{ input: FitInput; value?: FitPreview; error?: string }>();
  const [error, setError] = useState("");
  const patch = (change: Partial<FitInput>) => { setError(""); setInput(value => ({ ...value, ...change })); };
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void previewFit(frame, input, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPreview({ input, value }); })
      .catch(failure => { if (!controller.signal.aborted) setPreview({ input, error: failure instanceof Error ? failure.message : String(failure) }); }), 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [frame, input, current]);
  const shown = current && preview?.input === input ? preview : undefined;
  const sources = frame.document.features.filter(feature => !feature.suppressed && "operation" in feature && feature.operation === "newBody" && bodyComponentId(frame.document, `body:${feature.id}`) !== frame.componentId);
  return <ModalDialog label={frame.feature ? "Edit fitted part" : "Build a fitted part"} className="file-dialog model-dialog extrude-dialog" onDismiss={cancelFit}><form onSubmit={event => {
    event.preventDefault(); setError(""); if (shown?.value) try { applyFit(shown.value, input); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }}><h2>{frame.feature ? "Edit fitted part" : "Build something that fits"}</h2>
    <p>A separate component stays linked to the reference's native solid envelope. Settings accept parameter expressions.</p>
    <label>Source part<select value={input.sourceBodyId} onChange={event => patch({ sourceBodyId: event.target.value })}>
      {!sources.some(feature => `body:${feature.id}` === input.sourceBodyId) ? <option value={input.sourceBodyId}>Lost source — choose another part</option> : null}
      {sources.map(feature => <option key={feature.id} value={`body:${feature.id}`}>{frame.document.components[bodyComponentId(frame.document, `body:${feature.id}`)!]?.name} · {feature.name}</option>)}
    </select></label>
    <label>Fit style<select value={input.style} onChange={event => patch({ style: event.target.value as FitInput["style"] })}><option value="enclosure">Open enclosure</option><option value="bracket">L bracket</option><option value="adapter">Open adapter sleeve</option></select></label>
    <label>Clearance<input value={input.clearance} onChange={event => patch({ clearance: event.target.value })} /></label>
    <label>Wall thickness<input value={input.wallThickness} onChange={event => patch({ wallThickness: event.target.value })} /></label>
    <label>Part name<input value={input.name} onChange={event => patch({ name: event.target.value })} /></label>
    <label><input type="checkbox" checked={input.follow} onChange={event => patch({ follow: event.target.checked })} />Follow source position</label>
    <ExtrudePreview meshes={shown?.value?.result.meshes ?? []} label="Native fitted part preview" />
    <p role="status">{!current ? "Project changed. Close and reopen this task." : shown?.error ? "Preview failed" : shown?.value ? "Native fitted preview ready" : "Building native fitted preview…"}</p>
    {shown?.error || error ? <p role="alert">{error || shown?.error}</p> : null}
    <p>Rectangular envelope: enclosure opens along source local +Z; bracket back is local −Y; sleeve is open at both Z ends. This does not create a contoured shell or add fasteners. New source operations must precede this feature in History.</p>
    <button type="submit" disabled={!shown?.value}>Apply fitted part</button><button type="button" onClick={cancelFit}>Cancel fitted part</button>
  </form></ModalDialog>;
}
