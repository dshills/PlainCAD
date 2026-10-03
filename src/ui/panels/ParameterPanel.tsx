import { useEffect, useRef, useState } from "react";
import { runCommand } from "../commands/commandRegistry";
import { useCadStore } from "../../state/useCadStore";
import { orderedParameters } from "../../state/selectors";
import {
  displayUnits,
  formatParameterQuantity,
} from "../../cad/parameters/parameterUnits";
import { UnitDefaultsPanel } from "./UnitDefaultsPanel";

const EMPTY_ERRORS: import("../../cad/worker/workerProtocol").RebuildError[] =
  [];

export function ParameterPanel() {
  const document = useCadStore((state) => state.history.present);
  const updateParameter = useCadStore((state) => state.updateParameter);
  const select = useCadStore((state) => state.select);
  const errors = useCadStore(
    (state) => state.rebuild.result?.errors ?? EMPTY_ERRORS,
  );
  const status = useCadStore((state) => state.rebuild.status);
  const result = useCadStore((state) => state.rebuild.result);
  const current =
    (status === "succeeded" || status === "failed") &&
    result?.documentId === document.id;
  const values = current ? result?.parameterValues : undefined;
  const parameters = orderedParameters(document);
  const groups = new Map<string, typeof parameters>();
  for (const parameter of parameters) {
    const group = parameter.group ?? "";
    const items = groups.get(group) ?? [];
    items.push(parameter);
    groups.set(group, items);
  }

  return (
    <section className="panel" aria-labelledby="parameters-heading">
      <h2 id="parameters-heading">Parameters</h2>
      <UnitDefaultsPanel />
      <div className="panel-list">
        {[...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([group, items]) => (
            <fieldset className="parameter-group" key={group}>
              <legend>{group || "Parameters without a group"}</legend>
              {items.map((parameter) => {
                const error = errors.find(
                  (item) =>
                    item.source === "parameter" &&
                    (item.sourceId === parameter.name ||
                      item.sourceId === parameter.id),
                );
                return (
                  <div className="item-card" key={parameter.id}>
                    <div className="row">
                      <ParameterCommitInput
                        ariaLabel={`Parameter ${parameter.name} name`}
                        value={parameter.name}
                        onFocus={() =>
                          select({
                            kind: "parameter",
                            id: parameter.id,
                            documentId: document.id,
                          })
                        }
                        onCommit={(value) =>
                          updateParameter(parameter.id, { name: value })
                        }
                      />
                      <ParameterCommitInput
                        ariaLabel={`Parameter ${parameter.name} expression`}
                        value={parameter.expression}
                        onFocus={() =>
                          select({
                            kind: "parameter",
                            id: parameter.id,
                            documentId: document.id,
                          })
                        }
                        onCommit={(value) =>
                          updateParameter(parameter.id, { expression: value })
                        }
                      />
                      <output
                        className="muted"
                        aria-label={`Computed parameter ${parameter.name}`}
                      >
                        {formatParameterQuantity(
                          values?.[parameter.name],
                          displayUnits(document),
                        )}
                      </output>
                    </div>
                    {current && error ? (
                      <div className="error-text">{error.message}</div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
          ))}
      </div>
      <p>
        <button onClick={() => runCommand("parameter.add")}>
          Add Parameter
        </button>
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
