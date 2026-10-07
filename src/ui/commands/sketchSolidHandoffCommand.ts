import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import { useFacePocketIntent } from "./facePocketIntentState";
import { beginExtrudeCreation, useExtrudeDraft } from "./extrudeCommand";
import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import { bodyComponentId, sketchComponentId } from "../../cad/document/components";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import {
  beginOperationDrop,
  cancelOperationDrop,
  chooseOperationDropTarget,
  operationDropCurrent,
  operationDropTargets,
  useOperationDrop,
  type OperationDropFrame,
} from "./operationDropCommand";

export interface SketchSolidHandoff {
  document: CadDocument;
  session: number;
  componentId: string;
  sketchId: string;
  pocketIntent?: boolean;
  autoPreview?: boolean;
}
type HandoffContext = Pick<CadStore, "fileBusy" | "history" | "documentSession" | "activeComponentId">;
export const useSketchSolidHandoff = create<{
  source?: SketchSolidHandoff;
  selectedTargetId?: string;
  error?: string;
}>(() => ({}));

/** An immutable source capture, separate from durable geometry and history. */
export function beginSketchSolidHandoff(sketchId: string, autoPreview = false) {
  const state = useCadStore.getState();
  if (state.fileBusy || !state.history.present.sketches[sketchId] ||
      sketchComponentId(state.history.present, sketchId) !== state.activeComponentId) return;
  cancelSketchSolidHandoff();
  const intent = useFacePocketIntent.getState().source;
  useSketchSolidHandoff.setState({ source: {
    document: state.history.present,
    session: state.documentSession,
    componentId: state.activeComponentId,
    sketchId,
    autoPreview,
    pocketIntent: Boolean(intent && intent.sketchId === sketchId && intent.documentId === state.history.present.id && intent.session === state.documentSession && intent.componentId === state.activeComponentId),
  }, selectedTargetId: undefined, error: undefined });
}

export function sketchSolidHandoffCurrent(source: SketchSolidHandoff, state: HandoffContext = useCadStore.getState()) {
  return useSketchSolidHandoff.getState().source === source && !state.fileBusy &&
    state.history.present === source.document && state.documentSession === source.session &&
    state.activeComponentId === source.componentId &&
    sketchComponentId(source.document, source.sketchId) === source.componentId;
}

/** Wait for this exact sketch's worker analysis. A stale result never opens a picker. */
export function refreshSketchSolidHandoff(source: SketchSolidHandoff) {
  if (!sketchSolidHandoffCurrent(source)) return;
  const state = useCadStore.getState();
  if (!operationDropTargets("extrude", state, source.sketchId).length) return;
  const existing = useOperationDrop.getState().frame;
  if (existing) {
    if (existing.handoffSketchId !== source.sketchId || existing.document !== source.document ||
        existing.session !== source.session || existing.componentId !== source.componentId || operationDropCurrent(existing)) return;
    // A new native result for the same immutable source replaces the captured
    // picker. Callbacks from the previous frame remain rejected by identity.
    cancelOperationDrop();
  }
  try {
    beginOperationDrop("extrude", source.sketchId);
    const targets = operationDropTargets("extrude", state, source.sketchId);
    useSketchSolidHandoff.setState({
      selectedTargetId: targets.length === 1 ? targets[0].id : undefined,
      error: undefined,
    });
    // A face sketch has an additive/subtractive choice; never infer that intent.
    // Only the guided Finish action may skip an unambiguous region chooser.
    if (source.autoPreview && targets.length === 1 &&
        source.document.sketches[source.sketchId].plane.type !== "face") {
      try {
        makeSketchSolid();
      } catch (failure) {
        useSketchSolidHandoff.setState({ error: `Could not open thickness preview: ${failure instanceof Error ? failure.message : String(failure)}` });
      }
    }
  } catch {
    // Another draft owns the interaction. The panel exposes Cancel/Edit rather
    // than stealing it; once that draft closes the subscribed refresh retries.
  }
}

export function chooseSketchSolidRegion(frame: OperationDropFrame | undefined, targetId: string | undefined) {
  const source = useSketchSolidHandoff.getState().source;
  if (!source || !sketchSolidHandoffCurrent(source) || !frame ||
      frame.handoffSketchId !== source.sketchId || !operationDropCurrent(frame))
    throw new Error("The sketch or project changed. Finish the current sketch again.");
  const target = operationDropTargets("extrude", useCadStore.getState(), source.sketchId).find((item) => item.id === targetId);
  if (!target || target.kind !== "profile")
    throw new Error("Choose a highlighted closed region belonging to this sketch.");
  useSketchSolidHandoff.setState({ selectedTargetId: target.id, error: undefined });
  useOperationDrop.setState({ hoverId: target.id, error: undefined });
}

