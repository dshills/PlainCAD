import { useFileJobs } from "../../persistence/fileJobs";
import { create } from "zustand";
import { createId } from "../../cad/document/ids";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import {
  featureComponentId,
  sketchComponentId,
} from "../../cad/document/components";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import {
  createExtrudeEdgeRef,
  type SupportedEdgeRole,
} from "../../cad/features/topologyRefs";
import { faceOwnerModifiedBefore } from "../../cad/sketch/planes";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useViewerState, hiddenViewerBodies } from "../../state/viewerState";
import { beginExtrudeCreation, useExtrudeDraft } from "./extrudeCommand";
import {
  beginModelingCreation,
  useModelingDraft,
} from "./modelingDraftCommand";
import { useHoleDraft } from "./holeCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";

export const OPERATION_DRAG_TYPE = "application/x-plaincad-operation";
export const SUPPORTED_OPERATION_DROPS = [
  { id: "extrude", label: "Extrude", target: "closed profile" },
  { id: "fillet", label: "Round", target: "original cap perimeter" },
  { id: "chamfer", label: "Bevel", target: "original cap perimeter" },
] as const;
export type DropOperation = (typeof SUPPORTED_OPERATION_DROPS)[number]["id"];
export type OperationTarget =
  | {
      id: string;
      kind: "profile";
      label: string;
      sketchId: string;
      profileId: string;
    }
  | {
      id: string;
      kind: "edge";
      label: string;
      ownerId: string;
      bodyId: string;
      role: SupportedEdgeRole;
    };
export type OperationDropContext = Pick<
  CadStore,
  "fileBusy" | "history" | "rebuild" | "documentSession" | "activeComponentId"
>;
export interface OperationDropFrame {
  id: string;
  operation: DropOperation;
  document: CadDocument;
  result: RebuildResult;
  session: number;
  componentId: string;
}
export const useOperationDrop = create<{
  frame?: OperationDropFrame;
  hoverId?: string;
  error?: string;
}>(() => ({}));
function competingDraft() {
  return Boolean(
    useFileJobs.getState().exportOpen ||
    useExtrudeDraft.getState().draft ||
    useModelingDraft.getState().draft ||
    useHoleDraft.getState().draft ||
    useGuidedHole.getState().draft ||
    useSketchCanvas.getState().active ||
    useProjectWorkflow.getState().active ||
    useTargetScopeCapture.getState().busy,
  );
}
function nativeContext(state: OperationDropContext) {
  return Boolean(
    !state.fileBusy &&
    !useFileJobs.getState().exportOpen &&
    state.rebuild.kernelReady &&
    state.rebuild.status === "succeeded" &&
    state.rebuild.result?.success &&
    state.rebuild.result.documentId === state.history.present.id &&
    state.rebuild.result.meshes.every(
      (mesh) =>
        mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid,
    ),
  );
}
/** Bounded explicit targets. Changed/boolean-created edges never masquerade as
 * original feature-owned cap groups; native preview validates the requested size. */
