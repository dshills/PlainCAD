import { useCadStore } from "../../state/useCadStore";

export function RebuildErrorsPanel() {
  const result = useCadStore((state) => state.rebuild.result);
  const select = useCadStore((state) => state.select);
  const documentId = useCadStore((state) => state.history.present.id);
  return (
    <section className="panel">
      <h2>Rebuild</h2>
      {result ? <p className="muted">{result.durationMs.toFixed(1)}ms, {result.meshes.length} mesh(es)</p> : null}
      {result?.errors.map((error) => (
        <button
          key={error.id}
          className="item-card error-text"
          onClick={() => error.sourceId && select({ kind: error.source === "parameter" ? "parameter" : "feature", id: error.sourceId, documentId })}
        >
          {error.message}
        </button>
      ))}
      {result?.warnings.map((warning) => (
        <div key={warning.id} className="item-card muted">{warning.message}</div>
      ))}
      {result && result.errors.length === 0 && result.warnings.length === 0 ? <p className="muted">No rebuild issues.</p> : null}
    </section>
  );
}
