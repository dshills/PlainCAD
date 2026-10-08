import { useEffect, useMemo, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { showGeometryHighlight } from "../../state/useGeometryHighlight";
import { runCommand } from "../commands/commandRegistry";
import { useViewerState } from "../../state/viewerState";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { COACH_PRESETS, manufacturingReport, type CoachSettings, type ManufacturingProcess } from "../../cad/inspection/manufacturingCoach";
import { applyCoachCorrection, cancelCoach, currentCoach, previewCoachCorrection, useManufacturingCoach, type CoachFrame, type CoachPreview } from "../commands/manufacturingCoachCommand";
export function ManufacturingCoachPanel() {
  const frame = useManufacturingCoach(state => state.frame);
  return frame ? <CoachDialog key={frame.session} frame={frame} /> : null;
}
function CoachDialog({ frame }: { frame: CoachFrame }) {
  const current = useCadStore(() => currentCoach(frame));
  const [settings, setSettings] = useState<CoachSettings>({ ...COACH_PRESETS.fdm }), [id, setId] = useState("");
  const [preview, setPreview] = useState<CoachPreview>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const analysis = useMemo(() => { try { return { report: manufacturingReport(frame.document, frame.result, settings) }; } catch (failure) { return { error: failure instanceof Error ? failure.message : String(failure) }; } }, [frame, settings]);
  const finding = analysis.report?.findings.find(finding => finding.id === id);
  useEffect(() => {
    if (!current || !finding) return;
    // Manufacturing findings concern the whole model, including hidden parts.
    const previous = useViewerState.getState();
    runCommand("view.model", { documentSession: frame.session });
    runCommand("view.showAllBodies");
    const clear = showGeometryHighlight({ document: frame.document, session: frame.session, result: frame.result, source: "manufacturing", bodyIds: finding.bodyIds });
    return () => {
      clear();
      if (useViewerState.getState().session !== frame.session) return;
      useViewerState.getState().setPresentationMode(frame.session, previous.presentationMode);
      useViewerState.setState({ hiddenBodyIds: previous.hiddenBodyIds, hiddenComponentIds: previous.hiddenComponentIds });
    };
  }, [frame, current, finding]);
  useEffect(() => { setPreview(undefined); setError(""); setBusy(false); if (!current || !finding?.correction || analysis.error) return;
    const controller = new AbortController(); setBusy(true);
    const timer = window.setTimeout(() => void previewCoachCorrection(frame, settings, id, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); }), 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [frame, current, id, settings, finding, analysis.error]);
  const patch = (change: Partial<CoachSettings>) => { setId(""); setSettings(value => ({ ...value, ...change })); };
  const proven = current && preview?.findingId === id && JSON.stringify(preview.settings) === JSON.stringify(settings) ? preview : undefined;
  return <ModalDialog label="Manufacturing coach" className="file-dialog model-dialog extrude-dialog" onDismiss={cancelCoach}><section>
    <h2>Manufacturing coach</h2><p>Review this native model against editable screening assumptions.</p>
    <label>Process<select value={settings.process} onChange={event => { setId(""); setSettings({ ...COACH_PRESETS[event.target.value as ManufacturingProcess] }); }}><option value="fdm">FDM 3D printing</option><option value="cnc">CNC machining</option><option value="laser">Laser cutting</option></select></label>
    <details><summary>Screening thresholds</summary>{(["minimumWall", "minimumClearance", "toolDiameter", "overhangAngle"] as const).map(field => <label key={field}>{({ minimumWall: "Minimum wall (mm)", minimumClearance: "Minimum fit clearance (mm)", toolDiameter: "Tool diameter (mm)", overhangAngle: "Overhang angle (deg)" })[field]}<input type="number" value={Number.isFinite(settings[field]) ? settings[field] : ""} onChange={event => patch({ [field]: event.target.value.trim() ? Number(event.target.value) : NaN })} /></label>)}</details>
    <p role="status">{!current ? "Model changed. Close and reopen the coach." : analysis.error ? "Analysis unavailable" : `${analysis.report!.findings.length} review items · ${analysis.report!.complete ? "screen complete within documented scope" : "analysis incomplete: resource or collision limit"}`}</p>
    {analysis.error ? <p role="alert">{analysis.error}</p> : null}
    <ul>{analysis.report?.findings.map(finding => <li key={finding.id}><button type="button" onClick={() => setId(finding.id)} aria-pressed={id === finding.id}>{finding.title}</button><p>{finding.message}</p></li>)}</ul>
    {finding ? <><p>Affected bodies are highlighted in the main model view.</p>{finding.correction ? <><p>This correction replaces this feature's expression with {finding.correction.value} mm; shared parameters remain unchanged.</p><ExtrudePreview meshes={proven?.result.meshes ?? []} label="Native manufacturing correction preview" /><p role="status">{busy ? "Checking native correction…" : proven ? "Native correction ready" : "Correction unavailable"}</p><button type="button" disabled={!proven || busy || Boolean(error)} onClick={() => { if (proven) try { applyCoachCorrection(proven, settings, id); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Apply manufacturing correction</button></> : <p>Manual review is required for this finding.</p>}</> : null}
    {error ? <p role="alert">{error}</p> : null}
    <details><summary>What this screen can and cannot check</summary>{analysis.report?.scope.map(text => <p key={text}>{text}</p>)}</details>
    <button type="button" onClick={cancelCoach}>Close manufacturing coach</button>
  </section></ModalDialog>;
}
