import { useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { canOpenSketchProjection, openSketchProjection, breakCurrentSketchProjection, removeCurrentSketchProjection } from "../commands/sketchProjectionCommand";

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
