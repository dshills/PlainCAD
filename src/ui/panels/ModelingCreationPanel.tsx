import { useEffect, useMemo, useState } from "react";
import { bindDocumentExpressions } from "../../cad/parameters/expressionBindings";
import { documentAtFeature } from "../../cad/document/featureStage";
import { useFeatureDraftContext } from "./useFeatureDraftContext";
import { upsertFeature } from "../../cad/document/CadDocument";
import type { CadDocument, RevolveFeature } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore } from "../../state/useCadStore";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { ModalDialog } from "../ModalDialog";
import { EdgeDraftControls } from "./EdgeDraftControls";
import { extrudeContext } from "../commands/extrudeCommand";
import {
  assertNativeModelingPreview,
  assertNativeSolidPreview,
  commitModelingDraft,
  isCurrentModelingDraft,
  useModelingDraft,
  type ModelingDraft,
} from "../commands/modelingDraftCommand";

const EMPTY_MESHES: RebuildResult["meshes"] = [];
export function ModelingCreationPanel() {
  const draft = useModelingDraft((state) => state.draft);
  return draft ? (
    <ModelingDialog
      key={`${draft.feature.id}:${draft.session}:${draft.editId ?? "create"}`}
      draft={draft}
    />
  ) : null;
}
function ModelingDialog({ draft }: { draft: ModelingDraft }) {
  const current = useCadStore((state) => isCurrentModelingDraft(draft, state));
  const base = useFeatureDraftContext(
    draft,
    current,
    draft.feature.type === "revolve" ? draft.feature.sketchId : undefined,
  );
  const context = base.context;
  const [feature, setFeature] = useState(draft.feature);
  const staged = useMemo(
    () =>
      bindDocumentExpressions(
        upsertFeature(draft.document, feature),
        draft.document,
      ),
    [draft, feature],
  );
  const [preview, setPreview] = useState<{
    staged: CadDocument;
    result?: RebuildResult;
    operationResult?: RebuildResult;
    error?: string;
  }>();
  const [commitError, setCommitError] = useState("");
  const featureTitle =
    feature.type === "revolve"
      ? "Revolve"
      : feature.type === "fillet"
        ? "Fillet"
        : "Chamfer";
  const title = draft.editing ? `Edit ${featureTitle}` : featureTitle;
  const hasProfile =
    feature.type !== "revolve" ||
    Boolean(
      context?.profiles.some((profile) => profile.id === feature.profileId),
    );
  const hasTargets =
    feature.type !== "revolve" ||
    feature.operation === "newBody" ||
    Boolean(feature.targetBodyIds?.length);
  useEffect(() => {
    setCommitError("");
    if (!current || !base.ready || base.error || !hasProfile || !hasTargets)
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        if (!draft.editing)
          return { result: await previewModeling(staged, controller.signal) };
        // Verify the operation first and stop on failure. Sequential jobs also
        // dispose one OpenCascade worker before allocating the downstream worker;
        // this trades preview latency for bounded simultaneous kernel memory.
        const operationResult = await previewModeling(
          documentAtFeature(staged, feature.id, true),
          controller.signal,
        );
        assertNativeModelingPreview(operationResult, staged.id, feature);
        if (controller.signal.aborted) throw new Error("Preview canceled.");
        const result = await previewModeling(staged, controller.signal);
        assertNativeSolidPreview(result, staged.id);
        return { result, operationResult };
      })()
        .then(({ result, operationResult }) => {
          if (controller.signal.aborted || !isCurrentModelingDraft(draft))
            return;
          if (!draft.editing)
            assertNativeModelingPreview(result, staged.id, feature);
          setPreview({ staged, result, operationResult });
        })
        .catch((error) => {
          if (!controller.signal.aborted && isCurrentModelingDraft(draft))
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
  }, [
    draft,
    staged,
    feature,
    current,
    base.ready,
    base.error,
    hasProfile,
    hasTargets,
  ]);
  const shown = current && preview?.staged === staged ? preview : undefined;
  const close = () => useModelingDraft.setState({ draft: undefined });
  return (
    <ModalDialog
      label={title}
      className="file-dialog model-dialog extrude-dialog"
      onDismiss={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!shown?.result) return;
          try {
            commitModelingDraft(
              draft,
              staged,
              shown.result,
              shown.operationResult,
            );
          } catch (error) {
            setCommitError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }}
      >
        <h2>{title}</h2>
        <p>
          {context?.sketch.name ?? feature.name} ·{" "}
          {draft.document.components[draft.componentId]?.name}
        </p>
        <div className="extrude-dialog-layout">
          <div>
            {feature.type === "revolve" ? (
              <RevolveDraftControls
                feature={feature}
                onChange={setFeature}
                context={context}
              />
            ) : (
              <EdgeDraftControls
                draft={draft}
                feature={feature}
                onChange={setFeature}
              />
            )}
            <p className="muted">
              Drag the preview to orbit.{" "}
              {draft.editing
                ? "Apply replaces this feature in one history edit after validating downstream geometry."
                : "Apply adds one feature to the timeline."}{" "}
              Cancel leaves the project unchanged.
            </p>
          </div>
          <div>
            <ExtrudePreview
              meshes={shown?.result?.meshes ?? EMPTY_MESHES}
              label={`Native ${feature.type} geometry preview`}
            />
            <p role="status">
              {!current
                ? `Project or component changed. Close and reopen ${title}.`
                : base.error
                  ? "Upstream geometry needs repair."
                  : !base.ready
                    ? "Loading geometry before this feature…"
                    : !hasProfile
                      ? "Choose a current closed profile."
                      : !hasTargets
                        ? "Choose at least one target body."
                        : shown?.error
                          ? "Preview failed"
                          : shown?.result
                            ? `Native preview ready · ${shown.result.meshes.length} bodies · ${shown.result.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0).toFixed(3)} mm³`
                            : "Building native preview…"}
            </p>
            {base.error || shown?.error || commitError ? (
              <p role="alert">{base.error || shown?.error || commitError}</p>
            ) : null}
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={!shown?.result}>
            Apply {feature.type}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
function RevolveDraftControls({
  feature,
  onChange,
  context,
}: {
  feature: RevolveFeature;
  onChange: (feature: RevolveFeature) => void;
  context: ReturnType<typeof extrudeContext>;
}) {
  const lines = Object.values(context?.sketch.entities ?? {}).filter(
    (entity) => entity.type === "line",
  );
  const axisValue =
    feature.axis.type === "origin"
      ? `origin:${feature.axis.axis}`
      : `line:${feature.axis.lineId}`;
  return (
    <>
      <label>
        Revolve profile
        <select
          aria-label="Revolve profile"
          value={feature.profileId}
          onChange={(event) =>
            onChange({ ...feature, profileId: event.target.value })
          }
        >
          {!context?.profiles.some(
            (profile) => profile.id === feature.profileId,
          ) ? (
            <option value={feature.profileId}>Lost profile — reselect</option>
          ) : null}
          {context?.profiles.map((profile, index) => (
            <option key={profile.id} value={profile.id}>
              Profile {index + 1} ·{" "}
              {(profile.bounds.maxX - profile.bounds.minX).toFixed(2)} ×{" "}
              {(profile.bounds.maxY - profile.bounds.minY).toFixed(2)} mm
            </option>
          ))}
        </select>
      </label>
      <label>
        Revolve angle
        <input
          value={feature.angle.expression}
          onChange={(event) =>
            onChange({
              ...feature,
              angle: { ...feature.angle, expression: event.target.value },
            })
          }
        />
      </label>
      <label>
        Revolve axis
        <select
          aria-label="Revolve axis"
          value={axisValue}
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === "origin:X" ||
              value === "origin:Y" ||
              value === "origin:Z"
            )
              onChange({
                ...feature,
                axis: {
                  type: "origin",
                  axis: value.slice(7) as "X" | "Y" | "Z",
                },
              });
            else if (lines.some((line) => `line:${line.id}` === value))
              onChange({
                ...feature,
                axis: {
                  type: "sketchLine",
                  sketchId: feature.sketchId,
                  lineId: value.slice(5),
                },
              });
          }}
        >
          {["X", "Y", "Z"].map((axis) => (
            <option key={axis} value={`origin:${axis}`}>
              Origin {axis}
            </option>
          ))}
          {lines.map((line) => (
            <option key={line.id} value={`line:${line.id}`}>
              {line.construction ? "Construction" : "Sketch"} line {line.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Revolve operation
        <select
          aria-label="Revolve operation"
          value={feature.operation}
          onChange={(event) =>
            onChange({
              ...feature,
              operation: event.target.value as RevolveFeature["operation"],
            })
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
      {feature.operation !== "newBody" ? (
        <fieldset>
          <legend>Revolve target bodies</legend>
          {[
            ...new Set([
              ...(context?.bodies.map((body) => body.id) ?? []),
              ...(feature.targetBodyIds ?? []),
            ]),
          ].map((id) => {
            const body = context?.bodies.find((candidate) => candidate.id === id) ?? {
              id,
              name: `Lost target ${id}`,
            };
            return (
              <label key={body.id}>
                <input
                  type="checkbox"
                  checked={feature.targetBodyIds?.includes(body.id) ?? false}
                  onChange={(event) =>
                    onChange({
                      ...feature,
                      targetBodyIds: event.target.checked
                        ? [...(feature.targetBodyIds ?? []), body.id]
                        : (feature.targetBodyIds?.filter(
                            (targetId) => targetId !== body.id,
                          ) ?? []),
                    })
                  }
                />
                {body.name}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      <p className="muted">
        Use a coplanar origin axis or a line in this sketch. The profile must
        stay on one side of the axis. Angle accepts project expressions greater
        than 0 through 360 degrees.
      </p>
    </>
  );
}
