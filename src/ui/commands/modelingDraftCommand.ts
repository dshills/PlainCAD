import { create } from "zustand";
import type {
  CadDocument,
  RevolveFeature,
  FilletFeature,
  ChamferFeature,
} from "../../cad/document/schema";
import { upsertFeature } from "../../cad/document/CadDocument";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore, type CadStore } from "../../state/useCadStore";

export type ModelingDraftFeature =
  RevolveFeature | FilletFeature | ChamferFeature;
export interface ModelingDraft {
  document: CadDocument;
  session: number;
  componentId: string;
  feature: ModelingDraftFeature;
}
export const useModelingDraft = create<{ draft?: ModelingDraft }>(() => ({}));
export function beginModelingCreation(feature: ModelingDraftFeature) {
  const state = useCadStore.getState();
  if (state.fileBusy) return;
  useModelingDraft.setState({
    draft: {
      document: state.history.present,
      session: state.documentSession,
      componentId: state.activeComponentId,
      feature,
    },
  });
}
export function isCurrentModelingDraft(
  draft: ModelingDraft,
  state: CadStore = useCadStore.getState(),
) {
  return (
    state.documentSession === draft.session &&
    state.history.present === draft.document &&
    state.activeComponentId === draft.componentId &&
    !state.fileBusy
  );
}
export function assertNativeModelingPreview(
  result: RebuildResult,
  documentId: string,
  feature: ModelingDraftFeature,
) {
  if (result.documentId !== documentId)
    throw new Error(
      "Preview belongs to a different project. Reopen the modeling command.",
    );
  if (!result.success)
    throw new Error(
      result.errors.map((error) => error.message).join(" ") ||
        "Modeling failed. Repair the profile or settings.",
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
      "Modeling preview did not produce valid native solid geometry.",
    );
  const ids =
    feature.type !== "revolve"
      ? [
          ...new Set(
            feature.targetEdgeRefs.map((ref) =>
              stableBodyIdForFeature(ref.featureId),
            ),
          ),
        ]
      : feature.operation === "newBody"
        ? [stableBodyIdForFeature(feature.id)]
        : feature.operation === "join"
          ? (feature.targetBodyIds?.slice(0, 1) ?? [])
          : (feature.targetBodyIds ?? []);
  const operation =
    feature.type !== "revolve"
      ? feature.type
      : feature.operation === "newBody"
        ? "revolve"
        : feature.operation === "join"
          ? "fuse"
          : "cut";
  // Native Join consumes every selected target and publishes the connected
  // union under the first target's identity; secondary IDs must disappear.
  if (
    (feature.type === "revolve" &&
      feature.operation === "join" &&
      feature.targetBodyIds
        ?.slice(1)
        .some((id) => result.meshes.some((mesh) => mesh.bodyId === id))) ||
    !ids.length ||
    ids.some(
      (id) =>
        !result.meshes.some(
          (mesh) => mesh.bodyId === id && mesh.kernelOperation === operation,
        ),
    )
  )
    throw new Error(
      "Preview did not produce the requested modeling operation. Repair its profile and target bodies.",
    );
}
export function commitModelingDraft(
  draft: ModelingDraft,
  staged: CadDocument,
  result: RebuildResult,
) {
  if (
    useModelingDraft.getState().draft !== draft ||
    !isCurrentModelingDraft(draft)
  )
    throw new Error(
      "Project or component changed. Reopen the modeling command.",
    );
  const feature = staged.features.find((item) => item.id === draft.feature.id);
  if (
    !feature ||
    (feature.type !== "revolve" &&
      feature.type !== "fillet" &&
      feature.type !== "chamfer") ||
    feature.type !== draft.feature.type
  )
    throw new Error("Modeling draft was lost.");
  assertNativeModelingPreview(result, staged.id, feature);
  const state = useCadStore.getState();
  state.updateDocument((document) =>
    document === draft.document ? upsertFeature(document, feature) : document,
  );
  if (
    !useCadStore
      .getState()
      .history.present.features.some((item) => item.id === feature.id)
  )
    throw new Error(
      useCadStore.getState().fileError ?? "Feature could not be saved.",
    );
  state.select({ kind: "feature", id: feature.id, documentId: staged.id });
  useModelingDraft.setState({ draft: undefined });
}
