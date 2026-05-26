import { useCadStore } from "../../state/useCadStore";
import { orderedSketches } from "../../state/selectors";

export function SketchPanel() {
  const document = useCadStore((state) => state.history.present);
  const select = useCadStore((state) => state.select);
  const sketches = orderedSketches(document);
  return (
    <section className="panel">
      <h2>Sketches</h2>
      <div className="panel-list">
        {sketches.map((sketch) => (
          <button
            className="item-card"
            key={sketch.id}
            onClick={() => select({ kind: "sketch", id: sketch.id, documentId: document.id })}
          >
            <strong>{sketch.name}</strong>
            <span className="muted"> {Object.keys(sketch.entities).length} entities</span>
          </button>
        ))}
        {sketches.length === 0 ? <p className="muted">Create a template to add sketches.</p> : null}
      </div>
    </section>
  );
}
