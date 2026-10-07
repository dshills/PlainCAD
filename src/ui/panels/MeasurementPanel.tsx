import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { runCommand } from "../commands/commandRegistry";
import { visibleMeasurementTargets, resolvedMeasurementSelection } from "../../viewer/measurementPicking";
import { measureModelTargets } from "../../cad/inspection/modelMeasurements";
import { useViewerState } from "../../state/viewerState";
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
  const enablement = useCommandEnablement();
  const view = useViewerState(useShallow((view) => ({ session: view.session, hiddenBodyIds: view.hiddenBodyIds, hiddenSketchIds: view.hiddenSketchIds, hiddenComponentIds: view.hiddenComponentIds, presentationMode: view.presentationMode })));
  const fileBusy = useCadStore((s) => s.fileBusy);
  useEffect(() => {
    if (inspection.document && (inspection.document !== document || inspection.result !== rebuild.result || rebuild.status !== "succeeded" || fileBusy)) inspection.clearModel();
  }, [inspection.document, inspection.result, inspection.clearModel, document, rebuild.result, rebuild.status, fileBusy]);
  const unit = (inspection.session === session ? inspection.unit : undefined) ?? displayUnits(document).length;
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
    !fileBusy && rebuild.status === "succeeded" &&
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
  const modelTargets = useMemo(() => visibleMeasurementTargets(), [document, rebuild.result, rebuild.status, view, fileBusy]);
  const modelCurrent = current && refs?.document === document && refs.result === result;
  const chosen = useMemo(() => modelCurrent ? resolvedMeasurementSelection(document, result, refs, modelTargets) : [], [modelCurrent, refs?.targetIds, refs?.document, refs?.result, document, result, modelTargets]);
  if (modelCurrent && refs.targetIds.length && chosen.length !== refs.targetIds.length) errors.push("Selected measurement geometry is hidden or unavailable. Show it or pick again.");
  const measured = useMemo(() => {
    if (!chosen[0]) return {};
    try { return { value: measureModelTargets(chosen[0], chosen[1]) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [chosen]);
  const modelMeasurement = measured.value;
  if (measured.error) errors.push(measured.error);
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
        Click a point, curve, original native cap edge, or supported planar face.
        Pick two points for distance, two straight edges for their smaller angle,
        or two faces for plane angle/separation. Values use analytic geometry.
      </p>
      <button type="button" disabled={!refs?.picking && !enablement.measurementPicking}
        aria-pressed={Boolean(refs?.picking)} onClick={async () => {
          try {
          if (refs?.picking) inspection.setPicking(session, false);
          else await runCommand("inspect.pickModel");
          } catch (error) {
            if (useCadStore.getState().documentSession === session) {
              inspection.setError(session, error instanceof Error ? error.message : String(error));
            }
          }
        }}>{refs?.picking ? "Done measuring" : "Pick in model"}</button>
      {refs?.picking ? <p role="status">Click highlighted geometry. A third pick starts a new measurement. Escape finishes.</p> : null}
      {refs?.error ? <p role="alert">{refs.error}</p> : null}
      {refs?.picking ? <details><summary>Choose model geometry by name</summary>
        <select aria-label="Model measurement target" value="" disabled={!current} onChange={(event) => {
          if (result && modelTargets.some((target) => target.id === event.target.value)) inspection.pick(session, document, result, event.target.value);
        }}><option value="">Choose supported geometry</option>{modelTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select>
      </details> : null}
      {modelMeasurement ? <dl className="inspector-facts">
        <div><dt>Selected geometry</dt><dd>{modelMeasurement.label}</dd></div>
        {modelMeasurement.length !== undefined ? <div><dt>{modelMeasurement.label}</dt><dd aria-label="Model measured distance">{formatMeasuredLength(modelMeasurement.length, unit)}</dd></div> : null}
        {modelMeasurement.angle !== undefined ? <div><dt>Smaller angle</dt><dd aria-label="Model measured angle">{modelMeasurement.angle.toFixed(4)} deg</dd></div> : null}
        {modelMeasurement.curve ? <><div><dt>Analytic curve length</dt><dd aria-label="Model measured length">{formatMeasuredLength(modelMeasurement.curve.length, unit)}</dd></div>{modelMeasurement.curve.diameter !== undefined ? <div><dt>Diameter</dt><dd aria-label="Model measured diameter">{formatMeasuredLength(modelMeasurement.curve.diameter, unit)}</dd></div> : null}</> : null}
        {modelMeasurement.point ? <div><dt>World X / Y / Z</dt><dd>{[modelMeasurement.point.x, modelMeasurement.point.y, modelMeasurement.point.z].map((value) => formatMeasuredLength(value, unit)).join(" / ")}</dd></div> : null}
      </dl> : null}
      <label>
        Measurement units
        <select
          aria-label="Measurement units"
          value={unit}
          onChange={(e) => inspection.setUnit(session, e.target.value as UnitSettings["length"])}
        >
          {(["mm", "cm", "m", "in", "ft"] as const).map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      <details><summary>Choose sketch geometry by name</summary><div className="inspector-form">
        {picker("first", "Measurement first point", true)}
        {picker("second", "Measurement second point", true)}
        {picker("entity", "Measurement curve", false)}
      </div></details>
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
