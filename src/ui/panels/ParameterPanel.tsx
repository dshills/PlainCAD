import { useEffect, useRef, useState } from "react";
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
                <ParameterCommitInput
                  ariaLabel={`Parameter ${parameter.name} name`}
                  value={parameter.name}
                  onFocus={() => select({ kind: "parameter", id: parameter.id, documentId: document.id })}
                  onCommit={(value) => updateParameter(parameter.id, { name: value })}
                />
                <ParameterCommitInput
                  ariaLabel={`Parameter ${parameter.name} expression`}
                  value={parameter.expression}
                  onFocus={() => select({ kind: "parameter", id: parameter.id, documentId: document.id })}
                  onCommit={(value) => updateParameter(parameter.id, { expression: value })}
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

function ParameterCommitInput({
  ariaLabel,
  value,
  onCommit,
  onFocus,
}: {
  ariaLabel: string;
  value: string;
  onCommit: (value: string) => void;
  onFocus: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelCommit = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [focused, value]);
  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelCommit.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setFocused(false);
        if (cancelCommit.current) {
          cancelCommit.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function formatValue(value: number, unit: string) {
  return `${Number.isFinite(value) ? value.toFixed(2) : "?"}${unit}`;
}
