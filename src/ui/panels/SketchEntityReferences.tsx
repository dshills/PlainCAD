import type { Sketch, SketchEntity } from "../../cad/document/schema";
import { upsertSketch } from "../../cad/document/CadDocument";
import {
  replaceSketchPointReference,
  setArcDirection,
  sketchPointReferences,
} from "../../cad/sketch/entityReferences";
import { useCadStore } from "../../state/useCadStore";

export function SketchEntityReferences({
  sketch,
  entity,
}: {
  sketch: Sketch;
  entity: SketchEntity;
}) {
  const updateDocument = useCadStore((state) => state.updateDocument);
  const select = useCadStore((state) => state.select);
  const points = Object.values(sketch.entities).filter(
    (point) => point.type === "point",
  );
  const refs = sketchPointReferences(entity);
  if (!refs.length) return null;
  const change = (mutator: (current: Sketch) => Sketch) =>
    updateDocument((document) => {
      const current = document.sketches[sketch.id];
      if (!current) return document;
      const next = mutator(current);
      return next === current ? document : upsertSketch(document, next);
    });
  return (
    <div className="inspector-form">
      <p className="muted">
        Inspect a referenced point to edit its coordinates, or choose a
        replacement in this sketch. Invalid geometry blocks modeling and export.
      </p>
      {refs.map((ref) => {
        const valid = sketch.entities[ref.pointId]?.type === "point";
        return (
          <div key={ref.field}>
            <label>
              {ref.label}
              <select
                aria-label={ref.label}
                value={ref.pointId}
                onChange={(event) =>
                  change((current) =>
                    replaceSketchPointReference(
                      current,
                      entity.id,
                      ref.field,
                      event.target.value,
                    ),
                  )
                }
              >
                {!valid ? (
                  <option value={ref.pointId} disabled>
                    Missing or invalid point — {ref.pointId}
                  </option>
                ) : null}
                {points.map((point, index) => (
                  <option key={point.id} value={point.id}>
                    Point {index + 1} — {point.id}
                  </option>
                ))}
              </select>
            </label>
            {!valid ? (
              <p className="error-text" role="alert">
                {ref.label} reference is missing or is not a point. Choose a
                point in this sketch.
              </p>
            ) : null}
            <button
              type="button"
              disabled={!valid}
              onClick={() => {
                const document = useCadStore.getState().history.present;
                if (
                  document.sketches[sketch.id]?.entities[ref.pointId]?.type ===
                  "point"
                )
                  select({
                    kind: "sketchEntity",
                    id: ref.pointId,
                    documentId: document.id,
                  });
              }}
            >
              Inspect {ref.label.toLowerCase()}
            </button>
          </div>
        );
      })}
      {entity.type === "arc" ? (
        <label>
          <input
            type="checkbox"
            checked={entity.clockwise}
            onChange={(event) =>
              change((current) =>
                setArcDirection(current, entity.id, event.target.checked),
              )
            }
          />
          Clockwise arc
        </label>
      ) : null}
    </div>
  );
}
