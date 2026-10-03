import { useMemo, useState } from "react";
import {
  buildDependencyGraph,
  dependencySelectionKey,
  traceDependencies,
  type DependencyEntry,
} from "../../cad/document/dependencyGraph";
import { useCadStore } from "../../state/useCadStore";

const PAGE_SIZE = 50;

export function DependencyPanel() {
  const document = useCadStore((s) => s.history.present);
  const selection = useCadStore((s) => s.selection.selectedIds[0]);
  const graph = useMemo(() => buildDependencyGraph(document), [document]);
  const root = dependencySelectionKey(graph, selection, document.id);
  const node = root ? graph.nodes.get(root) : undefined;
  const inputs = useMemo(
    () => (root ? traceDependencies(graph, root, "inputs") : undefined),
    [graph, root],
  );
  const outputs = useMemo(
    () => (root ? traceDependencies(graph, root, "outputs") : undefined),
    [graph, root],
  );
  return (
    <section className="panel" aria-labelledby="dependencies-heading">
      <h2 id="dependencies-heading">Dependencies</h2>
      {node && inputs && outputs ? (
        <div key={`${document.id}:${root}`}>
          <p>
            Inspecting {node.kind} <strong>{node.label}</strong>
            {node.suppressed ? " (suppressed)" : ""}.
          </p>
          {inputs.cycle || outputs.cycle ? (
            <p className="warning-text">
              This dependency chain contains a cycle returning to the selection.
              Repair its references or expressions.
            </p>
          ) : null}
          {node.malformedExpression ? (
            <p className="warning-text">
              An expression has invalid tokens. Only saved bindings can be
              traced until it is repaired.
            </p>
          ) : null}
          <DependencyList
            key={`inputs:${root}`}
            direction="inputs"
            title="Inputs"
            entries={inputs.entries}
            documentId={document.id}
          />
          <DependencyList
            key={`outputs:${root}`}
            direction="outputs"
            title="Affected outputs"
            entries={outputs.entries}
            documentId={document.id}
          />
          <p className="muted">
            Authored references, including suppressed and missing items. Target
            chains include preceding modifiers. Selecting a body traces its
            latest unsuppressed writer; runtime diagnostics determine whether it
            built successfully.
          </p>
        </div>
      ) : (
        <p className="muted">
          Select a parameter, sketch, sketch entity, feature or body to trace
          its inputs and affected outputs.
        </p>
      )}
    </section>
  );
}
function DependencyList({
  direction,
  title,
  entries,
  documentId,
}: {
  direction: "inputs" | "outputs";
  title: string;
  entries: DependencyEntry[];
  documentId: string;
}) {
  const select = useCadStore((s) => s.select);
  const [limit, setLimit] = useState(PAGE_SIZE);
  return (
    <div>
      <h3>
        {title} ({entries.length})
      </h3>
      {entries.length ? (
        <ul className="dependency-list" aria-label={title}>
          {entries.slice(0, limit).map(({ node, distance, via, reasons }) => (
            <li key={node.key}>
              <button
                type="button"
                disabled={node.missing}
                aria-label={`Inspect ${node.kind} ${node.label}`}
                onClick={() =>
                  select({ kind: node.kind, id: node.id, documentId })
                }
              >
                {node.kind}: {node.label}
              </button>
              <span className={node.missing ? "warning-text" : "muted"}>
                {node.missing ? "Missing reference. " : ""}
                {node.suppressed ? "Suppressed. " : ""}
                {distance === 1 ? "Direct" : `${distance} steps`} · Link:{" "}
                {reasons.join(", ")} ·{" "}
                {direction === "inputs" ? "Feeds" : "Uses"} {via.label}
                {node.malformedExpression ? " · Invalid expression tokens" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}
      {entries.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + PAGE_SIZE)}
        >
          Show more {title.toLowerCase()}
        </button>
      ) : null}
    </div>
  );
}
