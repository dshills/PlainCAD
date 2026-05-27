import { useCadStore } from "../../state/useCadStore";

export function RebuildErrorsPanel() {
  const rebuild = useCadStore((state) => state.rebuild);
  const result = useCadStore((state) => state.rebuild.result);
  const fileError = useCadStore((state) => state.fileError);
  const setFileError = useCadStore((state) => state.setFileError);
  const select = useCadStore((state) => state.select);
  return (
    <section className="panel" aria-labelledby="rebuild-heading">
      <h2 id="rebuild-heading">Rebuild</h2>
      <p className="muted">
        Status {rebuild.status}
        {result ? `, ${result.durationMs.toFixed(1)}ms, ${result.meshes.length} mesh(es)` : ""}
      </p>
      {fileError ? (
        <button className="item-card error-text" onClick={() => setFileError(undefined)}>
          File: {fileError}
        </button>
      ) : null}
      {result?.errors.map((error) => (
        <button
          key={error.id}
          className="item-card error-text"
          onClick={() => {
            const document = useCadStore.getState().history.present;
            const target = selectionForErrorSource(error.source, error.sourceId, document);
            if (target) select(target);
          }}
        >
          {error.source}: {error.message}
        </button>
      ))}
      {result?.warnings.map((warning) => (
        <button
          key={warning.id}
          className="item-card warning-text"
          onClick={() => {
            const document = useCadStore.getState().history.present;
            const target = selectionForErrorSource(warning.source, warning.sourceId, document);
            if (target) select(target);
          }}
        >
          {warning.source}: {warning.message}
        </button>
      ))}
      {result && result.errors.length === 0 && result.warnings.length === 0 && !fileError ? <p className="muted">No rebuild issues.</p> : null}
    </section>
  );
}

type ErrorSource = NonNullable<ReturnType<typeof useCadStore.getState>["rebuild"]["result"]>["errors"][number]["source"];

function selectionForErrorSource(
  source: ErrorSource,
  sourceId: string | undefined,
  document: ReturnType<typeof useCadStore.getState>["history"]["present"] | undefined,
) {
  if (!sourceId || !document) return undefined;
  if (source === "parameter" && document.parameters[sourceId]) return { kind: "parameter" as const, id: sourceId, documentId: document.id };
  if (source === "sketch" && document.sketches[sourceId]) return { kind: "sketch" as const, id: sourceId, documentId: document.id };
  if (source === "feature" && document.features.some((feature) => feature.id === sourceId)) return { kind: "feature" as const, id: sourceId, documentId: document.id };
  return undefined;
}
