import { useCadStore } from "../../state/useCadStore";
import { orderedFeatures } from "../../state/selectors";

export function FeatureTimeline() {
  const document = useCadStore((state) => state.history.present);
  const updateDocument = useCadStore((state) => state.updateDocument);
  const select = useCadStore((state) => state.select);
  const features = orderedFeatures(document);

  return (
    <section className="panel">
      <h2>Feature Timeline</h2>
      <div className="panel-list">
        {features.map((feature) => (
          <button
            className="item-card"
            key={feature.id}
            onClick={() => select({ kind: "feature", id: feature.id, documentId: document.id })}
          >
            <strong>{feature.name}</strong>
            <span className="muted"> {feature.type}{feature.suppressed ? " suppressed" : ""}</span>
          </button>
        ))}
        {features.length === 0 ? <p className="muted">No features yet.</p> : null}
      </div>
      {features.length > 0 ? (
        <p>
          <button
            onClick={() => {
              const feature = features[0];
              updateDocument((doc) => ({
                ...doc,
                features: doc.features.map((item) => (item.id === feature.id ? { ...item, suppressed: !item.suppressed } : item)),
              }));
            }}
          >
            Toggle First Feature
          </button>
        </p>
      ) : null}
    </section>
  );
}
