import { upstreamBodyOwners } from "../../cad/document/timelineEditing";
import { stableBodyIdForFeature } from "../../cad/document/ids";
import { create } from "zustand";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { upsertFeature } from "../../cad/document/CadDocument";
import { captureTargetScope } from "../../cad/worker/scopeCaptureClient";
import type { ScopedFeature } from "../../cad/features/targetScopeCapture";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";

export const useTargetScopeCapture = create<{
  busy: boolean;
  featureId?: string;
  document?: WeakRef<CadStore["history"]["present"]>;
  session?: number;
  progress?: string;
  error?: string;
}>(() => ({ busy: false }));
export function selectedScopeFeature(
  state: CadStore,
): ScopedFeature | undefined {
  const selection = state.selection.selectedIds[0];
  if (
    selection?.kind !== "feature" ||
    selection.documentId !== state.history.present.id
  )
    return;
  const feature = state.history.present.features.find(
    (f) => f.id === selection.id,
  );
  return feature &&
    !feature.suppressed &&
    (feature.type === "hole" ||
      ((feature.type === "extrude" || feature.type === "revolve") &&
        feature.operation !== "newBody"))
    ? feature
    : undefined;
}
export function canCaptureTargetScope(
  state: CadStore,
  busy = useTargetScopeCapture.getState().busy,
) {
  return (
    !state.fileBusy &&
    state.rebuild.kernelReady &&
    !busy &&
    !!selectedScopeFeature(state)
  );
}
export async function captureSelectedTargetScope() {
  const state = useCadStore.getState(),
    feature = selectedScopeFeature(state);
  if (!feature || !canCaptureTargetScope(state)) return;
  const document = state.history.present,
    session = state.documentSession,
    controller = new AbortController();
  useTargetScopeCapture.setState({
    busy: true,
    featureId: feature.id,
    document: new WeakRef(document),
    session,
    error: undefined,
    progress: "Capturing intersected body IDs…",
  });
  const unsubscribe = useCadStore.subscribe((next) => {
    if (next.history.present !== document || next.documentSession !== session)
      controller.abort();
  });
  try {
    const ids = await captureTargetScope(
      { document, featureId: feature.id },
      controller.signal,
      (progress) => {
        if (
          !controller.signal.aborted &&
          useTargetScopeCapture.getState().busy &&
          useCadStore.getState().history.present === document &&
          useCadStore.getState().documentSession === session
        )
          useTargetScopeCapture.setState({ progress });
      },
    );
    if (
      controller.signal.aborted ||
      useCadStore.getState().history.present !== document ||
      useCadStore.getState().documentSession !== session
    )
      throw new Error(
        "Project changed. Capture targets again for the current feature.",
      );
    const candidates = new Set(
      upstreamBodyOwners(document, feature).map((owner) =>
        stableBodyIdForFeature(owner.id),
      ),
    );
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > MODEL_RESOURCE_LIMITS.maxBodies ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !candidates.has(id))
    )
      throw new Error(
        "Scope capture returned invalid target IDs. Choose targets explicitly.",
      );
    // Unsubscribe before our own intentional document edit. The saved IDs stay
    // fixed on future rebuilds; this probe never enables a dynamic target scope.
    unsubscribe();
    state.updateDocument((d) =>
      d === document
        ? upsertFeature(d, {
            ...feature,
            targetBodyIds: [...ids],
            ...(feature.type === "hole"
              ? { targetBodyId: undefined, targetFeatureId: undefined }
              : {}),
          })
        : d,
    );
    useTargetScopeCapture.setState({
      document: new WeakRef(useCadStore.getState().history.present),
      progress: `Captured ${ids.length} target body ID${ids.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    useTargetScopeCapture.setState({
      document: new WeakRef(useCadStore.getState().history.present),
      error: controller.signal.aborted
        ? "Project changed. Capture targets again for the current feature."
        : `${feature.name}: ${error instanceof Error ? error.message : String(error)}`,
      progress: undefined,
    });
  } finally {
    unsubscribe();
    useTargetScopeCapture.setState({ busy: false });
  }
}
