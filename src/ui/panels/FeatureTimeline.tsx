import { featureComponentId, sketchComponentId } from "../../cad/document/components";
import { activeComponentId } from "../commands/projectWorkflowCommand";
import { useViewerState } from "../../state/viewerState";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { useMemo } from "react";
import { useCadStore } from "../../state/useCadStore";
import { orderedFeatures, orderedSketches } from "../../state/selectors";
import { CommandContext, isCommandEnabledForSnapshot, runCommand, } from "../commands/commandRegistry";
import { Feature } from "../../cad/document/schema";
import { buildTimelineItems } from "../../cad/document/timelineOrdering";
import { planTimelineMove } from "../../cad/document/timelineEditing";
export { buildTimelineItems } from "../../cad/document/timelineOrdering";

interface FeatureTimelineProps {
  commandContext?: CommandContext;
}

const emptyCommandContext: CommandContext = {};

export function FeatureTimeline({ commandContext = emptyCommandContext }: FeatureTimelineProps) {
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore(state => state.documentSession);
  const componentId = useCadStore(activeComponentId);
  const view = useViewerState();
  const filtered = view.session === session && view.activeComponentTimeline;
  // Activation clears selection; selecting a timeline item activates its owner.
  // The filter therefore cannot leave another component’s selected item hidden.
  const select = useCadStore((state) => state.select);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const commandEnablement = useCommandEnablement();
  const features = useMemo(() => orderedFeatures(document), [document]);
  const sketches = useMemo(() => orderedSketches(document), [document]);
  const timelineItems = useMemo(() => buildTimelineItems(sketches, features), [sketches, features]);
  const selectedFeatureId = selection?.kind === "feature" ? selection.id : undefined;
  const selectedSketchId = selection?.kind === "sketch" ? selection.id : undefined;

  return (
    <section className="timeline-panel" aria-labelledby="timeline-heading">
      <div className="timeline-header">
        <h2 id="timeline-heading">Parametric Timeline</h2>
        <label className="timeline-filter"><input type="checkbox" aria-label="Timeline: active component only" checked={filtered} onChange={() => void runCommand("timeline.toggleComponentFilter")} /> Active component only</label>
        <div className="timeline-actions" aria-label="Timeline commands">
          <button onClick={() => runCommand("feature.extrude", commandContext)} disabled={!isCommandEnabledForSnapshot("feature.extrude", commandEnablement)}>Extrude</button>
          {["revolve", "hole", "fillet", "chamfer"].map((type) => <button key={type} onClick={() => runCommand(`feature.${type}`, commandContext)} disabled={!isCommandEnabledForSnapshot(`feature.${type}`, commandEnablement)}>{type[0].toUpperCase() + type.slice(1)}</button>)}
          <button onClick={() => runCommand("feature.suppress", commandContext)} disabled={!isCommandEnabledForSnapshot("feature.suppress", commandEnablement)}>Suppress</button>
          <button onClick={() => runCommand("feature.delete", commandContext)} disabled={!isCommandEnabledForSnapshot("feature.delete", commandEnablement)}>Delete</button>
          {(["earlier", "later"] as const).map((direction) => {
            const id = `timeline.move${direction === "earlier" ? "Earlier" : "Later"}`;
            const reason = planTimelineMove(document, selection, direction).reason;
            return <button key={id} title={reason ?? `Move selected item ${direction}`} onClick={() => runCommand(id, commandContext)} disabled={!isCommandEnabledForSnapshot(id, commandEnablement)}>Move {direction}</button>;
          })}
        </div>
      </div>
      {selection?.kind === "feature" || selection?.kind === "sketch" ? <p className="muted">{(["earlier", "later"] as const).flatMap((direction) => {
        const reason = planTimelineMove(document, selection, direction).reason;
        return reason ? [`Cannot move ${direction}: ${reason}`] : [];
      }).join(" ")}</p> : null}
      {filtered ? <p className="muted">Showing {document.components[componentId]?.name}. Timeline moves use the complete project order.</p> : null}
      <div className="timeline-track" role="list" aria-label="Sketch and feature history">
        {timelineItems.filter(item => !filtered || (item.kind === "sketch" ? sketchComponentId(document, item.sketch.id) : featureComponentId(document, item.feature)) === componentId).map((item) => {
          if (item.kind === "sketch") {
            const sketch = item.sketch;
            return (
              <div className="timeline-item" key={`sketch:${sketch.id}`} role="listitem">
                <button
                  className={`timeline-chip sketch-chip ${selectedSketchId === sketch.id ? "selected" : ""}`}
                  onClick={() => select({ kind: "sketch", id: sketch.id, documentId: document.id })}
                >
                  <span className="timeline-glyph">S</span>
                  <strong>{sketch.name}</strong>
                  <span className="timeline-owner">{document.components[sketchComponentId(document, sketch.id)]?.name}</span>
                  <span>{Object.keys(sketch.entities).length} entities</span>
                </button>
              </div>
            );
          }
          const feature = item.feature;
          return (
            <div className="timeline-item" key={`feature:${feature.id}`} role="listitem">
              <button
                className={`timeline-chip feature-chip ${selectedFeatureId === feature.id ? "selected" : ""}`}
                onClick={() => select({ kind: "feature", id: feature.id, documentId: document.id })}
              >
                <span className="timeline-glyph">{featureGlyph(feature)}</span>
                <strong>{feature.name}</strong>
                <span className="timeline-owner">{document.components[featureComponentId(document, feature)]?.name}</span>
                <span>{feature.type}{feature.suppressed ? " suppressed" : ""}</span>
              </button>
            </div>
          );
        })}
        {timelineItems.length === 0 ? <p className="muted">Create a sketch, add geometry, then extrude a profile.</p> : null}
      </div>
    </section>
  );
}

function featureGlyph(feature: Feature): string {
  if (feature.type === "extrude") return "E";
  if (feature.type === "hole") return "H";
  if (feature.type === "fillet") return "F";
  if (feature.type === "chamfer") return "C";
  return "F";
}
