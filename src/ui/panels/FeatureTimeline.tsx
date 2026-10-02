import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { orderedFeatures, orderedSketches } from "../../state/selectors";
import { CommandContext, isCommandEnabledForSnapshot, runCommand, selectCommandEnablement } from "../commands/commandRegistry";
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
  const select = useCadStore((state) => state.select);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const commandEnablement = useCadStore(useShallow(selectCommandEnablement));
  const features = useMemo(() => orderedFeatures(document), [document]);
  const sketches = useMemo(() => orderedSketches(document), [document]);
  const timelineItems = useMemo(() => buildTimelineItems(sketches, features), [sketches, features]);
  const selectedFeatureId = selection?.kind === "feature" ? selection.id : undefined;
  const selectedSketchId = selection?.kind === "sketch" ? selection.id : undefined;

  return (
    <section className="timeline-panel" aria-labelledby="timeline-heading">
      <div className="timeline-header">
        <h2 id="timeline-heading">Parametric Timeline</h2>
        <div className="timeline-actions" aria-label="Timeline commands">
          <button onClick={() => runCommand("feature.extrude", commandContext)} disabled={!isCommandEnabledForSnapshot("feature.extrude", commandEnablement)}>Extrude</button>
          {["revolve", "fillet", "chamfer"].map((type) => <button key={type} onClick={() => runCommand(`feature.${type}`, commandContext)} disabled={!isCommandEnabledForSnapshot(`feature.${type}`, commandEnablement)}>{type[0].toUpperCase() + type.slice(1)}</button>)}
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
      <div className="timeline-track" role="list" aria-label="Sketch and feature history">
        {timelineItems.map((item) => {
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
