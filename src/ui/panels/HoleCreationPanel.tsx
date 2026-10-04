import { ModalDialog } from "../ModalDialog";
import { useEffect, useMemo, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import {
  createHole,
  stageHole,
  assertNativeHolePreview,
  isCurrentHoleDraft,
  holeCreationContext,
  useHoleDraft,
  type HoleDraft,
  DEFAULT_HOLE_DEPTH,
} from "../commands/holeCommand";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";

const EMPTY_MESHES: RebuildResult["meshes"] = [];
export function HoleCreationPanel() {
  const draft = useHoleDraft((s) => s.draft);
  return draft ? (
    <HoleDialog key={`${draft.documentId}:${draft.sketchId}`} draft={draft} />
  ) : null;
}
function HoleDialog({ draft }: { draft: HoleDraft }) {
  const current = useCadStore((state) => isCurrentHoleDraft(draft, state));
  const [sourceState] = useState(() => useCadStore.getState());
  const [context] = useState(() =>
    holeCreationContext(sourceState, draft.sketchId),
  );
  const currentDocument = draft.document;
  const [name, setName] = useState("Hole"),
    [targets, setTargets] = useState<string[]>([]),
    [centers, setCenters] = useState(draft.centerPointIds),
    [diameter, setDiameter] = useState("3mm"),
    [depth, setDepth] = useState(DEFAULT_HOLE_DEPTH),
    [throughAll, setThroughAll] = useState(true),
    [error, setError] = useState("");
  const close = () => useHoleDraft.setState({ draft: undefined });
  const input = useMemo(
    () => ({
      name,
      targetBodyIds: targets,
      centerPointIds: centers,
      diameter,
      depth,
      throughAll,
    }),
    [name, targets, centers, diameter, depth, throughAll],
  );
  const staged = useMemo(
    () =>
      current
        ? stageHole(input, sourceState, draft)
        : {
            ok: false as const,
            reason: "Project or component changed. Close and reopen Hole.",
          },
    [input, sourceState, draft, current],
  );
  const [preview, setPreview] = useState<{
    staged: typeof staged;
    result?: RebuildResult;
    error?: string;
  }>();
  useEffect(() => {
    setError("");
    if (!current || !staged.ok) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void previewModeling(staged.document, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || !isCurrentHoleDraft(draft)) return;
          assertNativeHolePreview(result, staged.document.id, staged.feature);
          setPreview({ staged, result });
        })
        .catch((error) => {
          if (!controller.signal.aborted && isCurrentHoleDraft(draft))
            setPreview({
              staged,
              error: error instanceof Error ? error.message : String(error),
            });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [current, staged, draft]);
  const shown = current && preview?.staged === staged ? preview : undefined;
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
          if (!shown?.result) return;
          if (!staged.ok) return;
          const result = createHole(input, {
            feature: staged.feature,
            result: shown.result,
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
        <fieldset>
          <legend>Hole target scope</legend>
          {[
            ...new Set([
              ...(context?.bodies.map((b) => b.id) ?? []),
              ...targets,
            ]),
          ].map((id) => {
            const bodyName =
              context?.bodies.find((b) => b.id === id)?.name ??
              `Lost target ${id}`;
            return (
              <label key={id}>
                <input
                  type="checkbox"
                  aria-label={`Include hole target ${bodyName}`}
                  checked={targets.includes(id)}
                  onChange={(e) =>
                    setTargets(
                      e.target.checked
                        ? [...targets, id]
                        : targets.filter((target) => target !== id),
                    )
                  }
                />
                {bodyName}
              </label>
            );
          })}
          <p className="muted">
            Choose every body to drill. Each center must cut at least one
            selected body. Every selected body must lose volume; failures retain
            all upstream bodies.
          </p>
        </fieldset>
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
        <ExtrudePreview
          meshes={shown?.result?.meshes ?? EMPTY_MESHES}
          label="Native hole geometry preview"
        />
        <p role="status" aria-label="Hole preview status">
          {!current
            ? "Project or component changed. Close and reopen Hole."
            : !staged.ok
              ? staged.reason
              : shown?.error
                ? "Preview failed"
                : shown?.result
                  ? `Native preview ready · ${shown.result.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0).toFixed(3)} mm³`
                  : "Building native preview…"}
        </p>
        {error || shown?.error ? (
          <p role="alert">{error || shown?.error}</p>
        ) : null}
        <button type="submit" disabled={!shown?.result}>
          Create hole feature
        </button>
        <button type="button" onClick={close}>
          Cancel hole
        </button>
      </form>
    </ModalDialog>
  );
}