export function canMakeSketchSolid(state: CadStore = useCadStore.getState()) {
  const { source, selectedTargetId } = useSketchSolidHandoff.getState();
  const frame = useOperationDrop.getState().frame;
  return Boolean(source && sketchSolidHandoffCurrent(source, state) && frame &&
    frame.handoffSketchId === source.sketchId && operationDropCurrent(frame, state) &&
    operationDropTargets("extrude", state, source.sketchId).some((target) => target.id === selectedTargetId));
}

/** The explicit action opens an existing native preview; Apply alone edits CAD. */
export function makeSketchSolid() {
  const { source, selectedTargetId } = useSketchSolidHandoff.getState();
  const frame = useOperationDrop.getState().frame;
  if (!source || !canMakeSketchSolid() || !frame || !selectedTargetId)
    throw new Error("Choose a current highlighted closed region before making a solid.");
  chooseOperationDropTarget(frame, selectedTargetId);
  useSketchSolidHandoff.setState({ source: undefined, selectedTargetId: undefined, error: undefined });
}

export function cancelSketchSolidHandoff() {
  const source = useSketchSolidHandoff.getState().source;
  const frame = useOperationDrop.getState().frame;
  if (source && frame?.handoffSketchId === source.sketchId && frame.document === source.document &&
      frame.session === source.session && frame.componentId === source.componentId) cancelOperationDrop();
  useSketchSolidHandoff.setState({ source: undefined, selectedTargetId: undefined, error: undefined });
}

/** Only the exact currently retained face and its active native body can own a pocket. */
export function sketchPocketTarget(state: CadStore = useCadStore.getState()) {
  const source = useSketchSolidHandoff.getState().source;
  if (!source || !sketchSolidHandoffCurrent(source, state)) return;
  const plane = source.document.sketches[source.sketchId]?.plane;
  if (plane?.type !== "face" || plane.lost) return;
  const result = state.rebuild.result;
  if (state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== source.document.id) return;
  const bodyId = stableBodyIdForFeature(plane.featureId);
  const face = result?.availableFaces?.find((item) => item.id === plane.stableFaceId && item.featureId === plane.featureId);
  const body = result?.bodies.find((item) => item.id === bodyId);
  const mesh = result?.meshes.find((item) => item.bodyId === bodyId);
  if (bodyComponentId(source.document, bodyId) !== source.componentId || !face || !body || mesh?.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid ||
      mesh.geometryAssertions.solidCount !== 1 || !(mesh.geometryAssertions.volume > 0)) return;
  return { bodyId, name: body.name, faceId: face.id, baseVolume: mesh.geometryAssertions.volume };
}
export function canRemoveSketchMaterial(state: CadStore = useCadStore.getState()) {
  return canMakeSketchSolid(state) && Boolean(sketchPocketTarget(state));
}
export function removeSketchMaterial() {
  const pocket = sketchPocketTarget();
  if (!pocket || !canRemoveSketchMaterial())
    throw new Error("Choose a current closed region on a retained supported face before removing material from its body.");
  const { source, selectedTargetId } = useSketchSolidHandoff.getState();
  const frame = useOperationDrop.getState().frame;
  if (!source || !frame || !operationDropCurrent(frame))
    throw new Error("The sketch or native geometry changed. Finish the face sketch again.");
  const target = operationDropTargets("extrude", useCadStore.getState(), source.sketchId).find((item) => item.id === selectedTargetId);
  if (!target || target.kind !== "profile") throw new Error("Choose a highlighted closed region from this face sketch.");
  const previousDraft = useExtrudeDraft.getState().draft;
  beginExtrudeCreation(target.sketchId, { profileId: target.profileId, snapshot: frame.result, pocket });
  const draft = useExtrudeDraft.getState().draft;
  if (!draft || draft.document !== source.document || draft.targetSnapshot !== frame.result ||
      draft.sketchId !== source.sketchId || draft.feature.profileId !== target.profileId || draft.pocket !== pocket) {
    if (draft && draft !== previousDraft) useExtrudeDraft.setState({ draft: undefined });
    throw new Error("The pocket preview could not start. Finish the face sketch again.");
  }
  cancelOperationDrop();
  useSketchSolidHandoff.setState({ source: undefined, selectedTargetId: undefined, error: undefined });
}