export function operationDropTargets(
  operation: DropOperation,
  state: OperationDropContext = useCadStore.getState(),
): OperationTarget[] {
  if (!nativeContext(state)) return [];
  const document = state.history.present,
    result = state.rebuild.result!;
  const view = useViewerState.getState();
  const currentView = view.session === state.documentSession;
  if (currentView && view.hiddenComponentIds.includes(state.activeComponentId))
    return [];
  const targets: OperationTarget[] = [];
  if (operation === "extrude") {
    for (const sketch of Object.values(document.sketches)) {
      if (
        sketchComponentId(document, sketch.id) !== state.activeComponentId ||
        (currentView && view.hiddenSketchIds.includes(sketch.id)) ||
        !result.sketchPlanes?.[sketch.id] ||
        result.solvedSketches?.[sketch.id]?.errors.some(
          (e) => e.severity === "error",
        )
      )
        continue;
      for (const [index, profile] of (
        result.profiles?.[sketch.id] ?? []
      ).entries()) {
        targets.push({
          id: `profile:${sketch.id}:${profile.id}`,
          kind: "profile",
          label: `${sketch.name} — region ${index + 1}`,
          sketchId: sketch.id,
          profileId: profile.id,
        });
        if (targets.length === 128) return targets;
      }
    }
  } else {
    const hidden = hiddenViewerBodies(
      document,
      result.meshes.map((m) => m.bodyId),
      state.documentSession,
      view,
    );
    for (const owner of document.features) {
      if (
        owner.type !== "extrude" ||
        owner.suppressed ||
        owner.operation !== "newBody" ||
        (owner.termination && owner.termination.type !== "distance") ||
        featureComponentId(document, owner) !== state.activeComponentId ||
        faceOwnerModifiedBefore(document, owner.id, {})
      )
        continue;
      const bodyId = stableBodyIdForFeature(owner.id);
      const mesh = result.meshes.find((m) => m.bodyId === bodyId);
      if (
        hidden.includes(bodyId) ||
        mesh?.kernelOperation !== "extrusion" ||
        !mesh.geometryAssertions?.valid
      )
        continue;
      for (const [role, face, label] of [
        ["endCapPerimeter", "endCap", "end cap perimeter"],
        ["startCapPerimeter", "startCap", "start cap perimeter"],
      ] as const) {
        if (
          !result.availableFaces?.some(
            (f) => f.id === `extrude:${owner.id}:${face}`,
          )
        )
          continue;
        targets.push({
          id: `edge:${owner.id}:${role}`,
          kind: "edge",
          label: `${owner.name} — ${label} (all original edges)`,
          ownerId: owner.id,
          bodyId,
          role,
        });
        if (targets.length === 128) return targets;
      }
    }
  }
  return targets.slice(0, 128);
}
export function canBeginOperationDrop(
  state: OperationDropContext = useCadStore.getState(),
  operation?: DropOperation,
) {
  return (
    !useOperationDrop.getState().frame &&
    !competingDraft() &&
    nativeContext(state) &&
    (operation
      ? operationDropTargets(operation, state).length > 0
      : SUPPORTED_OPERATION_DROPS.some(
          (op) => operationDropTargets(op.id, state).length > 0,
        ))
  );
}
export function beginOperationDrop(operation?: DropOperation) {
  const state = useCadStore.getState();
  const selected =
    operation ??
    SUPPORTED_OPERATION_DROPS.find(
      (op) => operationDropTargets(op.id, state).length,
    )?.id;
  if (
    !selected ||
    !SUPPORTED_OPERATION_DROPS.some((op) => op.id === selected) ||
    !canBeginOperationDrop(state, selected)
  )
    throw new Error(
      "Finish or cancel the current task and choose an available closed profile or untouched native distance-extrusion cap perimeter.",
    );
  useOperationDrop.setState({
    frame: {
      id: createId("operation"),
      operation: selected,
      document: state.history.present,
      result: state.rebuild.result!,
      session: state.documentSession,
      componentId: state.activeComponentId,
    },
    hoverId: undefined,
    error: undefined,
  });
}
export function operationDropCurrent(
  frame: OperationDropFrame,
  state: OperationDropContext = useCadStore.getState(),
) {
  return (
    useOperationDrop.getState().frame === frame &&
    state.history.present === frame.document &&
    state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId &&
    state.rebuild.result === frame.result &&
    nativeContext(state) &&
    !competingDraft()
  );
}
export const operationTransferValue = (frame: OperationDropFrame) =>
  `${frame.operation}:${frame.id}`;
export const cancelOperationDrop = () =>
  useOperationDrop.setState({
    frame: undefined,
    hoverId: undefined,
    error: undefined,
  });
export function operationDraftBusy() {
  return Boolean(
    useOperationDrop.getState().frame ||
    useExtrudeDraft.getState().draft?.targetSnapshot ||
    useModelingDraft.getState().draft?.targetSnapshot,
  );
}
/** Shared click, keyboard and drag dispatcher. Choosing a target starts an
 * existing native preview dialog; only its explicit Apply mutates the document. */
export function chooseOperationDropTarget(
  frame: OperationDropFrame | undefined,
  targetId: string | undefined,
) {
  if (!frame || !operationDropCurrent(frame))
    throw new Error(
      "Project, component or modeling task changed. Cancel and choose the operation target again.",
    );
  const target = operationDropTargets(frame.operation).find(
    (target) => target.id === targetId,
  );
  if (!target)
    throw new Error(
      "This target is hidden, changed or unsupported. Choose a highlighted eligible target.",
    );
  if (target.kind === "profile" && frame.operation === "extrude") {
    beginExtrudeCreation(target.sketchId, {
      profileId: target.profileId,
      snapshot: frame.result,
    });
    if (!useExtrudeDraft.getState().draft)
      throw new Error(
        "The closed profile is unavailable. Rebuild and choose it again.",
      );
  } else if (target.kind === "edge" && frame.operation !== "extrude") {
    const common = {
      id: createId("feature"),
      name: `${frame.operation === "fillet" ? "Round" : "Bevel"} ${frame.document.features.length + 1}`,
      componentId: frame.componentId,
      targetEdgeRefs: [createExtrudeEdgeRef(target.ownerId, target.role)],
      createdAt: new Date().toISOString(),
    };
    beginModelingCreation(
      frame.operation === "fillet"
        ? {
            ...common,
            type: "fillet",
            radius: {
              expression: "1mm",
              unit: "mm",
              authoredUnit: frame.document.unitSettings.length,
            },
          }
        : {
            ...common,
            type: "chamfer",
            distance: {
              expression: "1mm",
              unit: "mm",
              authoredUnit: frame.document.unitSettings.length,
            },
          },
      frame.result,
    );
    const draft = useModelingDraft.getState().draft;
    if (!draft)
      throw new Error(
        "The edge preview could not start. Cancel and choose its owner again.",
      );
  } else
    throw new Error(
      "Use Extrude on a closed profile, or Round/Bevel on an original supported cap perimeter.",
    );
  cancelOperationDrop();
}
