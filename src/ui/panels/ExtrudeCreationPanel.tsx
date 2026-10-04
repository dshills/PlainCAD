import { useEffect, useMemo, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { upsertFeature } from "../../cad/document/CadDocument";
import type { CadDocument, ExtrudeFeature } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewExtrusion } from "../../cad/worker/extrudePreviewClient";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import {
  assertNativeExtrudePreview,
  commitExtrude,
  extrudeContext,
  isCurrentExtrudeDraft,
  useExtrudeDraft,
  type ExtrudeDraft,
} from "../commands/extrudeCommand";

const EMPTY_PREVIEW_MESHES: RebuildResult["meshes"] = [];

export function ExtrudeCreationPanel() {
  const draft = useExtrudeDraft((state) => state.draft);
  return draft ? <ExtrudeDialog key={draft.feature.id} draft={draft} /> : null;
}
function ExtrudeDialog({ draft }: { draft: ExtrudeDraft }) {
  const document = useCadStore((state) => state.history.present),
    session = useCadStore((state) => state.documentSession),
    component = useCadStore((state) => state.activeComponentId),
    fileBusy = useCadStore((state) => state.fileBusy);
  const current =
    document === draft.document &&
    session === draft.session &&
    component === draft.componentId &&
    !fileBusy;
  const [context] = useState(() =>
    extrudeContext(useCadStore.getState(), draft.sketchId),
  );
  const [profileId, setProfile] = useState(draft.feature.profileId),
    [distance, setDistance] = useState(draft.feature.distance.expression),
    [direction, setDirection] =
      useState<ExtrudeFeature["direction"]>("positive"),
    [operation, setOperation] =
      useState<ExtrudeFeature["operation"]>("newBody"),
    [targets, setTargets] = useState<string[]>([]);
  const staged = useMemo(
    () =>
      upsertFeature(draft.document, {
        ...draft.feature,
        profileId,
        distance: { ...draft.feature.distance, expression: distance },
        direction,
        operation,
        ...(operation === "newBody" ? {} : { targetBodyIds: targets }),
      }),
    [draft, profileId, distance, direction, operation, targets],
  );
  const [preview, setPreview] = useState<{
    staged: CadDocument;
    result?: RebuildResult;
    error?: string;
  }>();
  const [commitError, setCommitError] = useState("");
  const hasTargets = operation === "newBody" || targets.length > 0;
  const validProfile = context?.profiles.some(
    (profile) => profile.id === profileId,
  );
  useEffect(() => {
    setCommitError("");
    if (!current || !hasTargets || !validProfile) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void previewExtrusion(staged, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || !isCurrentExtrudeDraft(draft))
            return;
          const feature = staged.features.find(
            (item) => item.id === draft.feature.id,
          );
          if (!feature || feature.type !== "extrude")
            throw new Error("Extrusion draft was lost.");
          assertNativeExtrudePreview(result, staged.id, feature);
          setPreview({ staged, result });
        })
        .catch((error) => {
          if (!controller.signal.aborted && isCurrentExtrudeDraft(draft))
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
  }, [draft, staged, current, hasTargets, validProfile]);
  const shown = current && preview?.staged === staged ? preview : undefined;
  const close = () => useExtrudeDraft.setState({ draft: undefined });
  return (
    <ModalDialog
      label="Extrude"
      className="file-dialog model-dialog extrude-dialog"
      onDismiss={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!shown?.result) return;
          try {
            commitExtrude(draft, staged, shown.result);
          } catch (error) {
            setCommitError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }}
      >
        <h2>Extrude</h2>
        <p>
          {context?.sketch.name} ·{" "}
          {draft.document.components[draft.componentId]?.name}
        </p>
        <div className="extrude-dialog-layout">
          <div>
            <label>
              Extrude profile
              <select
                aria-label="Extrude profile"
                value={profileId}
                onChange={(event) => setProfile(event.target.value)}
              >
                {context?.profiles.map((profile, index) => (
                  <option key={profile.id} value={profile.id}>
                    Profile {index + 1} ·{" "}
                    {(profile.bounds.maxX - profile.bounds.minX).toFixed(2)} ×{" "}
                    {(profile.bounds.maxY - profile.bounds.minY).toFixed(2)} mm
                    · {profile.innerLoops.length} inner loops
                  </option>
                ))}
              </select>
            </label>
            <label>
              Extrude distance
              <input
                autoFocus
                value={distance}
                onChange={(event) => setDistance(event.target.value)}
              />
            </label>
            <label>
              Extrude direction
              <select
                aria-label="Extrude direction"
                value={direction}
                onChange={(event) =>
                  setDirection(
                    event.target.value as ExtrudeFeature["direction"],
                  )
                }
              >
                <option value="positive">Positive normal</option>
                <option value="negative">Negative normal</option>
                <option value="symmetric">Symmetric (total distance)</option>
              </select>
            </label>
            <label>
              Extrude operation
              <select
                aria-label="Extrude operation"
                value={operation}
                onChange={(event) =>
                  setOperation(
                    event.target.value as ExtrudeFeature["operation"],
                  )
                }
              >
                <option value="newBody">New Body</option>
                <option value="cut" disabled={!context?.bodies.length}>
                  Cut
                </option>
                <option value="join" disabled={!context?.bodies.length}>
                  Join
                </option>
              </select>
            </label>
            {operation !== "newBody" ? (
              <fieldset>
                <legend>Extrude target bodies</legend>
                {context?.bodies.map((body) => (
                  <label key={body.id}>
                    <input
                      type="checkbox"
                      checked={targets.includes(body.id)}
                      onChange={(event) =>
                        setTargets(
                          event.target.checked
                            ? [...targets, body.id]
                            : targets.filter((id) => id !== body.id),
                        )
                      }
                    />
                    {body.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <p className="muted">
              Distance accepts lengths and project parameter expressions. Drag
              the preview to orbit. Apply adds one feature to the timeline.
            </p>
          </div>
          <div>
            <ExtrudePreview
              meshes={shown?.result?.meshes ?? EMPTY_PREVIEW_MESHES}
            />
            <p role="status">
              {!current
                ? "Project or component changed. Close and reopen Extrude."
                : !validProfile
                  ? "Choose a current closed profile."
                  : !hasTargets
                    ? "Choose at least one target body."
                    : shown?.error
                      ? "Preview failed"
                      : shown?.result
                        ? `Native preview ready · ${shown.result.meshes.length} bodies · ${shown.result.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0).toFixed(3)} mm³`
                        : "Building native preview…"}
            </p>
            {shown?.error || commitError ? (
              <p role="alert">{shown?.error || commitError}</p>
            ) : null}
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={!shown?.result}>
            Apply extrusion
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
