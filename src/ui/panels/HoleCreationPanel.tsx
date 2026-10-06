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
import { documentAtFeature } from "../../cad/document/featureStage";
import { sketchComponentId } from "../../cad/document/components";
import { targetBodyIds } from "../../cad/document/bodyScopes";
import { assertNativeSolidPreview } from "../commands/modelingDraftCommand";
import { useFeatureDraftContext } from "./useFeatureDraftContext";

const EMPTY_MESHES: RebuildResult["meshes"] = [];
export function HoleCreationPanel() {
  const draft = useHoleDraft((s) => s.draft);
  return draft ? (
    <HoleDialog
      key={`${draft.featureId}:${draft.session}:${draft.editId ?? "new"}`}
      draft={draft}
    />
  ) : null;
}
function HoleDialog({ draft }: { draft: HoleDraft }) {
  const current = useCadStore((state) => isCurrentHoleDraft(draft, state));
  const [sourceState] = useState(() => useCadStore.getState());
  const contextDraft = useMemo(
    () => ({ ...draft, feature: draft.feature ?? { id: draft.featureId } }),
    [draft],
  );
  const base = useFeatureDraftContext(contextDraft, current);
  const currentDocument = draft.document;
  const original = draft.feature;
  const [sketchId, setSketchId] = useState(draft.sketchId);
  const context = useMemo(
    () =>
      base.ready && base.result
        ? holeCreationContext(
            {
              ...sourceState,
              history: { ...sourceState.history, present: base.document },
              rebuild: {
                ...sourceState.rebuild,
                status: "succeeded",
                result: base.result,
              },
            },
            sketchId,
          )
        : undefined,
    [base, sourceState, sketchId],
  );
  const [name, setName] = useState(original?.name ?? "Hole"),
    [targets, setTargets] = useState<string[]>(
      original ? targetBodyIds(original) : [],
    ),
    [centers, setCenters] = useState(draft.centerPointIds),
    [diameter, setDiameter] = useState(original?.diameter.expression ?? "3mm"),
    [depth, setDepth] = useState(
      original && original.depth !== "throughAll"
        ? original.depth.expression
        : DEFAULT_HOLE_DEPTH,
    ),
    [throughAll, setThroughAll] = useState(
      !original || original.depth === "throughAll",
    ),
    [error, setError] = useState("");
  const close = () => useHoleDraft.setState({ draft: undefined });
  const input = useMemo(
    () => ({
      name,
      sketchId,
      targetBodyIds: targets,
      centerPointIds: centers,
      diameter,
      depth,
      throughAll,
    }),
    [name, sketchId, targets, centers, diameter, depth, throughAll],
  );
  const staged = useMemo(
    () =>
      current
        ? stageHole(
            input,
            sourceState,
            draft,
            base.ready ? base.result : undefined,
          )
        : {
            ok: false as const,
            reason: "Project or component changed. Close and reopen Hole.",
          },
    [input, sourceState, draft, current, base.ready, base.result],
  );
  const [preview, setPreview] = useState<{
    staged: typeof staged;
    result?: RebuildResult;
    operationResult?: RebuildResult;
    error?: string;
  }>();
  useEffect(() => {
    setError("");
    if (!current || !base.ready || base.error || !staged.ok) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        if (!draft.editing)
          return {
            result: await previewModeling(staged.document, controller.signal),
          };
        const operationResult = await previewModeling(
          documentAtFeature(staged.document, staged.feature.id, true),
          controller.signal,
        );
        if (controller.signal.aborted) throw new Error("Preview canceled.");
        assertNativeHolePreview(
          operationResult,
          staged.document.id,
          staged.feature,
        );
        const result = await previewModeling(
          staged.document,
          controller.signal,
        );
        assertNativeSolidPreview(result, staged.document.id);
        return { result, operationResult };
      })()
        .then(({ result, operationResult }) => {
          if (controller.signal.aborted || !isCurrentHoleDraft(draft)) return;
          if (!draft.editing)
            assertNativeHolePreview(result, staged.document.id, staged.feature);
          setPreview({ staged, result, operationResult });
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
  }, [current, staged, draft, base.ready, base.error]);
  const shown = current && preview?.staged === staged ? preview : undefined;
  return (
    <ModalDialog
      className="file-dialog model-dialog extrude-dialog"
      label={draft.editing ? "Edit Hole" : "Create hole"}
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
            operationResult: shown.operationResult,
            baseResult: base.result,
          });
          if (!result.ok) setError(result.reason);
        }}
      >
        <h2>{draft.editing ? "Edit Hole" : "Create hole"}</h2>
        <div className="extrude-dialog-layout">
          <div>
            {draft.editing ? (
              <label>
                Hole source sketch
                <select
                  aria-label="Hole source sketch"
                  value={sketchId}
                  onChange={(e) => {
                    setSketchId(e.target.value);
                    setCenters([]);
                  }}
                >
                  {!base.document.sketches[sketchId] ? (
                    <option value={sketchId}>Lost sketch {sketchId}</option>
                  ) : null}
                  {Object.values(base.document.sketches)
                    .filter(
                      (sketch) =>
                        sketchComponentId(base.document, sketch.id) ===
                        draft.componentId,
                    )
                    .map((sketch) => (
                      <option key={sketch.id} value={sketch.id}>
                        {sketch.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <p>
              Source sketch:{" "}
              {currentDocument.sketches[sketchId]?.name ?? "Lost sketch"}. Holes
              cut along its positive normal.
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
                selected body. Every selected body must lose volume; failures
                retain all upstream bodies.
              </p>
            </fieldset>
            <fieldset>
              <legend>
                Hole centers (choose up to{" "}
                {MODEL_RESOURCE_LIMITS.maxHoleCenters})
              </legend>
              {[
                ...new Set([
                  ...(context?.points.map((point) => point.id) ?? []),
                  ...centers,
                ]),
              ].map((id) => {
                const solved = context?.solved.points[id];
                const label = solved
                  ? `Hole center at ${solved.x.toFixed(3)}, ${solved.y.toFixed(3)} mm`
                  : `Lost hole center ${id}`;
                return (
                  <label key={id}>
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={centers.includes(id)}
                      onChange={(e) =>
                        setCenters(
                          e.target.checked
                            ? [...centers, id]
                            : centers.filter((center) => center !== id),
                        )
                      }
                    />
                    {solved
                      ? `${solved.x.toFixed(3)}, ${solved.y.toFixed(3)} mm`
                      : label}
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
            <p className="muted">
              Drilling direction:{" "}
              {original?.direction === "negative"
                ? "into the selected face (negative sketch normal)"
                : "positive sketch normal"}
              .
            </p>
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
                <input
                  value={depth}
                  onChange={(e) => setDepth(e.target.value)}
                />
              </label>
            ) : null}
          </div>
          <div>
            <ExtrudePreview
              meshes={shown?.result?.meshes ?? EMPTY_MESHES}
              label="Native hole geometry preview"
            />
            <p
              role="status"
              className={shown?.result ? "preview-ready" : "preview-pending"}
              aria-label="Hole preview status"
            >
              {!current
                ? "Project or component changed. Close and reopen Hole."
                : base.error
                  ? base.error
                  : !base.ready
                    ? "Checking native geometry before this Hole…"
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
          </div>
        </div>
        <div className="dialog-actions">
          <button type="submit" disabled={!shown?.result}>
            {draft.editing ? "Apply hole edits" : "Create hole feature"}
          </button>
          <button type="button" onClick={close}>
            Cancel hole
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
