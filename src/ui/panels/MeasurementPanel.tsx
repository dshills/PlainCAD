import { useMemo, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useInspectionState } from "../../state/inspectionState";
import {
  formatMeasuredLength,
  measureWorldPoint,
  measureSketchEntity,
  pointDistance,
  type SketchMeasurementRef,
} from "../../cad/inspection/measurements";
import type { UnitSettings } from "../../cad/document/schema";
import { displayUnits } from "../../cad/parameters/parameterUnits";

function refKey(ref?: SketchMeasurementRef) {
  return ref ? JSON.stringify([ref.sketchId, ref.entityId]) : "";
}
export function MeasurementPanel() {
  const session = useCadStore((s) => s.documentSession);
  return <MeasurementSession key={session} session={session} />;
}
function MeasurementSession({ session }: { session: number }) {
  const document = useCadStore((s) => s.history.present);
  const rebuild = useCadStore((s) => s.rebuild);
  const inspection = useInspectionState();
  const [unitOverride, setUnit] = useState<UnitSettings["length"]>();
  const unit = unitOverride ?? displayUnits(document).length;
  const refs = inspection.session === session ? inspection : undefined;
  const options = useMemo(
    () =>
      Object.values(document.sketches).flatMap((sketch) => {
        const counts: Record<string, number> = {};
        return Object.values(sketch.entities).map((entity) => {
          counts[entity.type] = (counts[entity.type] ?? 0) + 1;
          const ref = { sketchId: sketch.id, entityId: entity.id };
          return {
            ref,
            key: refKey(ref),
            type: entity.type,
            label: `${sketch.name} — ${entity.type} ${counts[entity.type]}${entity.construction ? " (construction)" : ""}`,
          };
        });
      }),
    [document.sketches],
  );
  const current =
    rebuild.status === "succeeded" &&
    rebuild.result?.success &&
    rebuild.result.documentId === document.id;
  let distance: ReturnType<typeof pointDistance> | undefined;
  let entity: ReturnType<typeof measureSketchEntity> | undefined;
  const errors: string[] = [];
  const result = current ? rebuild.result : undefined;
  if (result && refs?.first && refs.second) {
    try {
      distance = pointDistance(
        measureWorldPoint(document, result, refs.first),
        measureWorldPoint(document, result, refs.second),
      );
    } catch (e) {
      errors.push(
        `Point distance: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (result && refs?.entity) {
    try {
      entity = measureSketchEntity(document, result, refs.entity);
    } catch (e) {
      errors.push(
        `Curve measurement: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const picker = (
    field: "first" | "second" | "entity",
    label: string,
    points: boolean,
  ) => {
    const value = refKey(refs?.[field]);
    const filtered = options.filter((option) =>
      points
        ? option.type === "point"
        : ["line", "circle", "arc"].includes(option.type),
    );
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={!current}
          onChange={(event) =>
            inspection.setReference(
              session,
              field,
              filtered.find((option) => option.key === event.target.value)?.ref,
            )
          }
        >
          <option value="">Choose geometry</option>
          {value && !filtered.some((option) => option.key === value) ? (
            <option value={value}>Unavailable reference — reselect</option>
          ) : null}
          {filtered.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <section className="panel" aria-label="Measurements">
      <h2>Measure</h2>
      <p className="muted">
        Solved sketch geometry in the global frame. Line/arc lengths and radii
        refer to authored sketch entities.
      </p>
      <label>
        Measurement units
        <select
          aria-label="Measurement units"
          value={unit}
          onChange={(e) => setUnit(e.target.value as UnitSettings["length"])}
        >
          {(["mm", "cm", "m", "in", "ft"] as const).map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      <div className="inspector-form">
        {picker("first", "Measurement first point", true)}
        {picker("second", "Measurement second point", true)}
        {picker("entity", "Measurement curve", false)}
      </div>
      {!current ? (
        <p role="status">
          Measurements unavailable until the current model rebuild succeeds.
        </p>
      ) : null}
      {errors.length ? <p role="alert">{errors.join(" ")}</p> : null}
      {distance ? (
        <dl className="inspector-facts">
          <div>
            <dt>Point distance</dt>
            <dd aria-label="Point distance">
              {formatMeasuredLength(distance.length, unit)}
            </dd>
          </div>
          <div>
            <dt>World delta X / Y / Z</dt>
            <dd>
              {[distance.delta.x, distance.delta.y, distance.delta.z]
                .map((v) => formatMeasuredLength(v, unit))
                .join(" / ")}
            </dd>
          </div>
        </dl>
      ) : null}
      {entity ? (
        <dl className="inspector-facts">
          <div>
            <dt>Solved curve length</dt>
            <dd aria-label="Solved curve length">
              {formatMeasuredLength(entity.length, unit)}
            </dd>
          </div>
          {entity.radius !== undefined ? (
            <>
              <div>
                <dt>Radius</dt>
                <dd aria-label="Measured radius">
                  {formatMeasuredLength(entity.radius, unit)}
                </dd>
              </div>
              <div>
                <dt>Diameter</dt>
                <dd aria-label="Measured diameter">
                  {formatMeasuredLength(entity.radius * 2, unit)}
                </dd>
              </div>
            </>
          ) : null}
          {entity.sweepDegrees !== undefined ? (
            <div>
              <dt>Arc sweep</dt>
              <dd>{entity.sweepDegrees.toFixed(4)} deg</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <button onClick={() => inspection.clear(session)}>
        Clear measurements
      </button>
    </section>
  );
}
