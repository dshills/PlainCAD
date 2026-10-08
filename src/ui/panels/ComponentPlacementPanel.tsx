import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPlacement } from "../../cad/document/schema";
import { validComponentPlacement } from "../../cad/document/componentPlacement";
import { alignComponentGeometry, componentAlignmentTargets, placedAlignmentTarget, type ComponentAlignmentTarget } from "../../cad/inspection/componentAlignment";
import { useCadStore } from "../../state/useCadStore";
import { applyComponentPlacement, cancelComponentPlacement, isCurrentComponentPlacement, previewComponentPlacement, useComponentPlacement, type ComponentPlacementPreview } from "../commands/componentPlacementCommand";
import { ComponentPlacementControls } from "../../viewer/ComponentPlacementControls";
import { ModalDialog } from "../ModalDialog";
import { CommitInput } from "./CommitInput";
import "./SketchTrimExtendPanel.css";
const same = (a: ComponentPlacement, b: ComponentPlacement) => JSON.stringify(a) === JSON.stringify(b);
const display = (value: number) => Number(value.toFixed(6)).toString();
export function ComponentPlacementPanel() {
  const frame = useComponentPlacement((state) => state.frame);
  return frame ? <PlacementDraft key={`${frame.session}:${frame.componentId}:${frame.document.updatedAt}`} frame={frame} /> : null;
}
function PlacementDraft({ frame }: { frame: NonNullable<ReturnType<typeof useComponentPlacement.getState>["frame"]> }) {
  const document = useCadStore((state) => state.history.present), session = useCadStore((state) => state.documentSession), active = useCadStore((state) => state.activeComponentId), fileBusy = useCadStore((state) => state.fileBusy), rebuild = useCadStore((state) => state.rebuild);
  const [placement, setPlacement] = useState<ComponentPlacement>(frame.placement), [dragging, setDragging] = useState(false), [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<ComponentPlacementPreview>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const targets = useMemo(() => componentAlignmentTargets(frame.document, frame.result), [frame]);
  const [alignmentKind, setAlignmentKind] = useState<ComponentAlignmentTarget["kind"]>("face"), [sourceId, setSourceId] = useState(""), [targetId, setTargetId] = useState("");
  const [clearance, setClearance] = useState(0), [opposite, setOpposite] = useState(true), [alignmentPending, setAlignmentPending] = useState(false), [picking, setPicking] = useState<"source" | "target">();
  const sources = useMemo(() => targets.filter(target => target.componentId === frame.componentId && target.kind === alignmentKind), [targets, frame.componentId, alignmentKind]);
  const destinations = useMemo(() => targets.filter(target => target.componentId !== frame.componentId && target.kind === alignmentKind), [targets, frame.componentId, alignmentKind]);
  const pickTargets = useMemo(() => picking === "source" ? sources.map(target => placedAlignmentTarget(target, frame.placement, placement)) : picking === "target" ? destinations : [], [picking, sources, destinations, frame.placement, placement]);
  const choose = (mode: "source" | "target", id: string) => { if (mode === "source") setSourceId(id); else setTargetId(id); setAlignmentPending(true); setPicking(undefined); setError(""); };
  const controller = useRef<AbortController | undefined>(undefined);
  const current = isCurrentComponentPlacement(frame), changed = !same(placement, frame.placement);
  const shown = current && preview && same(preview.placement, placement) ? preview : undefined;
  const close = () => { controller.current?.abort(); controller.current = undefined; cancelComponentPlacement(); };
  useEffect(() => { if (!isCurrentComponentPlacement(frame)) close(); }, [frame, document, session, active, fileBusy, rebuild]);
  useEffect(() => {
    controller.current?.abort(); controller.current = undefined; setBusy(false); setError("");
    if (!current || dragging || !changed) return;
    const request = new AbortController(); controller.current = request;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void previewComponentPlacement(frame, placement, request.signal).then((result) => {
        if (controller.current === request && isCurrentComponentPlacement(frame)) setPreview(result);
      }).catch((failure: unknown) => { if (!request.signal.aborted && controller.current === request) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (controller.current === request) { controller.current = undefined; setBusy(false); } });
    }, 150);
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [frame, placement, current, dragging, changed]);
  useEffect(() => () => controller.current?.abort(), []);
  const commit = (mode: "translation" | "rotation", axis: 0 | 1 | 2, text: string) => {
    const number = text.trim() === "" ? NaN : Number(text);
    const next: ComponentPlacement = { translation: [...placement.translation], rotation: [...placement.rotation] };
    next[mode][axis] = mode === "rotation" ? number * Math.PI / 180 : number;
    if (!validComponentPlacement(next)) { setPreview(undefined); setError("Enter finite positions within ±100,000,000 mm and rotations within ±360 degrees."); return; }
    setError(""); setAlignmentPending(false); setPicking(undefined); setPlacement(next);
  };
  return <ModalDialog label="Move or rotate component" className="file-dialog model-dialog extrude-dialog" onDismiss={close}><section className="sketch-trim-extend component-placement-panel" aria-label="Move or rotate component" onChangeCapture={(event) => { if (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") setDirty(true); }} onBlurCapture={() => setDirty(false)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!(event.target instanceof HTMLInputElement)) close(); } }}>
    <h3>Move / Rotate · {frame.document.components[frame.componentId].name}</h3>
    <p>Place the component’s finished parts. Sketch dimensions and feature geometry stay in their authored design coordinates.</p>
    <div className="extrude-dialog-layout"><div>
    <fieldset disabled={!current || dragging}><legend>Align to another component</legend>
      <p>Choose supported native geometry, then Align. Faces align their planes; edges match midpoints; points coincide.</p>
      <label>Alignment geometry<select value={alignmentKind} onChange={event => { const kind = event.target.value as ComponentAlignmentTarget["kind"]; setAlignmentKind(kind); setSourceId(""); setTargetId(""); setClearance(0); setOpposite(kind === "face"); setAlignmentPending(false); setPicking(undefined); setError(""); }}><option value="face">Planar faces</option><option value="edge">Straight edges</option><option value="point">Endpoints</option></select></label>
      <label>Source geometry<select value={sourceId} onChange={event => choose("source", event.target.value)}><option value="">Choose geometry on this component</option>{sources.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <button type="button" disabled={dirty || !sources.length} aria-pressed={picking === "source"} onClick={() => setPicking(picking === "source" ? undefined : "source")}>Pick source in preview</button>
      <label>Target geometry<select value={targetId} onChange={event => choose("target", event.target.value)}><option value="">Choose geometry on another component</option>{destinations.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <button type="button" disabled={dirty || !destinations.length} aria-pressed={picking === "target"} onClick={() => setPicking(picking === "target" ? undefined : "target")}>Pick target in preview</button>
      {alignmentKind === "face" ? <label>Face clearance (mm)<CommitInput value={display(clearance)} onCommit={text => { const value = text.trim() ? Number(text) : NaN; setAlignmentPending(true); if (!Number.isFinite(value) || Math.abs(value) > 1e8) { setError("Enter finite face clearance within ±100,000,000 mm."); return; } setClearance(value); setError(""); }} /></label> : null}
      {alignmentKind !== "point" ? <label><input type="checkbox" checked={opposite} onChange={event => { setOpposite(event.target.checked); setAlignmentPending(true); setError(""); }} />{alignmentKind === "face" ? "Oppose face normals" : "Reverse edge direction"}</label> : null}
      <button type="button" disabled={dirty || !sourceId || !targetId || Boolean(error)} onClick={() => { try { const source = sources.find(target => target.id === sourceId), target = destinations.find(target => target.id === targetId); if (!source || !target || !isCurrentComponentPlacement(frame)) throw new Error("Alignment references changed. Choose current native geometry again."); setPlacement(alignComponentGeometry(source, target, frame.placement, placement, clearance, opposite)); setAlignmentPending(false); setPicking(undefined); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Align selected geometry</button>
      <button type="button" onClick={() => { setSourceId(""); setTargetId(""); setAlignmentPending(false); setPicking(undefined); setError(""); }}>Clear alignment choices</button>
      {!destinations.length ? <p role="status">Add another native component to align matching geometry.</p> : null}
      {picking ? <p role="status">Pick a highlighted {picking} reference in the preview, or choose it from the list.</p> : null}
    </fieldset>
    <fieldset disabled={!current || dragging}><legend>Exact placement</legend>
      {(["translation", "rotation"] as const).map((mode) => <div key={mode}>{([0, 1, 2] as const).map((axis) => <label key={axis}>{mode === "translation" ? "Position" : "Rotation"} {["X", "Y", "Z"][axis]} ({mode === "translation" ? "mm" : "deg"})<CommitInput value={display(placement[mode][axis] * (mode === "rotation" ? 180 / Math.PI : 1))} onCommit={(text) => commit(mode, axis, text)} /></label>)}</div>)}
    </fieldset>
    </div><div>
    <ComponentPlacementControls meshes={(preview ?? { result: frame.result }).result.meshes} meshPlacement={preview?.placement ?? frame.placement} placement={placement} bodyIds={frame.bodyIds} disabled={!current || dirty} onChange={(next) => { setError(""); setAlignmentPending(false); setPicking(undefined); setPlacement(next); }} onDragging={setDragging}
      alignmentTargets={pickTargets} alignmentPicking={picking} onAlignmentPick={id => { if (picking) choose(picking, id); }} />
    </div></div>
    <button type="button" disabled={!current || dragging || dirty} onClick={() => { setPlacement({ translation: [0, 0, 0], rotation: [0, 0, 0] }); setAlignmentPending(false); setPicking(undefined); setError(""); }}>Reset placement</button>
    <button type="button" disabled={!current || dragging || dirty || busy || alignmentPending || picking !== undefined || !shown || !changed || Boolean(error)} onClick={() => { if (!shown) return; try { applyComponentPlacement(shown, placement); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Apply component placement</button>
    <button type="button" onClick={close}>Cancel placement</button>
    <p role="status" aria-label="Placement status">{dragging ? "Moving live. Native validation runs when you release the handle." : dirty ? "Finish the field with Enter or leave it before Apply." : picking ? "Finish picking geometry or turn off preview picking before Apply." : alignmentPending ? "Choose matching references and Align selected geometry, or Clear alignment choices before Apply." : busy ? "Validating placed native solids…" : shown ? "Native placement is valid. Apply saves one undo step." : changed ? "Waiting for a current native placement preview…" : "Drag a handle or enter exact values. The project is unchanged until Apply."}</p>
    {error ? <p role="alert">{error}</p> : null}
    <p className="muted">Position uses millimeters; rotation uses degrees in X, then Y, then Z order. Rotations use the component design origin. Alignment saves a rigid pose; it creates no joint or persistent mate. Signed face clearance follows the target normal and leaves tangential translation unchanged.</p>
  </section></ModalDialog>;
}
