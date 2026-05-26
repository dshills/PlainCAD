import { runCommand } from "../commands/commandRegistry";
import { useCadStore } from "../../state/useCadStore";
import { orderedParameters } from "../../state/selectors";

export function ParameterPanel() {
  const document = useCadStore((state) => state.history.present);
  const updateParameter = useCadStore((state) => state.updateParameter);
  const select = useCadStore((state) => state.select);
  const errors = useCadStore((state) => state.rebuild.result?.errors ?? []);
  const parameters = orderedParameters(document);

  return (
    <section className="panel">
      <h2>Parameters</h2>
      <div className="panel-list">
        {parameters.map((parameter) => {
          const error = errors.find((item) => item.source === "parameter" && item.sourceId === parameter.name);
          return (
            <div className="item-card" key={parameter.id}>
              <div className="row">
                <input
                  aria-label={`${parameter.name} name`}
                  value={parameter.name}
                  onFocus={() => select({ kind: "parameter", id: parameter.name, documentId: document.id })}
                  onChange={(event) => updateParameter(parameter.name, { name: event.target.value })}
                />
                <input
                  aria-label={`${parameter.name} expression`}
                  value={parameter.expression}
                  onFocus={() => select({ kind: "parameter", id: parameter.name, documentId: document.id })}
                  onChange={(event) => updateParameter(parameter.name, { expression: event.target.value })}
                />
                <span className="muted">{formatValue(parameter.value, parameter.unit)}</span>
              </div>
              {error ? <div className="error-text">{error.message}</div> : null}
            </div>
          );
        })}
      </div>
      <p>
        <button onClick={() => runCommand("parameter.add")}>Add Parameter</button>
      </p>
    </section>
  );
}

function formatValue(value: number, unit: string) {
  return `${Number.isFinite(value) ? value.toFixed(2) : "?"}${unit}`;
}
