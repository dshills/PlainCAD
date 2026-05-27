import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { orderedFeatures } from "../../state/selectors";
import { isCommandEnabledForSnapshot, runCommand, selectCommandEnablement } from "../commands/commandRegistry";

export function FeatureTimeline() {
  const document = useCadStore((state) => state.history.present);
  const select = useCadStore((state) => state.select);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const commandEnablement = useCadStore(useShallow(selectCommandEnablement));
  const features = orderedFeatures(document);
  const selectedFeatureId = selection?.kind === "feature" ? selection.id : undefined;

  return (
    <section className="panel">
      <h2>Feature Timeline</h2>
      <div className="toolbar-actions panel-actions">
        <button onClick={() => runCommand("feature.extrude")} disabled={!isCommandEnabledForSnapshot("feature.extrude", commandEnablement)}>Extrude</button>
        <button onClick={() => runCommand("feature.suppress")} disabled={!isCommandEnabledForSnapshot("feature.suppress", commandEnablement)}>Suppress</button>
        <button onClick={() => runCommand("feature.delete")} disabled={!isCommandEnabledForSnapshot("feature.delete", commandEnablement)}>Delete</button>
      </div>
      <div className="panel-list">
        {features.map((feature) => (
          <button
            className={`item-card ${selectedFeatureId === feature.id ? "selected" : ""}`}
            key={feature.id}
            onClick={() => select({ kind: "feature", id: feature.id, documentId: document.id })}
          >
            <strong>{feature.name}</strong>
            <span className="muted"> {feature.type}{feature.suppressed ? " suppressed" : ""}</span>
          </button>
        ))}
        {features.length === 0 ? <p className="muted">No features yet.</p> : null}
      </div>
    </section>
  );
}
