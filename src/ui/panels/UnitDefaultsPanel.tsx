import {
  ANGLE_UNITS,
  LENGTH_UNITS,
  displayUnits,
} from "../../cad/parameters/parameterUnits";
import type { UnitSettings } from "../../cad/document/schema";
import { useCadStore } from "../../state/useCadStore";
import { touchDocument } from "../../cad/document/CadDocument";

export function UnitDefaultsPanel() {
  const document = useCadStore((s) => s.history.present);
  const update = useCadStore((s) => s.updateDocument);
  return (
    <details className="unit-defaults">
      <summary>Unit defaults</summary>
      <p>
        Authored defaults apply when you enter or edit an expression. Display
        units change readouts without changing the part. Explicit unit tokens
        always win.
      </p>
      {(["Authoring", "Display"] as const).flatMap((kind) =>
        (["length", "angle"] as const).map((dimension) => {
          const settings =
            kind === "Authoring"
              ? document.unitSettings
              : displayUnits(document);
          return (
            <label key={`${kind}:${dimension}`}>
              {kind} {dimension} unit
              <select
                value={settings[dimension]}
                aria-label={`${kind} ${dimension} unit`}
                onChange={(e) => {
                  const value = e.target
                    .value as UnitSettings[typeof dimension];
                  update((doc) => {
                    const units = {
                      ...(kind === "Authoring"
                        ? doc.unitSettings
                        : displayUnits(doc)),
                      [dimension]: value,
                    };
                    return touchDocument(
                      kind === "Display"
                        ? { ...doc, displayUnits: units }
                        : {
                            ...doc,
                            unitSettings: units,
                            units:
                              dimension === "length"
                                ? value === "in" || value === "ft"
                                  ? "imperial"
                                  : "metric"
                                : doc.units,
                          },
                    );
                  });
                }}
              >
                {(dimension === "length" ? LENGTH_UNITS : ANGLE_UNITS).map(
                  (unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ),
                )}
              </select>
            </label>
          );
        }),
      )}
    </details>
  );
}
