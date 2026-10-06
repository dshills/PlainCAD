import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { cancelFacePocket, chooseFacePocketFace, drawOnPocketFace, facePocketCurrent, facePocketFaces, useFacePocket } from "../commands/facePocketCommand";
import { useSketchPlanePicker } from "../commands/sketchPlanePicker";
import "./SketchSolidHandoffPanel.css";

export function FacePocketPanel() {
  const frame = useFacePocket((store) => store.frame);
  const state = useCadStore(useShallow((store) => ({ history: store.history, rebuild: store.rebuild,
    fileBusy: store.fileBusy, activeComponentId: store.activeComponentId, documentSession: store.documentSession })));
  useViewerState(useShallow((store) => ({ session: store.session, hiddenBodyIds: store.hiddenBodyIds, hiddenComponentIds: store.hiddenComponentIds })));
  const { error, hover } = useSketchPlanePicker();
  const current = Boolean(frame && facePocketCurrent(frame));
  useEffect(() => { if (frame && !current) cancelFacePocket(); }, [frame, current, state]);
  useEffect(() => {
    if (!frame) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); cancelFacePocket(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [frame]);
  if (!frame || !current) return null;
  const faces = facePocketFaces();
  const selected = faces.find((choice) => choice.id === frame.choiceId);
  const run = (action: () => void) => { try { action(); } catch (failure) { useSketchPlanePicker.setState({ error: failure instanceof Error ? failure.message : String(failure) }); } };
  return <section className="sketch-solid-handoff" aria-label="Draw on a face">
    <h2>Choose a face to draw on</h2>
    <p>Click a highlighted supported planar face, or choose it below. Draw here creates one editable sketch on that face.</p>
    <div className="sketch-solid-regions" role="group" aria-label="Supported pocket faces">
      {faces.map((choice) => <button type="button" key={choice.id} aria-pressed={selected?.id === choice.id}
        onClick={() => run(() => chooseFacePocketFace(choice.id))}
        onPointerEnter={() => useSketchPlanePicker.setState({ hover: choice })}
        onFocus={() => useSketchPlanePicker.setState({ hover: choice })}
        onPointerLeave={() => useSketchPlanePicker.setState({ hover: selected })}
        onBlur={() => useSketchPlanePicker.setState({ hover: selected })}>{choice.label}</button>)}
    </div>
    <p role="status">{selected ? `Selected: ${selected.label}. Cut direction: inward, opposite the face normal.` : hover ? `Highlighted: ${hover.label}` : "Select a face before continuing."}</p>
    <p className="muted">Curved, lost, split and ambiguous faces are unavailable. After drawing, Finish Sketch → Remove material previews an inward cut of this face's body.</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="sketch-solid-actions"><button type="button" onClick={cancelFacePocket}>Cancel</button>
      <button type="button" disabled={!selected} onClick={() => run(drawOnPocketFace)}>Draw here</button></div>
  </section>;
}
