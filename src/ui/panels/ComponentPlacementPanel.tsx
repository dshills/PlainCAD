import { useEffect, useRef, useState } from "react";
import type { ComponentPlacement } from "../../cad/document/schema";
import { validComponentPlacement } from "../../cad/document/componentPlacement";
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
    setError(""); setPlacement(next);
  };
  return <ModalDialog label="Move or rotate component" className="file-dialog model-dialog extrude-dialog" onDismiss={close}><section className="sketch-trim-extend component-placement-panel" aria-label="Move or rotate component" onChangeCapture={(event) => { if (event.target instanceof HTMLInputElement) setDirty(true); }} onBlurCapture={() => setDirty(false)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!(event.target instanceof HTMLInputElement)) close(); } }}>
    <h3>Move / Rotate · {frame.document.components[frame.componentId].name}</h3>
    <p>Place the component’s finished parts. Sketch dimensions and feature geometry stay in their authored design coordinates.</p>
    <div className="extrude-dialog-layout"><div>
    <fieldset disabled={!current || dragging}><legend>Exact placement</legend>
      {(["translation", "rotation"] as const).map((mode) => <div key={mode}>{([0, 1, 2] as const).map((axis) => <label key={axis}>{mode === "translation" ? "Position" : "Rotation"} {["X", "Y", "Z"][axis]} ({mode === "translation" ? "mm" : "deg"})<CommitInput value={display(placement[mode][axis] * (mode === "rotation" ? 180 / Math.PI : 1))} onCommit={(text) => commit(mode, axis, text)} /></label>)}</div>)}
    </fieldset>
    </div><div>
    <ComponentPlacementControls meshes={(preview ?? { result: frame.result }).result.meshes} meshPlacement={preview?.placement ?? frame.placement} placement={placement} bodyIds={frame.bodyIds} disabled={!current || dirty} onChange={(next) => { setError(""); setPlacement(next); }} onDragging={setDragging} />
    </div></div>
    <button type="button" disabled={!current || dragging || dirty} onClick={() => { setPlacement({ translation: [0, 0, 0], rotation: [0, 0, 0] }); setError(""); }}>Reset placement</button>
    <button type="button" disabled={!current || dragging || dirty || busy || !shown || !changed || Boolean(error)} onClick={() => { if (!shown) return; try { applyComponentPlacement(shown, placement); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } }}>Apply component placement</button>
    <button type="button" onClick={close}>Cancel placement</button>
    <p role="status" aria-label="Placement status">{dragging ? "Moving live. Native validation runs when you release the handle." : dirty ? "Finish the exact field with Enter or leave it before Apply." : busy ? "Validating placed native solids…" : shown ? "Native placement is valid. Apply saves one undo step." : changed ? "Waiting for a current native placement preview…" : "Drag a handle or enter exact values. The project is unchanged until Apply."}</p>
    {error ? <p role="alert">{error}</p> : null}
    <p className="muted">Position uses millimeters; rotation uses degrees in X, then Y, then Z order. Rotations use the component design origin, not the center of its bounding box. Existing linked projections follow design geometry; new cross-component projections require matching placements.</p>
  </section></ModalDialog>;
}
