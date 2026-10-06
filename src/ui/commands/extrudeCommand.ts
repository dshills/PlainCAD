import { createId } from "../../cad/document/ids";
import { featureComponentId } from "../../cad/document/components";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import { create } from "zustand";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import {
  createExtrudeFeature,
  upsertFeature,
} from "../../cad/document/CadDocument";
import {
  bodyComponentId,
  sketchComponentId,
} from "../../cad/document/components";
import type { CadDocument, ExtrudeFeature } from "../../cad/document/schema";
import { faceOwnerModifiedBefore } from "../../cad/sketch/planes";
import { detectProfiles } from "../../cad/sketch/profileDetection";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import type { RebuildResult } from "../../cad/worker/workerProtocol";

export interface ExtrudeDraft {
  /** Operation drops remain bound to their captured native target result. */
  targetSnapshot?: RebuildResult;
  editing?: boolean;
  editId?: string;
  document: CadDocument;
  session: number;
  componentId: string;
  sketchId: string;
  feature: ExtrudeFeature;
}
export const useExtrudeDraft = create<{ draft?: ExtrudeDraft }>(() => ({}));

export function extrudeContext(state: CadStore, sketchId: string) {
  const document = state.history.present,
    sketch = document.sketches[sketchId];
  if (
    !sketch ||
    state.fileBusy ||
    sketchComponentId(document, sketchId) !== state.activeComponentId
  )
    return;
  // Store edits synchronously queue a rebuild and worker errors publish a fresh
  // failed result; succeeded/failed snapshots therefore refer to immutable present.
  const current =
    (state.rebuild.status === "succeeded" ||
      state.rebuild.status === "failed") &&
    state.rebuild.result?.documentId === document.id;
  if (typeof Worker !== "undefined" && state.rebuild.kernelReady && !current)
    return;
  const solved = current
    ? state.rebuild.result?.solvedSketches?.[sketchId]
    : solveSketch(sketch, evaluateParameters(document.parameters).values);
  const profiles = current
    ? (state.rebuild.result?.profiles?.[sketchId] ?? [])
    : solved
      ? detectProfiles(solved).profiles
      : [];
  if (!profiles.length) return;
  const bodies = (current ? (state.rebuild.result?.bodies ?? []) : []).filter(
    (body) =>
      bodyComponentId(document, body.id) === state.activeComponentId &&
      state.rebuild.result?.meshes.some(
        (mesh) =>
          mesh.bodyId === body.id &&
          mesh.geometrySource === "opencascade" &&
          mesh.geometryAssertions?.valid,
      ),
  );
  // To Face retains its narrower unmodified-owner contract. The native face
  // list also excludes failed/absorbed bodies and lost or ambiguous planes.
  const faces = current
    ? (state.rebuild.result?.availableFaces ?? []).filter(
        (face) => !faceOwnerModifiedBefore(document, face.featureId, {}),
      )
    : [];
  return { sketch, profiles, bodies, faces };
}

export function beginExtrudeCreation(sketchId: string, target?: { profileId: string; snapshot: RebuildResult }) {
  const state = useCadStore.getState(),
    context = extrudeContext(state, sketchId);
  if (!context || (target && !context.profiles.some((profile) => profile.id === target.profileId))) return;
  useExtrudeDraft.setState({
    draft: {
      document: state.history.present,
      session: state.documentSession,
      componentId: state.activeComponentId,
      sketchId,
      ...(target ? { targetSnapshot: target.snapshot } : {}),
      feature: createExtrudeFeature({
        name: `Extrude ${state.history.present.features.length + 1}`,
        componentId: state.activeComponentId,
        sketchId,
        profileId: target?.profileId ?? context.profiles[0].id,
        operation: "newBody",
        distance: {
          expression: "10mm",
          unit: "mm",
          authoredUnit: state.history.present.unitSettings.length,
        },
        direction: "positive",
      }),
    },
  });
}

