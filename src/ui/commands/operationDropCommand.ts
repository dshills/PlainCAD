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
import { capEdgeSourceIds } from "../../cad/features/operationTargetGeometry";
import { interactionDraftBusy } from "./interactionDraftState";

export const OPERATION_DRAG_TYPE = "application/x-plaincad-operation";
export const SUPPORTED_OPERATION_DROPS = [
  { id: "extrude", label: "Extrude", target: "closed profile" },
  { id: "fillet", label: "Fillet", target: "authored cap edge or perimeter" },
  { id: "chamfer", label: "Chamfer", target: "authored cap edge or perimeter" },
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
      sourceEntityId?: string;
    };
export type OperationDropContext = Pick<
  CadStore,
  "fileBusy" | "history" | "rebuild" | "documentSession" | "activeComponentId"
>;
export interface OperationDropFrame {
  /** Finish Sketch restricts the region chooser to its captured sketch. */
  handoffSketchId?: string;
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
    interactionDraftBusy() ||
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
  sketchId?: string,
): OperationTarget[] {
  if (!nativeContext(state)) return [];
  const document = state.history.present,
    result = state.rebuild.result!;
  const view = useViewerState.getState();
  const currentView = view.session === state.documentSession;
  if (currentView && view.hiddenComponentIds.includes(state.activeComponentId))
    return [];
  const targets: OperationTarget[] = [];
  const individualTargets: OperationTarget[] = [];
  if (operation === "extrude") {
    for (const sketch of Object.values(document.sketches)) {
      if (
        (sketchId !== undefined && sketch.id !== sketchId) ||
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
        featureComponentId(document, owner) !== state.activeComponentId
      )
        continue;
      const bodyId = stableBodyIdForFeature(owner.id);
      const mesh = result.meshes.find((m) => m.bodyId === bodyId);
      if (
        hidden.includes(bodyId) ||
        mesh?.geometrySource !== "opencascade" ||
        !mesh.geometryAssertions?.valid ||
        !["extrusion", "cut", "fuse"].includes(mesh.kernelOperation ?? "")
      )
        continue;
      const edges = result.availableEdges?.filter((edge) => edge.featureId === owner.id && edge.bodyId === bodyId && (edge.role === "startCapPerimeter" || edge.role === "endCapPerimeter")) ?? [];
      if (!edges.length) continue;
      const sourceIds = individualTargets.length < 128 ? capEdgeSourceIds(owner.id, document, result) : [];
      for (const [role, label] of [
        ["endCapPerimeter", "end cap"],
        ["startCapPerimeter", "start cap"],
      ] as const) {
        if (edges.some((edge) => edge.role === role && edge.sourceEntityId === undefined)) {
          targets.push({
            id: `edge:${owner.id}:${role}`,
            kind: "edge",
            label: `${owner.name} — ${label} perimeter (all original edges)`,
            ownerId: owner.id,
            bodyId,
            role,
          });
          if (targets.length === 128) return targets;
        }
        for (const [index, sourceEntityId] of sourceIds.entries()) {
          if (individualTargets.length === 128) break;
          if (!edges.some((edge) => edge.role === role && edge.sourceEntityId === sourceEntityId)) continue;
          individualTargets.push({ id: `edge:${owner.id}:${role}:${sourceEntityId}`, kind: "edge",
            label: `${owner.name} — ${label} edge ${index + 1} (${document.sketches[owner.sketchId]?.entities[sourceEntityId]?.type ?? "curve"})`,
            ownerId: owner.id, bodyId, role, sourceEntityId });
        }
      }
    }
  }
  // Preserve access to every eligible owner's cap cards before filling the
  // remaining bounded target budget with individual authored edges.
  return [...targets, ...individualTargets].slice(0, 128);
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
export function beginOperationDrop(operation?: DropOperation, handoffSketchId?: string) {
  const state = useCadStore.getState();
  const selected =
    operation ??
    SUPPORTED_OPERATION_DROPS.find(
      (op) => operationDropTargets(op.id, state).length,
    )?.id;
  if (
    !selected ||
    !SUPPORTED_OPERATION_DROPS.some((op) => op.id === selected) ||
    (handoffSketchId !== undefined &&
      (selected !== "extrude" || !operationDropTargets(selected, state, handoffSketchId).length)) ||
    !canBeginOperationDrop(state, selected)
  )
    throw new Error(
      "Finish or cancel the current task and choose an available closed profile or native-validated original distance-extrusion edge.",
    );
  useOperationDrop.setState({
    frame: {
      id: createId("operation"),
      operation: selected,
      ...(handoffSketchId ? { handoffSketchId } : {}),
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
  const target = operationDropTargets(frame.operation, useCadStore.getState(), frame.handoffSketchId).find(
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
      name: `${frame.operation === "fillet" ? "Fillet" : "Chamfer"} ${frame.document.features.length + 1}`,
      componentId: frame.componentId,
      targetEdgeRefs: [createExtrudeEdgeRef(target.ownerId, target.role, target.sourceEntityId)],
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
      "Use Extrude on a closed profile, or Fillet/Chamfer on an unchanged original supported cap edge or perimeter.",
    );
  cancelOperationDrop();
}
