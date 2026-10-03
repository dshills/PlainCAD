import { ModalDialog } from "../ModalDialog";
import { useMemo, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import {
  createHole,
  holeCreationContext,
  useHoleDraft,
  type HoleDraft,
  DEFAULT_HOLE_DEPTH,
} from "../commands/holeCommand";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";

export function HoleCreationPanel() {
  const draft = useHoleDraft((s) => s.draft);
  return draft ? (
    <HoleDialog key={`${draft.documentId}:${draft.sketchId}`} draft={draft} />
  ) : null;
}
function HoleDialog({ draft }: { draft: HoleDraft }) {
  const currentDocument = useCadStore((s) => s.history.present),
    rebuild = useCadStore((s) => s.rebuild);
  const context = useMemo(
    () =>
      draft.documentId === currentDocument.id
        ? holeCreationContext(useCadStore.getState(), draft.sketchId)
        : undefined,
    [currentDocument, rebuild, draft],
  );
  const [name, setName] = useState("Hole"),
    [target, setTarget] = useState(""),
    [centers, setCenters] = useState(draft.centerPointIds),
    [diameter, setDiameter] = useState("3mm"),
    [depth, setDepth] = useState(DEFAULT_HOLE_DEPTH),
    [throughAll, setThroughAll] = useState(true),
    [error, setError] = useState("");
  const close = () => useHoleDraft.setState({ draft: undefined });
  const valid =
    context &&
    context.bodies.some((b) => b.id === target) &&
    centers.length > 0 &&
    centers.length <= MODEL_RESOURCE_LIMITS.maxHoleCenters &&
    centers.every((id) => context.points.some((p) => p.id === id));
  return (
    <ModalDialog
      className="file-dialog model-dialog"
      label="Create hole"
      onDismiss={close}
    >
      <form
        onChange={() => setError("")}
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          const result = createHole({
            name,
            targetBodyId: target,
            centerPointIds: centers,
            diameter,
            depth,
            throughAll,
          });
          if (!result.ok) setError(result.reason);
        }}
      >
        <h2>Create hole</h2>
        <p>
          Source sketch:{" "}
          {currentDocument.sketches[draft.sketchId]?.name ?? "Lost sketch"}.
          Holes cut along its positive normal.
        </p>
        {!context ? (
          <p role="status">
            Wait for a successful native rebuild, or close and repair the
            sketch/body first.
          </p>
        ) : null}
        <label>
          Hole name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Hole target body
          <select
            aria-label="Hole target body"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose an explicit target</option>
            {target && !context?.bodies.some((b) => b.id === target) ? (
              <option value={target}>Lost target — reselect</option>
            ) : null}
            {context?.bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>
            Hole centers (choose up to {MODEL_RESOURCE_LIMITS.maxHoleCenters})
          </legend>
          {context?.points.map((point) => {
            const solved = context.solved.points[point.id];
            return (
              <label key={point.id}>
                <input
                  type="checkbox"
                  aria-label={`Hole center at ${solved.x.toFixed(3)}, ${solved.y.toFixed(3)} mm`}
                  checked={centers.includes(point.id)}
                  onChange={(e) =>
                    setCenters(
                      e.target.checked
                        ? [...centers, point.id]
                        : centers.filter((id) => id !== point.id),
                    )
                  }
                />
                {solved.x.toFixed(3)}, {solved.y.toFixed(3)} mm
              </label>
            );
          })}
        </fieldset>
        <label>
          Hole diameter
          <input
            value={diameter}
            onChange={(e) => setDiameter(e.target.value)}
          />
        </label>
        <label>
          Hole termination
          <select
            aria-label="Hole termination"
            value={throughAll ? "throughAll" : "distance"}
            onChange={(e) => setThroughAll(e.target.value === "throughAll")}
          >
            <option value="throughAll">Through all</option>
            <option value="distance">Blind depth</option>
          </select>
        </label>
        {!throughAll ? (
          <label>
            Hole depth
            <input value={depth} onChange={(e) => setDepth(e.target.value)} />
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={!valid}>
          Create hole feature
        </button>
        <button type="button" onClick={close}>
          Cancel hole
        </button>
      </form>
    </ModalDialog>
  );
}
