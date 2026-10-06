import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import { sketchComponentId } from "../../cad/document/components";
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
}
type HandoffContext = Pick<CadStore, "fileBusy" | "history" | "documentSession" | "activeComponentId">;
export const useSketchSolidHandoff = create<{
  source?: SketchSolidHandoff;
  selectedTargetId?: string;
  error?: string;
}>(() => ({}));

/** An immutable source capture, separate from durable geometry and history. */
export function beginSketchSolidHandoff(sketchId: string) {
  const state = useCadStore.getState();
  if (state.fileBusy || !state.history.present.sketches[sketchId] ||
      sketchComponentId(state.history.present, sketchId) !== state.activeComponentId) return;
  cancelSketchSolidHandoff();
  useSketchSolidHandoff.setState({ source: {
    document: state.history.present,
    session: state.documentSession,
    componentId: state.activeComponentId,
    sketchId,
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
