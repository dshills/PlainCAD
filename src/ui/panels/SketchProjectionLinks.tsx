import { runCommand } from "../commands/commandRegistry";
import { useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { canOpenSketchProjection, openSketchProjection, breakCurrentSketchProjection, removeCurrentSketchProjection } from "../commands/sketchProjectionCommand";
import { linkedSketchContext, linkedSketchSource, canNavigateLinkedSketchSource } from "../commands/linkedSketchCommand";
import "./SketchProjectionLinks.css";

export function SketchProjectionLinks() {
  const document = useCadStore((state) => state.history.present), rebuild = useCadStore((state) => state.rebuild), active = useSketchCanvas((state) => state.active);
  const session = useCadStore((state) => state.documentSession);
  const fileBusy = useCadStore((state) => state.fileBusy);
  const selection = useSketchCanvas((state) => state.selection);
  const [error, setError] = useState("");
  const links = active ? document.sketches[active.sketchId]?.projections ?? [] : [];
  const selectedLinks = selection?.document === document ? links.filter((link) => link.members.some((member) => selection.entityIds.includes(member.targetEntityId))) : [];
  if (!links.length) return null;
  const run = async (action: () => void | Promise<void>) => { try { await action(); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } };
  return <section aria-label="Linked projected boundaries"><h3>Projected boundaries</h3>
    {selectedLinks.length ? <p role="status" aria-label="Linked geometry explanation"><span className="projection-link-badge">Linked</span> Selected geometry follows {selectedLinks.map((link) => {
      const source = active && linkedSketchSource({ document, session, active, link });
      return source ? `${source.part} / ${source.feature.name} / ${source.sketch.name}` : "a missing or unavailable source";
    }).join("; ")}. Selected geometry is linked and read-only. Edit the source to update every dependent link, or make this boundary independent to edit only this sketch.</p> : <p>Dashed drawing curves and Linked badges identify geometry controlled by an earlier part boundary.</p>}
    {links.map((link) => {
      const context = linkedSketchContext(link.id), source = active && linkedSketchSource({ document, session, active, link });
      const feature = document.features.find((item) => item.id === link.sourceFeatureId);
      const selected = selectedLinks.includes(link);
      return <div key={link.id} className={`item-card projection-link-card${selected ? " projection-link-selected" : ""}`} aria-label={`Linked boundary from ${feature?.name ?? "Missing source"}`}>
        <strong><span className="projection-link-badge">Linked</span> {source ? `${source.part} / ` : ""}{feature?.name ?? "Missing source"} · {link.role === "endCapPerimeter" ? "End cap" : "Start cap"}</strong>
        <span className="muted">{link.coordinateSpace === "world" ? "Follows dimensions and component placement" : "Legacy link: follows authored design coordinates"} · {link.members.length} linked items · {link.construction ? "Construction reference" : "Profile geometry"}</span>
        <div className="projection-link-actions">
          <button type="button" disabled={fileBusy || !context || !canNavigateLinkedSketchSource(link.id)} onClick={() => { if (context) void run(() => runCommand("sketch.link.showSource", { linkedSketchTarget: context })); }}>Show source</button>
          <button type="button" disabled={fileBusy || !context || !canNavigateLinkedSketchSource(link.id, true)} onClick={() => { if (context) void run(() => runCommand("sketch.link.editSource", { linkedSketchTarget: context })); }}>Edit source</button>
          <button type="button" title="Repair link by choosing a supported surviving boundary" disabled={fileBusy || !canOpenSketchProjection()} onClick={() => run(() => openSketchProjection(link.id))}>Repair link</button>
          <button type="button" title="Make independent: keeps the current solved geometry and removes this association in one undo step" disabled={fileBusy || !canOpenSketchProjection() || rebuild.status !== "succeeded" || !rebuild.result?.success} onClick={() => run(() => breakCurrentSketchProjection(link.id))}>Make independent</button>
        </div>
        <p className="muted">Removing a boundary deletes its linked geometry. Dependent features may need repair. Undo restores it.</p><button type="button" disabled={fileBusy || !canOpenSketchProjection()} onClick={() => run(() => removeCurrentSketchProjection(link.id))}>Remove projection and geometry</button>
      </div>;
    })}<p>Repair preserves linked members only for the same authored boundary. To switch to a different shape, remove this projection and project the new boundary; repair downstream references explicitly.</p>{error ? <p role="alert">{error}</p> : null}
  </section>;
}
