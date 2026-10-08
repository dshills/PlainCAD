import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { hiddenViewerBodies, useViewerState } from "../../state/viewerState";
import type { CadStore } from "../../state/useCadStore";

export interface CanvasActionTarget {
  document: CadDocument;
  session: number;
  result: RebuildResult;
  componentId: string;
  bodyId: string;
  featureId?: string;
}

/** A body identifies its creating feature, never an inferred latest modifier. */
export function selectedCanvasActionTarget(state: CadStore): CanvasActionTarget | undefined {
  const selected = state.selection.selectedIds[0], result = state.rebuild.result;
  if (state.selection.selectedIds.length !== 1 || state.fileBusy || !state.rebuild.kernelReady || selected?.kind !== "body" || selected.documentId !== state.history.present.id ||
      state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== state.history.present.id) return;
  if (hiddenViewerBodies(state.history.present, [selected.id], state.documentSession, useViewerState.getState()).length) return;
  const mesh = result.meshes.find(item => item.bodyId === selected.id);
  if (mesh?.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid || !Number.isFinite(mesh.geometryAssertions.volume) || mesh.geometryAssertions.volume <= 0 || mesh.geometryAssertions.solidCount <= 0) return;
  const owner = state.history.present.features.find(feature => `body:${feature.id}` === selected.id && !feature.suppressed);
  return { document: state.history.present, session: state.documentSession, result,
    componentId: state.activeComponentId, bodyId: selected.id, ...(owner ? { featureId: owner.id } : {}) };
}

export function canvasActionTargetCurrent(target: CanvasActionTarget, state: CadStore): boolean {
  const current = selectedCanvasActionTarget(state);
  return Boolean(current && current.document === target.document && current.session === target.session &&
    current.result === target.result && current.componentId === target.componentId && current.bodyId === target.bodyId &&
    current.featureId === target.featureId);
}