export function editableExtrude(state: CadStore) {
  const selected = state.selection.selectedIds[0];
  if (
    state.fileBusy ||
    selected?.kind !== "feature" ||
    selected.documentId !== state.history.present.id ||
    !state.rebuild.kernelReady ||
    (state.rebuild.status !== "succeeded" &&
      state.rebuild.status !== "failed") ||
    state.rebuild.result?.documentId !== state.history.present.id ||
    state.rebuild.result.meshes.some(
      (mesh) =>
        mesh.geometrySource !== "opencascade" ||
        !mesh.geometryAssertions?.valid,
    )
  )
    return;
  const feature = state.history.present.features.find(
    (feature) => feature.id === selected.id,
  );
  return feature?.type === "extrude" &&
    !feature.suppressed &&
    featureComponentId(state.history.present, feature) ===
      state.activeComponentId
    ? feature
    : undefined;
}
export function beginExtrudeEditing() {
  const state = useCadStore.getState(),
    feature = editableExtrude(state);
  if (!feature) return;
  useExtrudeDraft.setState({
    draft: {
      editing: true,
      editId: createId("edit"),
      document: state.history.present,
      session: state.documentSession,
      componentId: state.activeComponentId,
      sketchId: feature.sketchId,
      feature,
    },
  });
}

export function isCurrentExtrudeDraft(
  draft: ExtrudeDraft,
  state = useCadStore.getState(),
) {
  return (
    state.documentSession === draft.session &&
    state.history.present === draft.document &&
    state.activeComponentId === draft.componentId &&
    !state.fileBusy &&
    (!draft.targetSnapshot || (state.rebuild.status === "succeeded" && state.rebuild.result === draft.targetSnapshot))
  );
}

export function assertNativeExtrudePreview(
  result: RebuildResult,
  documentId: string,
  feature?: ExtrudeFeature,
) {
  if (result.documentId !== documentId)
    throw new Error("Preview belongs to a different project. Reopen Extrude.");
  if (!result.success)
    throw new Error(
      result.errors.map((error) => error.message).join(" ") ||
        "Extrusion failed. Repair the sketch or settings.",
    );
  if (
    !result.meshes.length ||
    result.meshes.some(
      (mesh) =>
        mesh.geometrySource !== "opencascade" ||
        !mesh.geometryAssertions?.valid ||
        !(mesh.geometryAssertions.volume > 0) ||
        !(mesh.geometryAssertions.solidCount > 0),
    )
  )
    throw new Error(
      "Extrusion preview did not produce valid native solid geometry.",
    );
  if (feature) {
    // The native rebuild tags affected meshes; join retains the first target ID
    // and absorbs every secondary target. Empty/no-op cuts fail in the kernel.
    const expectedIds =
      feature.operation === "newBody"
        ? [stableBodyIdForFeature(feature.id)]
        : feature.operation === "join"
          ? (feature.targetBodyIds?.slice(0, 1) ?? [])
          : (feature.targetBodyIds ?? []);
    const operation =
      feature.operation === "newBody"
        ? feature.termination?.type === "toFace"
          ? "toFace"
          : "extrusion"
        : feature.operation === "join"
          ? "fuse"
          : "cut";
    if (
      !expectedIds.length ||
      expectedIds.some(
        (id) =>
          !result.meshes.some(
            (mesh) => mesh.bodyId === id && mesh.kernelOperation === operation,
          ),
      )
    )
      throw new Error(
        "Preview did not produce the requested extrusion operation. Repair its profile and target bodies.",
      );
  }
}

export function commitExtrude(
  draft: ExtrudeDraft,
  staged: CadDocument,
  result: RebuildResult,
  operationResult?: RebuildResult,
) {
  const state = useCadStore.getState();
  if (
    useExtrudeDraft.getState().draft !== draft ||
    !isCurrentExtrudeDraft(draft, state)
  )
    throw new Error("Project or component changed. Reopen Extrude.");
  const feature = staged.features.find((item) => item.id === draft.feature.id);
  if (!feature || feature.type !== "extrude")
    throw new Error("Extrusion draft was lost.");
  if (draft.editing) {
    if (!operationResult)
      throw new Error("Wait for the feature and downstream native previews.");
    assertNativeExtrudePreview(operationResult, staged.id, feature);
    assertNativeExtrudePreview(result, staged.id);
  } else assertNativeExtrudePreview(result, staged.id, feature);
  state.updateDocument((document) =>
    document === draft.document ? upsertFeature(document, feature) : document,
  );
  if (
    useCadStore.getState().history.present === draft.document ||
    !useCadStore
      .getState()
      .history.present.features.some((item) => item.id === feature.id)
  )
    throw new Error(
      useCadStore.getState().fileError ?? "Extrusion could not be saved.",
    );
  state.select({ kind: "feature", id: feature.id, documentId: staged.id });
  useExtrudeDraft.setState({ draft: undefined });
}
