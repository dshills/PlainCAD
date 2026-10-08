import { useEffect, useMemo, useRef, useState } from "react";
import { planSketchProjection } from "../../cad/sketch/sketchProjection";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { useSketchProjection, canOpenSketchProjection, openSketchProjection, breakCurrentSketchProjection, removeCurrentSketchProjection, cancelSketchProjection, currentSketchProjectionFrame, loadSketchProjectionSources, previewSketchProjection, applySketchProjection, type SketchProjectionPlan, type SketchProjectionChoice } from "../commands/sketchProjectionCommand";
import { ProjectionSourcePicker } from "../../viewer/ProjectionSourcePicker";
import { projectionBoundaryTargets } from "../../viewer/projectionBoundaryPicking";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import "./SketchTrimExtendPanel.css";

function ProjectionOutline({ solved, members }: { solved: ResolvedSketch; members: string[] }) {
  const selected = new Set(members), lines = solved.lines.filter((curve) => selected.has(curve.id)), circles = solved.circles.filter((curve) => selected.has(curve.id)), arcs = solved.arcs.filter((curve) => selected.has(curve.id));
  const points = Object.values(solved.points).filter((point) => selected.has(point.id));
  const bounds = [...points, ...lines.flatMap((line) => [line.start, line.end]), ...[...circles, ...arcs].flatMap((circle) => [{ x: circle.center.x - circle.radius, y: circle.center.y - circle.radius }, { x: circle.center.x + circle.radius, y: circle.center.y + circle.radius }])];
  const minX = Math.min(...bounds.map((point) => point.x)), maxX = Math.max(...bounds.map((point) => point.x)), minY = Math.min(...bounds.map((point) => point.y)), maxY = Math.max(...bounds.map((point) => point.y));
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  const span = Math.max(maxX - minX, maxY - minY, 1), pad = span * 0.08;
  return <svg role="img" aria-label="Linked projected sketch preview" viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} style={{ width: "100%", height: 180 }}><g fill="none" stroke="var(--accent)" strokeWidth={span / 180}>
    {lines.map((line) => <line key={line.id} x1={line.start.x} y1={-line.start.y} x2={line.end.x} y2={-line.end.y} />)}
    {circles.map((circle) => <circle key={circle.id} cx={circle.center.x} cy={-circle.center.y} r={circle.radius} />)}
    {arcs.map((arc) => <path key={arc.id} d={`M ${arc.start.x} ${-arc.start.y} A ${arc.radius} ${arc.radius} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep < 0 ? 1 : 0} ${arc.end.x} ${-arc.end.y}`} />)}
  </g></svg>;
}
export function SketchProjectionPanel() {
  const frame = useSketchProjection((state) => state.frame);
  const document = useCadStore((state) => state.history.present), session = useCadStore((state) => state.documentSession), component = useCadStore((state) => state.activeComponentId), fileBusy = useCadStore((state) => state.fileBusy);
  const active = useSketchCanvas((state) => state.active), selection = useSketchCanvas((state) => state.selection);
  const [sources, setSources] = useState<{ proof: RebuildResult; choices: SketchProjectionChoice[] }>();
  const [sourceId, setSourceId] = useState(""), [construction, setConstruction] = useState(false);
  const [proposal, setProposal] = useState<{ plan: SketchProjectionPlan; result: RebuildResult; solved: ResolvedSketch }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("Checking supported part boundaries…");
  const controller = useRef<AbortController | undefined>(undefined);
  const invalidate = () => { controller.current?.abort(); controller.current = undefined; setBusy(false); setProposal(undefined); };
  const close = () => { invalidate(); cancelSketchProjection(); window.requestAnimationFrame(() => window.document.querySelector<HTMLButtonElement>('button[aria-label="Project part edges into sketch"]')?.focus()); };
  useEffect(() => {
    invalidate(); setSources(undefined); setSourceId(""); setError("");
    if (!frame) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setStatus("Checking native boundaries before this sketch…");
    void loadSketchProjectionSources(frame, request.signal).then((sources) => {
      if (controller.current !== request || !currentSketchProjectionFrame(frame)) return;
      setSources(sources);
      const previous = frame.document.sketches[frame.active.sketchId].projections?.find((link) => link.id === frame.replaceProjectionId);
      const prior = previous && sources.choices.find((choice) => choice.featureId === previous.sourceFeatureId && choice.role === previous.role);
      setSourceId(prior?.id ?? (sources.choices.length === 1 ? sources.choices[0].id : ""));
      setConstruction(previous?.construction ?? false);
      setStatus(sources.choices.length ? "Choose a complete cap boundary. Preview the linked sketch before Apply." : "No supported upstream cap survived. Create a distance extrusion before this sketch or repair the source.");
    }).catch((failure: unknown) => { if (controller.current === request) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (controller.current === request) { controller.current = undefined; setBusy(false); } });
    return () => { request.abort(); };
  }, [frame]);
  useEffect(() => { if (frame && !currentSketchProjectionFrame(frame)) close(); }, [frame, document, session, component, fileBusy, active, selection]);
  useEffect(() => () => controller.current?.abort(), []);
  const targets = useMemo(() => frame && sources ? projectionBoundaryTargets(frame.document, frame.active.sketchId, sources.proof, sources.choices, frame.replaceProjectionId) : [], [frame, sources]);
  if (!frame) return null;
  const legacyRepair = frame.replaceProjectionId && frame.document.sketches[frame.active.sketchId].projections?.some(link => link.id === frame.replaceProjectionId && link.coordinateSpace !== "world");
  const chosen = sources?.choices.find((choice) => choice.id === sourceId);
  const preview = async (choice = chosen) => {
    if (!sources || !choice || busy || !currentSketchProjectionFrame(frame)) return;
    invalidate(); setError("");
    const request = new AbortController(); controller.current = request; setBusy(true); setStatus("Solving the linked boundary and validating native geometry…");
    try {
      const plan = planSketchProjection(frame.document, frame.active.sketchId, choice.featureId, choice.role, construction, sources.proof, frame.replaceProjectionId);
      const geometry = await previewSketchProjection(frame, plan, request.signal);
      if (controller.current !== request || !currentSketchProjectionFrame(frame)) return;
      setProposal({ plan, ...geometry }); setStatus("Linked projection preview ready. Apply adds one undo step.");
    } catch (failure) { if (controller.current === request) { setError(failure instanceof Error ? failure.message : String(failure)); setStatus("The project is unchanged."); } }
    finally { if (controller.current === request) { controller.current = undefined; setBusy(false); } }
  };
  return <section className="sketch-trim-extend" aria-label="Project part edges" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <h3>{frame.replaceProjectionId ? "Repair projected boundary" : "Project part edges"}</h3>
    <p>Reuse a complete earlier cap boundary on this parallel sketch plane. New links follow source dimensions and component placement. Existing design links keep their original association.</p>
    {legacyRepair ? <p>Repairing a legacy design link. The source view shows the placed part; compatibility and the linked outline use authored design coordinates.</p> : null}
    {sources ? <ProjectionSourcePicker meshes={sources.proof.meshes} targets={targets} selectedId={sourceId} disabled={busy} onChoose={(target) => {
      if (busy || !currentSketchProjectionFrame(frame)) return;
      invalidate(); setSourceId(target.id); setError("");
      if (target.disabledReason) { setError(target.disabledReason); setStatus("Choose a compatible boundary or repair the sketch plane. The project is unchanged."); return; }
      void preview(target);
    }} /> : null}
    <label>Source part boundary<select aria-label="Source part boundary" value={sourceId} disabled={busy} onChange={(event) => { invalidate(); setError(""); setSourceId(event.target.value); setStatus("Source changed. Preview the linked boundary before Apply."); }}>
      <option value="">Choose an earlier part boundary</option>{sources?.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select></label>
    {chosen ? <p aria-label="Projection compatibility">{targets.find((target) => target.id === chosen.id)?.disabledReason ?? "Compatible parallel sketch plane. Preview validates the linked native boundary before Apply."}</p> : null}
    <label><input type="checkbox" checked={construction} disabled={busy} onChange={(event) => { invalidate(); setError(""); setConstruction(event.target.checked); setStatus("Construction option changed. Preview the linked boundary before Apply."); }} />Construction reference only</label>
    <p>Projected items are read-only. Edit the source, break the link for independent geometry, or remove the projection to choose a different boundary.</p>
    <button type="button" disabled={busy || !chosen} onClick={() => void preview()}>Preview projected boundary</button>
    <button type="button" disabled={busy || !proposal || !currentSketchProjectionFrame(frame)} onClick={() => {
      if (!proposal) return;
      try { applySketchProjection(frame, proposal.plan, proposal.result); }
      catch (failure) { invalidate(); setError(failure instanceof Error ? failure.message : String(failure)); }
    }}>Apply projected boundary</button>
    <button type="button" onClick={close}>Cancel projection</button>
    <p role="status" aria-label="Projection status">{status}</p>
    {error ? <p role="alert">{error}</p> : null}
    {proposal ? <><p>{proposal.plan.projection.members.length} linked sketch items · {construction ? "Construction reference" : "Profile geometry"}</p><ProjectionOutline solved={proposal.solved} members={proposal.plan.projection.members.map((member) => member.targetEntityId)} /><ExtrudePreview meshes={proposal.result.meshes} label="Native projected boundary preview" /><p>Current native solids remain valid. Projection adds sketch geometry; it creates no new body.</p></> : null}
    <p>Only full surviving authored distance-extrusion caps are supported, with up to 256 members. Oblique planes, arbitrary faces and fragmented boundaries are diagnosed.</p>
  </section>;
}

export function SketchProjectionLinks() {
  const document = useCadStore((state) => state.history.present), rebuild = useCadStore((state) => state.rebuild), active = useSketchCanvas((state) => state.active);
  const selection = useSketchCanvas((state) => state.selection);
  const [error, setError] = useState("");
  const links = active ? document.sketches[active.sketchId]?.projections ?? [] : [];
  const selected = selection?.document === document && links.some((link) => link.members.some((member) => selection.entityIds.includes(member.targetEntityId)));
  if (!links.length) return null;
  return <section aria-label="Linked projected boundaries"><h3>Projected boundaries</h3>{selected ? <p role="status">Selected geometry is linked and read-only. Edit its source or break its link before moving or dimensioning it.</p> : null}
    {links.map((link) => {
      const source = document.features.find((feature) => feature.id === link.sourceFeatureId);
      return <div key={link.id} className="item-card"><strong>{source?.name ?? "Missing source"} · {link.role === "endCapPerimeter" ? "End cap" : "Start cap"}</strong><span className="muted">{link.coordinateSpace === "world" ? "Placed geometry link" : "Legacy design link"} · {link.members.length} linked items · {link.construction ? "Construction reference" : "Profile geometry"}</span>
        <button type="button" disabled={!canOpenSketchProjection()} onClick={() => { try { openSketchProjection(link.id); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Reselect projected boundary</button>
        <button type="button" disabled={!canOpenSketchProjection() || rebuild.status !== "succeeded" || !rebuild.result?.success} onClick={() => { try { breakCurrentSketchProjection(link.id); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Break projection link</button>
        <button type="button" disabled={!canOpenSketchProjection()} onClick={() => { try { removeCurrentSketchProjection(link.id); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Remove projection and geometry</button>
      </div>;
    })}<p>Reselect preserves linked members only for the same authored boundary. To switch to a different shape, remove this projection and project the new boundary; repair downstream references explicitly.</p>{error ? <p role="alert">{error}</p> : null}
  </section>;
}
