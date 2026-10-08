import { useEffect, useMemo, useRef, useState } from "react";
import { buildSketchOffset, sketchOffsetProfiles, type SketchOffsetInput, type SketchOffsetPlan } from "../../cad/sketch/sketchOffset";
import type { ResolvedSketch } from "../../cad/sketch/SketchSolver";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { applySketchOffset, cancelSketchOffset, currentSketchOffsetFrame, previewSketchOffset, useSketchOffset, type SketchOffsetFrame } from "../commands/sketchOffsetCommand";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import "./SketchTrimExtendPanel.css";
interface Proposal { frame: SketchOffsetFrame; plan: SketchOffsetPlan; result: RebuildResult; solved: ResolvedSketch }
function OffsetPreview({ proposal }: { proposal: Proposal }) {
  const solved = proposal.solved, copied = new Set(proposal.plan.copiedEntityIds);
  const points = [...Object.values(solved.points), ...[...solved.circles, ...solved.arcs].flatMap((circle) => [
    { x: circle.center.x - circle.radius, y: circle.center.y - circle.radius }, { x: circle.center.x + circle.radius, y: circle.center.y + circle.radius },
  ])];
  const minX = Math.min(...points.map((point) => point.x)), maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y)), maxY = Math.max(...points.map((point) => point.y));
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  const span = Math.max(maxX - minX, maxY - minY, 1), padding = span * 0.08;
  const style = (id: string) => ({ stroke: copied.has(id) ? "var(--accent)" : "var(--muted)", strokeWidth: copied.has(id) ? span / 180 : span / 260 });
  return <svg role="img" aria-label="Source and copied outline offset preview" viewBox={`${minX - padding} ${-maxY - padding} ${maxX - minX + 2 * padding} ${maxY - minY + 2 * padding}`} style={{ width: "100%", height: 180, border: "1px solid var(--border)" }}>
    <title>Original outline in muted color; copied outline in accent color</title>
    <g fill="none">
      {solved.lines.map((line) => <line key={line.id} x1={line.start.x} y1={-line.start.y} x2={line.end.x} y2={-line.end.y} {...style(line.id)} strokeDasharray={line.construction ? `${span / 60} ${span / 60}` : undefined} data-offset-copy={copied.has(line.id)} />)}
      {solved.circles.map((circle) => <circle key={circle.id} cx={circle.center.x} cy={-circle.center.y} r={circle.radius} {...style(circle.id)} strokeDasharray={circle.construction ? `${span / 60} ${span / 60}` : undefined} data-offset-copy={copied.has(circle.id)} />)}
      {solved.arcs.map((arc) => <path key={arc.id} d={`M ${arc.start.x} ${-arc.start.y} A ${arc.radius} ${arc.radius} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep < 0 ? 1 : 0} ${arc.end.x} ${-arc.end.y}`} {...style(arc.id)} strokeDasharray={arc.construction ? `${span / 60} ${span / 60}` : undefined} data-offset-copy={copied.has(arc.id)} />)}
    </g>
  </svg>;
}
export function SketchOffsetPanel() {
  const frame = useSketchOffset((state) => state.frame);
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const component = useCadStore((state) => state.activeComponentId);
  const fileBusy = useCadStore((state) => state.fileBusy);
  const kernelReady = useCadStore((state) => state.rebuild.kernelReady);
  const active = useSketchCanvas((state) => state.active);
  const selection = useSketchCanvas((state) => state.selection);
  const [profileId, setProfile] = useState("");
  const [distance, setDistance] = useState("2mm");
  const [direction, setDirection] = useState<SketchOffsetInput["direction"]>("outward");
  const [holes, setHoles] = useState<SketchOffsetInput["holes"]>("reject");
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [status, setStatus] = useState("Choose a closed region, distance and direction. Preview the copied outline before Apply.");
  const controller = useRef<AbortController | undefined>(undefined), timer = useRef<number | undefined>(undefined);
  const configuration = useMemo(() => {
    if (!frame) return undefined;
    try { return { value: sketchOffsetProfiles(frame.document, frame.active.sketchId), error: "" }; }
    catch (failure) { return { value: undefined, error: failure instanceof Error ? failure.message : "Closed profiles are unavailable." }; }
  }, [frame]);
  const invalidate = (message = "Inputs changed. Preview the current copied outline again.") => {
    controller.current?.abort(); controller.current = undefined;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    setBusy(false); setProposal(undefined); setStatus(message);
  };
  const restoreFocus = () => window.requestAnimationFrame(() => window.document.querySelector<HTMLButtonElement>('button[aria-label="Offset sketch outline"]')?.focus());
  const close = () => { invalidate("Outline offset canceled. The project is unchanged."); cancelSketchOffset(); restoreFocus(); };
  useEffect(() => {
    invalidate(); setError(""); setHoles("reject");
    const profiles = configuration?.value?.profiles ?? [];
    const matching = profiles.filter((profile) => frame?.selectedIds.length && frame.selectedIds.every((id) => profile.outerLoop.entityIds.includes(id)));
    setProfile(matching.length === 1 ? matching[0].id : profiles.length === 1 ? profiles[0].id : "");
  }, [frame, configuration]);
  useEffect(() => { if (frame && !currentSketchOffsetFrame(frame)) close(); }, [frame, document, session, component, fileBusy, active, selection]);
  useEffect(() => () => { controller.current?.abort(); if (timer.current !== undefined) window.clearTimeout(timer.current); }, []);
  if (!frame) return null;
  const chosen = configuration?.value?.profiles.find((profile) => profile.id === profileId);
  const preview = async () => {
    if (busy || !kernelReady || fileBusy) return;
    invalidate(); setError("");
    let abort: AbortController | undefined;
    try {
      const plan = buildSketchOffset(frame.document, frame.active.sketchId, profileId, { distance, direction, holes });
      abort = new AbortController(); controller.current = abort;
      const request = abort;
      timer.current = window.setTimeout(() => {
        if (controller.current !== request) return;
        invalidate("The project is unchanged."); setError("Outline offset preview timed out. Try a simpler sketch.");
      }, 120000);
      setBusy(true); setStatus("Solving the copied contour and validating downstream geometry…");
      const geometry = await previewSketchOffset(frame, plan, abort.signal);
      if (controller.current !== abort || !currentSketchOffsetFrame(frame)) return;
      setProposal({ frame, plan, ...geometry });
      setStatus(geometry.result.meshes.length ? "Native outline preview ready. Review all changed bodies before Apply." : `Closed outline preview ready · ${plan.profileCount} profile(s). No solid was modeled.`);
    } catch (failure) {
      if (abort && controller.current !== abort) return;
      setError(failure instanceof Error ? failure.message : "Outline offset failed."); setStatus("The project is unchanged.");
    } finally {
      if (!abort || controller.current === abort) {
        if (timer.current !== undefined) window.clearTimeout(timer.current);
        timer.current = undefined; controller.current = undefined; setBusy(false);
      }
    }
  };
  return <section className="sketch-trim-extend" aria-label="Offset sketch outline" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <h3>Offset a sketch outline</h3>
    <p>Create an inward or outward copied contour in this sketch. This does not move the sketch plane.</p>
    <label>Outline region<select value={profileId} onChange={(event) => { invalidate(); setError(""); setProfile(event.target.value); }}>
      <option value="">Choose a closed region</option>
      {configuration?.value?.profiles.map((profile, index) => <option key={profile.id} value={profile.id}>Region {index + 1} · {profile.outerLoop.type} · {(profile.bounds.maxX - profile.bounds.minX).toFixed(2)} × {(profile.bounds.maxY - profile.bounds.minY).toFixed(2)} mm{profile.innerLoops.length ? ` · ${profile.innerLoops.length} holes` : ""}</option>)}
    </select></label>
    <label>Outline offset distance<input value={distance} onChange={(event) => { invalidate(); setError(""); setDistance(event.target.value); }} /></label>
    <label>Outline offset direction<select value={direction} onChange={(event) => { invalidate(); setError(""); setDirection(event.target.value as SketchOffsetInput["direction"]); }}>
      <option value="outward">Outward · enlarge the boundary</option><option value="inward">Inward · shrink the boundary</option>
    </select></label>
    <label>Outline holes policy<select value={holes} onChange={(event) => { invalidate(); setError(""); setHoles(event.target.value as SketchOffsetInput["holes"]); }}>
      <option value="reject">Require a region without holes</option><option value="outerOnly">Outer boundary only · keep all existing holes unchanged</option>
    </select></label>
    {chosen?.innerLoops.length ? <p>This region has holes. Choose Outer boundary only explicitly to continue. Their geometry and constraints are preserved.</p> : null}
    <p>{chosen?.outerLoop.type === "circle" ? "Circle copies retain matching radius/center parameter expressions and accept a parameter-based distance. They are independent entities, not an associative offset feature." : "Simple authored line outlines, including concave shapes, and mixed line/analytic arc outlines with tangent arc joins, up to 64 edges. Distance must be literal length arithmetic; the copied shape is independently editable."}</p>
    <p>Original geometry and intent remain intact. The copied contour appears in the accent color. Adding contours can change profile nesting and existing feature geometry.</p>
    <button type="button" disabled={busy || fileBusy || !kernelReady || !chosen || !distance.trim() || Boolean(configuration?.error)} onClick={() => void preview()}>Preview outline offset</button>
    <button type="button" onClick={close}>Cancel outline offset</button>
    <button type="button" disabled={!proposal || busy || !currentSketchOffsetFrame(frame)} onClick={() => {
      if (!proposal) return;
      try { applySketchOffset(proposal.frame, proposal.plan, proposal.result); restoreFocus(); }
      catch (failure) { invalidate(); setError(failure instanceof Error ? failure.message : "Outline offset could not be applied."); }
    }}>Apply outline offset</button>
    <p role="status" aria-label="Outline offset status">{status}</p>
    {configuration?.error || error ? <p role="alert">{configuration?.error || error}</p> : null}
    {proposal ? <><ul aria-label="Proposed outline offset changes">{proposal.plan.changes.map((change) => <li key={change}>{change}</li>)}</ul><OffsetPreview proposal={proposal} />
      {proposal.result.meshes.length ? <><ExtrudePreview meshes={proposal.result.meshes} label="Native outline offset preview" /><p>{proposal.result.meshes.reduce((sum, mesh) => sum + (mesh.geometryAssertions?.volume ?? 0), 0).toFixed(3)} mm³</p></> : null}</> : null}
    <p>Fragmented boundaries, nonsmooth arc joins, collapsed contours and intersections with existing outlines are diagnosed explicitly. Arcs remain analytic; no sampled outline is created.</p>
  </section>;
}
