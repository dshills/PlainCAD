import {
  evaluateExpressionRef,
  evaluateParameters,
} from "../../cad/parameters/expressionEvaluator";
import { transformPoint } from "../../cad/sketch/planes";
import { literalExtrusionDistance } from "../../viewer/extrudeDistanceHandle";
import { bindDocumentExpressions } from "../../cad/parameters/expressionBindings";
import { useFeatureDraftContext } from "./useFeatureDraftContext";
import { documentAtFeature } from "../../cad/document/featureStage";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceState } from "../../state/useWorkspaceState";
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
  isCurrentExtrudeDraft,
  useExtrudeDraft,
  type ExtrudeDraft,
} from "../commands/extrudeCommand";

const EMPTY_PREVIEW_MESHES: RebuildResult["meshes"] = [];

export function ExtrudeCreationPanel() {
  const draft = useExtrudeDraft((state) => state.draft);
  return draft ? (
    <ExtrudeDialog
      key={`${draft.feature.id}:${draft.session}:${draft.editId ?? "create"}`}
      draft={draft}
    />
  ) : null;
}
function ExtrudeDialog({ draft }: { draft: ExtrudeDraft }) {
  const workbench = useWorkspaceState((state) => state.layout === "workbench");
  const document = useCadStore((state) => state.history.present),
    session = useCadStore((state) => state.documentSession),
    component = useCadStore((state) => state.activeComponentId),
    fileBusy = useCadStore((state) => state.fileBusy);
  const current =
    document === draft.document &&
    session === draft.session &&
    component === draft.componentId &&
    !fileBusy;
  const base = useFeatureDraftContext(draft, current, draft.sketchId);
  const context = base.context;
  // The native modal focuses the first control on open. Conditional distance
  // inputs must not steal focus when keyboard users switch termination.
  const [profileId, setProfile] = useState(draft.feature.profileId),
    [distance, setDistance] = useState(
      draft.feature.termination?.type === "distance"
        ? (draft.feature.termination.distance ?? draft.feature.distance)
            .expression
        : draft.feature.distance.expression,
    ),
    [direction, setDirection] = useState<ExtrudeFeature["direction"]>(
      draft.feature.direction,
    ),
    [operation, setOperation] = useState<ExtrudeFeature["operation"]>(
      draft.feature.operation,
    ),
    [targets, setTargets] = useState<string[]>(
      draft.feature.targetBodyIds ?? [],
    ),
    [termination, setTermination] = useState<
      "distance" | "throughAll" | "toFace"
    >(draft.feature.termination?.type ?? "distance"),
    [faceId, setFaceId] = useState(
      draft.feature.termination?.type === "toFace"
        ? (draft.feature.termination.faceRef.stableHint ??
            draft.feature.termination.faceRef.transientId ??
            "")
        : "",
    );
  const [advancedOpen, setAdvancedOpen] = useState(
    !workbench || termination !== "distance",
  );
  useEffect(() => {
    if (!workbench || termination !== "distance") setAdvancedOpen(true);
  }, [workbench, termination]);
  const targetFace = context?.faces.find((face) => face.id === faceId);
  const staged = useMemo(
    () =>
      bindDocumentExpressions(
        upsertFeature(draft.document, {
          ...draft.feature,
          profileId,
          distance: { ...draft.feature.distance, expression: distance },
          direction,
          operation,
          termination:
            termination === "throughAll"
              ? { type: "throughAll" }
              : termination === "toFace" && targetFace
                ? {
                    type: "toFace",
                    faceRef: {
                      kind: "face",
                      featureId: targetFace.featureId,
                      role: "planarFace",
                      transientId: targetFace.id,
                      stableHint: targetFace.id,
                    },
                  }
                : {
                    type: "distance",
                    distance: {
                      ...draft.feature.distance,
                      expression: distance,
                    },
                  },
          targetBodyIds: operation === "newBody" ? undefined : targets,
        }),
        draft.document,
      ),
    [
      draft,
      profileId,
      distance,
      direction,
      operation,
      targets,
      termination,
      targetFace,
    ],
  );
  const [preview, setPreview] = useState<{
    staged: CadDocument;
    result?: RebuildResult;
    operationResult?: RebuildResult;
    error?: string;
  }>();
  const [commitError, setCommitError] = useState("");
  const [dragging, setDragging] = useState(false);
  const hasTargets = operation === "newBody" || targets.length > 0;
  const hasFace = termination !== "toFace" || Boolean(targetFace);
  const validProfile = context?.profiles.some(
    (profile) => profile.id === profileId,
  );
  useEffect(() => {
    setCommitError("");
    if (
      !current ||
      !base.ready ||
      base.error ||
      !hasTargets ||
      !validProfile ||
      !hasFace
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        if (!draft.editing)
          return { result: await previewExtrusion(staged, controller.signal) };
        const operationResult = await previewExtrusion(
          documentAtFeature(staged, draft.feature.id, true),
          controller.signal,
        );
        const feature = staged.features.find(
          (item) => item.id === draft.feature.id,
        );
        if (!feature || feature.type !== "extrude")
          throw new Error("Extrusion draft was lost.");
        assertNativeExtrudePreview(operationResult, staged.id, feature);
        if (controller.signal.aborted) throw new Error("Preview canceled.");
        const result = await previewExtrusion(staged, controller.signal);
        assertNativeExtrudePreview(result, staged.id);
        return { result, operationResult };
      })()
        .then(({ result, operationResult }) => {
          if (controller.signal.aborted || !isCurrentExtrudeDraft(draft))
            return;
          const feature = staged.features.find(
            (item) => item.id === draft.feature.id,
          );
          if (!feature || feature.type !== "extrude")
            throw new Error("Extrusion draft was lost.");
          if (!draft.editing)
            assertNativeExtrudePreview(result, staged.id, feature);
          setPreview({ staged, result, operationResult });
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
  }, [
    draft,
    staged,
    current,
    base.ready,
    base.error,
    hasTargets,
    validProfile,
    hasFace,
  ]);
  const shown = current && preview?.staged === staged ? preview : undefined;
  const handle = useMemo(() => {
    const profile = context?.profiles.find((item) => item.id === profileId),
      plane = base.result?.sketchPlanes?.[draft.sketchId],
      feature = staged.features.find((item) => item.id === draft.feature.id);
    if (!profile || !plane || !feature || feature.type !== "extrude") return;
    const ref =
      feature.termination?.type === "distance"
        ? (feature.termination.distance ?? feature.distance)
        : feature.distance;
    const evaluated = evaluateExpressionRef(ref, {
      parameters: evaluateParameters(staged.parameters).values,
    });
    const value =
      evaluated.quantity?.dimension === "length"
        ? evaluated.quantity.value
        : undefined;
    return {
      key: `${profileId}:${direction}:${termination}`,
      origin: transformPoint(
        plane,
        (profile.bounds.minX + profile.bounds.maxX) / 2,
        (profile.bounds.minY + profile.bounds.maxY) / 2,
      ),
      normal: plane.normal,
      direction,
      distance: value && Number.isFinite(value) && value > 0 ? value : 10,
      expression: distance,
      disabledReason: !current
        ? "Project or component changed. Reopen Extrude."
        : termination !== "distance"
          ? "Distance dragging is available only with Distance termination."
          : !literalExtrusionDistance(distance)
            ? "Distance is an expression. Enter a literal length to enable dragging; dragging preserves parameter and formula bindings."
            : !value || !Number.isFinite(value) || value <= 0
              ? "Enter a positive valid length to enable dragging."
              : undefined,
      onChange: (next: number) => setDistance(`${Number(next.toFixed(3))}mm`),
      onCancel: (expression: string) => setDistance(expression),
      onDragging: setDragging,
    };
  }, [
    context,
    base.result,
    draft,
    staged,
    profileId,
    direction,
    termination,
    distance,
    current,
  ]);
  const close = () => useExtrudeDraft.setState({ draft: undefined });
  return (
    <ModalDialog
      label={draft.editing ? "Edit Extrude" : "Extrude"}
      className="file-dialog model-dialog extrude-dialog"
      onDismiss={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!shown?.result || dragging) return;
          try {
            commitExtrude(draft, staged, shown.result, shown.operationResult);
          } catch (error) {
            setCommitError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }}
      >
        <h2>{draft.editing ? "Edit Extrude" : "Extrude"}</h2>
        <p>
          {context?.sketch.name} ·{" "}
          {draft.document.components[draft.componentId]?.name}
        </p>
        <div className="extrude-dialog-layout">
          <div>
            {workbench ? (
              <p className="modeling-step-hint">
                <strong>
                  {termination === "distance"
                    ? "Set thickness"
                    : termination === "toFace"
                      ? "Choose an end face"
                      : hasTargets
                        ? "Review through-all feature"
                        : "Choose target bodies"}
                </strong>
                <br />
                {termination === "distance"
                  ? "Enter a length or drag the arrow. Review the native preview, then Apply."
                  : "Set the termination in Advanced options. Review the native preview, then Apply."}
              </p>
            ) : null}
            <label>
              {workbench ? "Choose shape" : "Extrude profile"}
              <select
                aria-label="Extrude profile"
                value={profileId}
                onChange={(event) => setProfile(event.target.value)}
              >
                {!context?.profiles.some(
                  (profile) => profile.id === profileId,
                ) ? (
                  <option value={profileId}>Lost profile — reselect</option>
                ) : null}
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
            {termination === "distance" ? (
              <label>
                {workbench ? "Thickness" : "Extrude distance"}
                <input
                  aria-label="Extrude distance"
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                />
              </label>
            ) : (
              <p className="muted">
                {termination === "throughAll"
                  ? "Through All spans the selected target bounds in the chosen direction."
                  : "To Face requires an upstream unmodified planar face covering the whole profile. Holes and face boundaries are checked by the native preview."}
              </p>
            )}
            <label>
              {workbench ? "Direction" : "Extrude direction"}
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
                <option value="negative" disabled={termination === "toFace"}>
                  Negative normal
                </option>
                <option value="symmetric" disabled={termination === "toFace"}>
                  Symmetric (total distance)
                </option>
              </select>
            </label>
            <label>
              {workbench ? "Operation" : "Extrude operation"}
              <select
                aria-label="Extrude operation"
                value={operation}
                onChange={(event) => {
                  const next = event.target
                    .value as ExtrudeFeature["operation"];
                  setOperation(next);
                  if (next === "newBody" && termination === "throughAll")
                    setTermination("distance");
                }}
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
                {[
                  ...new Set([
                    ...(context?.bodies.map((body) => body.id) ?? []),
                    ...targets,
                  ]),
                ].map((id) => {
                  const body = context?.bodies.find(
                    (body) => body.id === id,
                  ) ?? { id, name: `Lost target ${id}` };
                  return (
                    <label key={body.id}>
                      <input
                        type="checkbox"
                        checked={targets.includes(body.id)}
                        onChange={(event) =>
                          setTargets(
                            event.target.checked
                              ? [...targets, body.id]
                              : targets.filter((other) => other !== body.id),
                          )
                        }
                      />
                      {body.name}
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
            <details
              className="ds-advanced"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary>Advanced options</summary>
              <label>
                Extrude termination
                <select
                  aria-label="Extrude termination"
                  value={termination}
                  onChange={(event) =>
                    setTermination(
                      event.target.value as
                        | "distance"
                        | "throughAll"
                        | "toFace",
                    )
                  }
                >
                  <option value="distance">Distance</option>
                  <option value="throughAll" disabled={operation === "newBody"}>
                    Through All (Cut or Join)
                  </option>
                  <option
                    value="toFace"
                    disabled={
                      direction !== "positive" || !context?.faces.length
                    }
                  >
                    To Face (positive only)
                  </option>
                </select>
              </label>
              {termination === "toFace" ? (
                <label>
                  Extrude target face
                  <select
                    aria-label="Extrude target face"
                    value={faceId}
                    onChange={(event) => setFaceId(event.target.value)}
                  >
                    <option value="">Choose a covering planar face</option>
                    {context?.faces.map((face) => (
                      <option key={face.id} value={face.id}>
                        {face.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="muted">
                Distance accepts lengths and project parameter expressions. Drag
                the arrow to change distance; drag the preview background to
                orbit.{" "}
                {draft.editing
                  ? "Apply replaces this feature in one history edit after validating downstream geometry."
                  : "Apply adds one feature to the timeline."}
              </p>
            </details>
          </div>
          <div>
            <ExtrudePreview
              meshes={shown?.result?.meshes ?? EMPTY_PREVIEW_MESHES}
              distanceHandle={handle}
            />
            <p
              role="status"
              className={shown?.result ? "preview-ready" : "preview-pending"}
            >
              {!current
                ? "Project or component changed. Close and reopen Extrude."
                : base.error
                  ? base.error
                  : !base.ready
                    ? "Loading geometry before this feature…"
                    : !validProfile
                      ? "Choose a current closed profile."
                      : !hasTargets
                        ? "Choose at least one target body."
                        : !hasFace
                          ? "Choose a covering planar target face."
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
          <button type="submit" disabled={!shown?.result || dragging}>
            Apply extrusion
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
