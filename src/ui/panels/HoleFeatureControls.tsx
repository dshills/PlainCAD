import { HoleFeature } from "../../cad/document/schema";
import { upsertFeature } from "../../cad/document/CadDocument";
import { useCadStore } from "../../state/useCadStore";
import { CommitInput } from "./CommitInput";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import { DEFAULT_HOLE_DEPTH } from "../commands/holeCommand";

export function HoleFeatureControls({ feature }: { feature: HoleFeature }) {
  const document = useCadStore((s) => s.history.present);
  const updateDocument = useCadStore((s) => s.updateDocument);
  const points = Object.values(
    document.sketches[feature.sketchId]?.entities ?? {},
  ).filter((e) => e.type === "point");
  const update = (patch: Partial<HoleFeature>) =>
    updateDocument((d) => {
      const stored = d.features.find((f) => f.id === feature.id);
      if (d.id !== document.id || stored?.type !== "hole") return d;
      return upsertFeature(d, {
        ...stored,
        ...patch,
        id: stored.id,
        type: stored.type,
      });
    });
  return (
    <div className="inspector-form">
      <label>
        Name
        <CommitInput
          value={feature.name}
          onCommit={(name) => update({ name })}
        />
      </label>
      <label>
        Hole diameter
        <CommitInput
          value={feature.diameter.expression}
          onCommit={(expression) =>
            update({ diameter: { ...feature.diameter, expression } })
          }
        />
      </label>
      <label>
        Hole termination
        <select
          value={feature.depth === "throughAll" ? "throughAll" : "distance"}
          onChange={(e) =>
            update({
              depth:
                e.target.value === "throughAll"
                  ? "throughAll"
                  : { expression: DEFAULT_HOLE_DEPTH, unit: "mm" },
            })
          }
        >
          <option value="throughAll">Through all</option>
          <option value="distance">Blind depth</option>
        </select>
      </label>
      {feature.depth !== "throughAll" ? (
        <label>
          Hole depth
          <CommitInput
            value={feature.depth.expression}
            onCommit={(expression) =>
              update({ depth: { expression, unit: "mm" } })
            }
          />
        </label>
      ) : null}
      <fieldset>
        <legend>Hole centers</legend>
        {[
          ...new Set([...points.map((p) => p.id), ...feature.centerPointIds]),
        ].map((id, index) => {
          const point = points.find((p) => p.id === id);
          return (
            <label key={id}>
              <input
                type="checkbox"
                aria-label={
                  point?.type === "point"
                    ? `Hole center at ${point.x.expression}, ${point.y.expression}`
                    : `Lost hole center ${index + 1}`
                }
                checked={feature.centerPointIds.includes(id)}
                disabled={
                  !feature.centerPointIds.includes(id) &&
                  feature.centerPointIds.length >=
                    MODEL_RESOURCE_LIMITS.maxHoleCenters
                }
                onChange={(e) =>
                  update({
                    centerPointIds: e.target.checked
                      ? [...feature.centerPointIds, id]
                      : feature.centerPointIds.filter((p) => p !== id),
                  })
                }
              />
              {point?.type === "point"
                ? `${point.x.expression}, ${point.y.expression}`
                : "Lost point — remove and choose a replacement"}
            </label>
          );
        })}
      </fieldset>
      <p className="muted">
        Choose explicit centers and one upstream target. Diameter/depth errors,
        lost centers and no-op cuts fail rebuild and block STL.
      </p>
    </div>
  );
}
