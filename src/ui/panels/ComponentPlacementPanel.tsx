import { createId } from "../../cad/document/ids";
import { AssemblyMotionPanel } from "./AssemblyMotionPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssemblyJoint, ComponentPlacement } from "../../cad/document/schema";
import { validComponentPlacement, positionedDocument, IDENTITY_PLACEMENT } from "../../cad/document/componentPlacement";
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
  return frame?.assembly ? <AssemblyMotionPanel key={`${frame.session}:${frame.componentId}:${frame.document.updatedAt}`} frame={frame} /> : frame ? <PlacementDraft key={`${frame.session}:${frame.componentId}:${frame.document.updatedAt}`} frame={frame} /> : null;
}
function PlacementDraft({ frame }: { frame: NonNullable<ReturnType<typeof useComponentPlacement.getState>["frame"]> }) {
  const document = useCadStore((state) => state.history.present), session = useCadStore((state) => state.documentSession), active = useCadStore((state) => state.activeComponentId), fileBusy = useCadStore((state) => state.fileBusy), rebuild = useCadStore((state) => state.rebuild);
  const [placement, setPlacement] = useState<ComponentPlacement>(frame.placement), [dragging, setDragging] = useState(false), [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<ComponentPlacementPreview>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const positioned = useMemo(() => positionedDocument(frame.document, frame.result), [frame]);
  const targets = useMemo(() => componentAlignmentTargets(frame.document, frame.result), [frame]);
  const [alignmentKind, setAlignmentKind] = useState<ComponentAlignmentTarget["kind"]>("face"), [sourceId, setSourceId] = useState(""), [targetId, setTargetId] = useState("");
  const [clearance, setClearance] = useState(0), [opposite, setOpposite] = useState(true), [alignmentPending, setAlignmentPending] = useState(false), [picking, setPicking] = useState<"source" | "target" | undefined>(targets.some(target => target.componentId === frame.componentId && target.kind === "face") && targets.some(target => target.componentId !== frame.componentId && target.kind === "face") ? "source" : undefined);
  const sources = useMemo(() => targets.filter(target => target.componentId === frame.componentId && target.kind === alignmentKind), [targets, frame.componentId, alignmentKind]);
  const destinations = useMemo(() => targets.filter(target => target.componentId !== frame.componentId && target.kind === alignmentKind), [targets, frame.componentId, alignmentKind]);
  const pickTargets = useMemo(() => picking === "source" ? sources.map(target => placedAlignmentTarget(target, frame.placement, placement)) : picking === "target" ? destinations : [], [picking, sources, destinations, frame.placement, placement]);
  const align = (sourceChoice: string, targetChoice: string, gap = clearance, flip = opposite) => {
    try {
      const source = sources.find(target => target.id === sourceChoice), target = destinations.find(target => target.id === targetChoice);
      if (!source || !target || !isCurrentComponentPlacement(frame)) throw new Error("Alignment choices changed. Choose current geometry again.");
      setPlacement(alignComponentGeometry(source, target, frame.placement, placement, gap, flip));
      setAlignmentPending(false); setPicking(undefined); setError("");
    } catch (failure) { setAlignmentPending(true); setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const choose = (mode: "source" | "target", id: string) => {
    setError(""); setAlignmentPending(true);
    if (mode === "source") { setSourceId(id); setTargetId(""); setPicking(id ? "target" : "source"); }
    else { setTargetId(id); if (sourceId && id) align(sourceId, id); else setPicking(sourceId ? "target" : "source"); }
  };
  const selectedTargets = useMemo(() => [sources.find(target => target.id === sourceId), destinations.find(target => target.id === targetId)].flatMap(target => target ? [target.componentId === frame.componentId ? placedAlignmentTarget(target, frame.placement, placement) : target] : []), [sources, destinations, sourceId, targetId, frame.componentId, frame.placement, placement]);
  const [jointType, setJointType] = useState<"none" | AssemblyJoint["type"]>("none");
  const [jointId] = useState(() => createId("joint"));
  const joint = useMemo((): AssemblyJoint | undefined => {
    if (jointType === "none" || alignmentKind !== "face" || !sourceId || !targetId) return;
    const target = destinations.find(item => item.id === targetId); if (!target) return;
    return { id: jointId, name: `${frame.document.components[frame.componentId].name.slice(0, 110)} ${jointType}`, type: jointType,
      parentComponentId: target.componentId, childComponentId: frame.componentId, sourceFaceId: sourceId.slice(5), targetFaceId: targetId.slice(5),
      parentRest: positioned.components[target.componentId].placement ?? IDENTITY_PLACEMENT,
      childRest: placement, gap: clearance, opposite, value: 0, minimum: jointType === "hinge" ? -180 : jointType === "slider" ? -100 : 0, maximum: jointType === "hinge" ? 180 : jointType === "slider" ? 100 : 0 };
  }, [jointType, alignmentKind, sourceId, targetId, destinations, frame, placement, clearance, opposite, positioned]);
  const controller = useRef<AbortController | undefined>(undefined);
  const current = isCurrentComponentPlacement(frame), changed = !same(placement, frame.placement) || Boolean(joint);
  const shown = current && preview && same(preview.placement, placement) && JSON.stringify(preview.document.assemblyJoints?.find(item => item.id === jointId)) === JSON.stringify(joint) ? preview : undefined;
  const close = () => { controller.current?.abort(); controller.current = undefined; cancelComponentPlacement(); };
  useEffect(() => { if (!isCurrentComponentPlacement(frame)) close(); }, [frame, document, session, active, fileBusy, rebuild]);
  useEffect(() => {
    controller.current?.abort(); controller.current = undefined; setBusy(false); setError("");
    if (!current || dragging || !changed) return;
    const request = new AbortController(); controller.current = request;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void previewComponentPlacement(frame, placement, request.signal, joint).then((result) => {
        if (controller.current === request && isCurrentComponentPlacement(frame)) setPreview(result);
      }).catch((failure: unknown) => { if (!request.signal.aborted && controller.current === request) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (controller.current === request) { controller.current = undefined; setBusy(false); } });
    }, 150);
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [frame, placement, current, dragging, changed, joint]);
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
    <p>Pick where this component should meet another component, then Apply. Drag the handles to move it freely.</p>
    <div className="extrude-dialog-layout"><div>
    <fieldset disabled={!current || dragging}><legend>Align to another component</legend>
      <label>Keep connected<select value={jointType} onChange={event => setJointType(event.target.value as typeof jointType)} disabled={alignmentKind !== "face"}><option value="none">Placement only</option><option value="rigid">Rigid joint</option><option value="hinge">Hinge joint</option><option value="slider">Slider joint</option></select></label>
      {jointType !== "none" ? <p>Choose two flat faces. Their normal sets the motion axis; the destination face origin sets the hinge pivot. Use Assembly motion after applying.</p> : null}
      <p>1. Pick a face, edge or point on this component. 2. Pick its destination. The preview updates automatically.</p>
      <label>Alignment geometry<select value={alignmentKind} onChange={event => { const kind = event.target.value as ComponentAlignmentTarget["kind"]; setAlignmentKind(kind); setSourceId(""); setTargetId(""); setClearance(0); setOpposite(kind === "face"); setAlignmentPending(false); setPicking(targets.some(target => target.componentId === frame.componentId && target.kind === kind) && targets.some(target => target.componentId !== frame.componentId && target.kind === kind) ? "source" : undefined); setError(""); }}><option value="face">Flat faces</option><option value="edge">Straight edges</option><option value="point">Points</option></select></label>
      <label>Source geometry<select value={sourceId} onChange={event => choose("source", event.target.value)}><option value="">Choose geometry on this component</option>{sources.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <button type="button" disabled={dirty || !sources.length} aria-pressed={picking === "source"} onClick={() => setPicking("source")}>Pick source in preview</button>
      <label>Target geometry<select value={targetId} onChange={event => choose("target", event.target.value)}><option value="">Choose geometry on another component</option>{destinations.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
      <button type="button" disabled={dirty || !sourceId || !destinations.length} aria-pressed={picking === "target"} onClick={() => setPicking("target")}>Pick target in preview</button>
      {alignmentKind === "face" ? <label>Gap (mm)<CommitInput value={display(clearance)} onCommit={text => { const value = text.trim() ? Number(text) : NaN; setAlignmentPending(true); if (!Number.isFinite(value) || Math.abs(value) > 1e8) { setError("Enter a finite gap within ±100,000,000 mm."); return; } setClearance(value); setError(""); setAlignmentPending(Boolean(sourceId || targetId)); if (sourceId && targetId) align(sourceId, targetId, value); }} /></label> : null}
      {alignmentKind !== "point" ? <label><input type="checkbox" checked={opposite} onChange={event => { setOpposite(event.target.checked); setAlignmentPending(Boolean(sourceId || targetId)); setError(""); if (sourceId && targetId) align(sourceId, targetId, clearance, event.target.checked); }} />Flip direction</label> : null}
      <button type="button" onClick={() => { setSourceId(""); setTargetId(""); setAlignmentPending(false); setPicking(undefined); setError(""); }}>Clear alignment choices</button>
      {!destinations.length ? <p role="status">Add another native component to align matching geometry.</p> : null}
      {picking ? <p role="status">Pick a highlighted {picking} reference in the preview, or choose it from the list.</p> : null}
    </fieldset>
    <details><summary>Details · exact placement</summary><fieldset disabled={!current || dragging}><legend>Exact placement</legend>
      {(["translation", "rotation"] as const).map((mode) => <div key={mode}>{([0, 1, 2] as const).map((axis) => <label key={axis}>{mode === "translation" ? "Position" : "Rotation"} {["X", "Y", "Z"][axis]} ({mode === "translation" ? "mm" : "deg"})<CommitInput value={display(placement[mode][axis] * (mode === "rotation" ? 180 / Math.PI : 1))} onCommit={(text) => commit(mode, axis, text)} /></label>)}</div>)}
    </fieldset><p className="muted">Placement only saves a fixed pose. Keep connected creates an editable joint. Gap follows the destination face direction and does not slide the component along that face.</p></details>
    </div><div>
    <ComponentPlacementControls meshes={(preview ?? { result: frame.result }).result.meshes} meshPlacement={preview?.placement ?? frame.placement} placement={placement} bodyIds={frame.bodyIds} disabled={!current || dirty} onChange={(next) => { setError(""); setAlignmentPending(false); setPicking(undefined); setPlacement(next); }} onDragging={setDragging}
      alignmentTargets={pickTargets} selectedAlignmentTargets={selectedTargets} alignmentPicking={picking} onAlignmentPick={id => { if (picking) choose(picking, id); }} />
    </div></div>
    <button type="button" disabled={!current || dragging || dirty} onClick={() => { setPlacement({ translation: [0, 0, 0], rotation: [0, 0, 0] }); setAlignmentPending(false); setPicking(undefined); setError(""); }}>Reset placement</button>
    <button type="button" disabled={!current || dragging || dirty || busy || alignmentPending || picking !== undefined || !shown || !changed || Boolean(error) || (jointType !== "none" && !joint)} onClick={() => { if (!shown) return; try { applyComponentPlacement(shown, placement); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Apply component placement</button>
    <button type="button" onClick={close}>Cancel placement</button>
    <p role="status" aria-label="Placement status">{dragging ? "Moving live. Native validation runs when you release the handle." : dirty ? "Finish the field with Enter or leave it before Apply." : picking ? (picking === "source" ? "Step 1 of 2: choose geometry on this component." : "Step 2 of 2: choose its destination on another component.") : alignmentPending ? "Choose matching geometry to update the preview, or Clear alignment choices to move freely." : busy ? "Validating placed native solids…" : shown ? "Native placement is valid. Apply saves one undo step." : changed ? "Waiting for a current native placement preview…" : "Drag a handle or enter exact values. The project is unchanged until Apply."}</p>
    {error ? <p role="alert">{error}</p> : null}
    <p className="muted">Position uses millimeters; rotation uses degrees in X, then Y, then Z order. Rotations use the component design origin. </p>
  </section></ModalDialog>;
}
