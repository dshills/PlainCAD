import { useEffect, useRef, useState } from "react";
import { runCommand } from "../commands/commandRegistry";
import { useCadStore } from "../../state/useCadStore";
import { orderedParameters } from "../../state/selectors";
import {
  displayUnits,
  formatParameterQuantity,
} from "../../cad/parameters/parameterUnits";
import { UnitDefaultsPanel } from "./UnitDefaultsPanel";
import type { Quantity } from "../../cad/parameters/units";
import "./ParameterPanel.css";

const EMPTY_ERRORS: import("../../cad/worker/workerProtocol").RebuildError[] =
  [];

export function ParameterPanel() {
  const document = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const [renaming, setRenaming] = useState<string>();
  const previousValues = useRef<{ session: number; documentId: string; values: Map<string, Quantity> }>({ session, documentId: document.id, values: new Map() });
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
  const cache = previousValues.current;
  const cachedValues = cache.session === session && cache.documentId === document.id
    ? cache.values : undefined;
  useEffect(() => {
    if (previousValues.current.session !== session || previousValues.current.documentId !== document.id) {
      previousValues.current = { session, documentId: document.id, values: new Map() };
      setRenaming(undefined);
    }
    if (!current) return;
    const entries = new Map<string, Quantity>();
    for (const parameter of Object.values(document.parameters)) {
      const quantity = values?.[parameter.name];
      const invalid = errors.some((error) => error.source === "parameter" &&
        (error.sourceId === parameter.name || error.sourceId === parameter.id));
      if (!invalid && quantity && Number.isFinite(quantity.value)) entries.set(parameter.id, quantity);
    }
    previousValues.current.values = entries;
  }, [current, document, errors, session, values]);
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
                  <div className="item-card parameter-card" key={`${session}:${document.id}:${parameter.id}`}>
                    <div className="parameter-name-row">
                      <strong className="parameter-name">{parameter.name}</strong>
                      <button type="button" aria-label={`Rename parameter ${parameter.name}`}
                        aria-expanded={renaming === parameter.id}
                        onClick={() => setRenaming(renaming === parameter.id ? undefined : parameter.id)}>Rename</button>
                    </div>
                    {renaming === parameter.id ? <ParameterCommitInput
                      ariaLabel={`Parameter ${parameter.name} name`}
                      value={parameter.name}
                      autoFocus
                      onFocus={() => select({ kind: "parameter", id: parameter.id, documentId: document.id })}
                      onCommit={(value) => { updateParameter(parameter.id, { name: value }); setRenaming(undefined); }}
                    /> : null}
                    <label className="parameter-expression-label">
                      Expression
                      <ParameterCommitInput
                        ariaLabel={`Parameter ${parameter.name} expression`}
                        value={parameter.expression}
                        onFocus={() => select({ kind: "parameter", id: parameter.id, documentId: document.id })}
                        onCommit={(value) => updateParameter(parameter.id, { expression: value })}
                      />
                    </label>
                    <output className="muted parameter-value" aria-label={`Computed parameter ${parameter.name}`}>
                      {current ? formatParameterQuantity(error ? undefined : values?.[parameter.name], displayUnits(document)) :
                        status === "failed" ? "Unavailable" :
                        `Updating…${cachedValues?.has(parameter.id) ? ` Previous: ${formatParameterQuantity(cachedValues.get(parameter.id), displayUnits(document))} (stale)` : ""}`}
                    </output>
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
  autoFocus = false,
}: {
  ariaLabel: string;
  autoFocus?: boolean;
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
      autoFocus={autoFocus}
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
