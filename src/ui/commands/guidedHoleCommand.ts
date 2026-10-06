import { create } from "zustand";
import { interactionDraftBusy } from "./interactionDraftState";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import type {
  CadDocument,
  ExpressionRef,
  HoleFeature,
} from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { featureComponentId } from "../../cad/document/components";
import { createId } from "../../cad/document/ids";
import { upsertFeature, upsertSketch } from "../../cad/document/CadDocument";
import { createSketchOnPlane } from "../../cad/sketch/SketchModel";
import {
  sketchPlaneChoices,
  type SketchPlaneChoice,
} from "../../cad/sketch/planePicking";
import {
  evaluateExpressionRef,
  evaluateParameters,
  type ParameterEvaluation,
} from "../../cad/parameters/expressionEvaluator";
import { bindDocumentExpressions } from "../../cad/parameters/expressionBindings";
import {
  guidedFaceBoundary,
  guidedFaceClearance,
  guidedFaceContains,
  guidedFaceStraightCapEdges,
  guidedFaceTriangles,
  type FacePoint,
} from "../../cad/sketch/guidedHoleGeometry";
import { assertProjectJsonShape } from "../../persistence/importSafety";
import { assertNativeHolePreview, useHoleDraft } from "./holeCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { KERNEL_LINEAR_TOLERANCE } from "../../cad/sketch/tolerances";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";

export interface GuidedHoleDraft {
  kind: "guidedHole";
  document: CadDocument;
  result: RebuildResult;
  session: number;
  componentId: string;
  selection: CadStore["selection"]["selectedIds"][number] | undefined;
  phase: "face" | "centers";
  choice?: SketchPlaneChoice;
  sketchId: string;
  featureId: string;
}
export interface GuidedHoleCenter {
  id: string;
  x: string;
  y: string;
}
export interface GuidedHoleInput {
  centers: GuidedHoleCenter[];
  diameter: string;
  depth: string;
  throughAll: boolean;
}
export const useGuidedHole = create<{ draft?: GuidedHoleDraft }>(() => ({}));
export function guidedHoleCurrent(
  draft: GuidedHoleDraft,
  state: CadStore = useCadStore.getState(),
) {
  const selected = state.selection.selectedIds[0];
  return (
    state.history.present === draft.document &&
    state.documentSession === draft.session &&
    state.activeComponentId === draft.componentId &&
    !state.fileBusy && !interactionDraftBusy() &&
    state.rebuild.status === "succeeded" &&
    state.rebuild.result === draft.result &&
    selected?.id === draft.selection?.id &&
    selected?.kind === draft.selection?.kind &&
    selected?.documentId === draft.selection?.documentId
  );
}
export function guidedHoleFaces(state: CadStore = useCadStore.getState()) {
  if (
    state.fileBusy ||
    state.rebuild.status !== "succeeded" ||
    !state.rebuild.kernelReady ||
    !state.rebuild.result?.success ||
    state.rebuild.result.documentId !== state.history.present.id
  )
    return [];
  return sketchPlaneChoices(state.history.present, state.rebuild.result).filter(
    (choice) => {
      if (!choice.bodyId || typeof choice.reference === "string") return false;
      const reference = choice.reference;
      const feature = state.history.present.features.find(
        (f) => f.id === reference.featureId,
      );
      return (
        feature &&
        featureComponentId(state.history.present, feature) ===
          state.activeComponentId
      );
    },
  );
}
export function canBeginGuidedHole(state: CadStore = useCadStore.getState()) {
  return (
    !useGuidedHole.getState().draft &&
    !interactionDraftBusy() &&
    !useSketchCanvas.getState().active &&
    !useProjectWorkflow.getState().active &&
    !useExtrudeDraft.getState().draft &&
    !useHoleDraft.getState().draft &&
    !useModelingDraft.getState().draft &&
    guidedHoleFaces(state).length > 0
  );
}
export function beginGuidedHole() {
  const state = useCadStore.getState();
  if (!canBeginGuidedHole(state)) return;
  useGuidedHole.setState({
    draft: {
      kind: "guidedHole",
      document: state.history.present,
      result: state.rebuild.result!,
      session: state.documentSession,
      componentId: state.activeComponentId,
      selection: state.selection.selectedIds[0],
      phase: "face",
      sketchId: createId("sketch"),
      featureId: createId("feature"),
    },
  });
}
export function chooseGuidedHoleFace(choiceId: string) {
  const draft = useGuidedHole.getState().draft;
  if (!draft || !guidedHoleCurrent(draft))
    throw new Error(
      "Project or selection changed. Cancel and start guided Hole again.",
    );
  const choice = guidedHoleFaces().find((c) => c.id === choiceId);
  if (!choice)
    throw new Error(
      "Choose a current supported native planar face in the active component.",
    );
  if (draft.phase !== "face")
    throw new Error(
      "Cancel and choose the face again before placing new centers.",
    );
  const mesh = draft.result.meshes.find((m) => m.bodyId === choice.bodyId);
  if (!mesh || !guidedFaceTriangles(choice, mesh).length)
    throw new Error(
      "This face has no current native placement surface. Choose another supported face.",
    );
  useGuidedHole.setState({ draft: { ...draft, choice, phase: "centers" } });
}
export const cancelGuidedHole = () =>
  useGuidedHole.setState({ draft: undefined });
export function resolveGuidedHoleCenter(
  draft: GuidedHoleDraft,
  center: GuidedHoleCenter,
  parameters: ParameterEvaluation = evaluateParameters(
    draft.document.parameters,
  ),
): FacePoint {
  if (parameters.errors.length) throw new Error(parameters.errors[0].message);
  const evaluate = (expression: string) => {
    const value = evaluateExpressionRef(
      {
        expression,
        authoredUnit: draft.document.unitSettings.length,
      },
      { parameters: parameters.values },
    );
    if (
      value.error ||
      value.quantity?.dimension !== "length" ||
      !Number.isFinite(value.quantity.value)
    )
      throw new Error(
        value.error ?? "Center coordinates must be finite lengths.",
      );
    return value.quantity.value;
  };
  return { x: evaluate(center.x), y: evaluate(center.y) };
}
export function stageGuidedHole(
  draft: GuidedHoleDraft,
  input: GuidedHoleInput,
) {
  if (
    !guidedHoleCurrent(draft) ||
    draft.phase !== "centers" ||
    !draft.choice ||
    typeof draft.choice.reference === "string"
  )
    throw new Error(
      "Project or selection changed. Cancel and start guided Hole again.",
    );
  const choice = guidedHoleFaces().find((c) => c.id === draft.choice!.id);
  if (!choice?.bodyId || typeof choice.reference === "string")
    throw new Error(
      "The selected face is no longer available. Choose a supported current face.",
    );
  if (
    !input.centers.length ||
    input.centers.length > MODEL_RESOURCE_LIMITS.maxHoleCenters ||
    new Set(input.centers.map((c) => c.id)).size !== input.centers.length ||
    input.centers.some(
      (center) => typeof center.id !== "string" || !center.id.trim(),
    )
  )
    throw new Error(
      `Place 1–${MODEL_RESOURCE_LIMITS.maxHoleCenters} unique hole centers.`,
    );
  const mesh = draft.result.meshes.find((m) => m.bodyId === choice.bodyId);
  if (!mesh)
    throw new Error(
      "The selected face mesh is no longer available. Cancel and choose a current face.",
    );
  const triangles = guidedFaceTriangles(choice, mesh);
  if (!triangles.length)
    throw new Error(
      "This face has no current native placement surface. Choose another supported face.",
    );
  const parameters = evaluateParameters(draft.document.parameters);
  const resolved = input.centers.map((c) =>
    resolveGuidedHoleCenter(draft, c, parameters),
  );
  if (resolved.some((point) => !guidedFaceContains(triangles, point)))
    throw new Error(
      "Place each center on the selected face, outside existing openings.",
    );
  if (
    resolved.some((p, i) =>
      resolved.slice(0, i).some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6),
    )
  )
    throw new Error("Hole centers overlap. Remove or move a duplicate center.");
  const expression = (text: string): ExpressionRef => ({
    expression: text,
    authoredUnit: draft.document.unitSettings.length,
    unit: "mm",
  });
  const evaluateSize = (label: string, text: string) => {
    const value = evaluateExpressionRef(expression(text), {
      parameters: parameters.values,
    });
    if (
      value.error ||
      value.quantity?.dimension !== "length" ||
      !Number.isFinite(value.quantity.value) ||
      !(value.quantity.value > 0)
    )
      throw new Error(
        `Hole ${label} must be a positive length. ${value.error ?? ""}`,
      );
    return value.quantity.value;
  };
  const diameter = evaluateSize("diameter", input.diameter);
  if (!input.throughAll) evaluateSize("depth", input.depth);
  const reference = choice.reference;
  const owner = draft.document.features.find(
    (feature) => feature.id === reference.featureId,
  );
  const profile =
    owner?.type === "extrude"
      ? draft.result.profiles?.[owner.sketchId]?.find(
          (p) =>
            p.id === owner.profileId ||
            p.alternateIds?.includes(owner.profileId),
        )
      : undefined;
  const straightEdges = guidedFaceStraightCapEdges(
    choice,
    profile,
    owner?.type === "extrude"
      ? draft.result.sketchPlanes?.[owner.sketchId]
      : undefined,
  );
  const boundary = guidedFaceBoundary(triangles, straightEdges);
  if (
    resolved.some(
      (center) =>
        guidedFaceClearance(boundary, center) <
        diameter / 2 - KERNEL_LINEAR_TOLERANCE,
    )
  )
    throw new Error(
      "Each circular hole must fit entirely on the selected face. Move centers away from face edges and existing openings, or reduce the diameter. Curved and other unverified boundaries need extra clearance.",
    );
  if (
    resolved.some((p, i) =>
      resolved
        .slice(0, i)
        .some(
          (q) =>
            Math.hypot(p.x - q.x, p.y - q.y) <
            diameter - KERNEL_LINEAR_TOLERANCE,
        ),
    )
  )
    throw new Error(
      "Circular holes overlap. Move centers farther apart or reduce the diameter.",
    );
  const sketch = {
    ...createSketchOnPlane("Hole centers", choice.reference),
    id: draft.sketchId,
    componentId: draft.componentId,
    entities: Object.fromEntries(
      input.centers.map((center) => [
        center.id,
        {
          id: center.id,
          type: "point" as const,
          x: expression(center.x),
          y: expression(center.y),
        },
      ]),
    ),
  };
  const feature: HoleFeature = {
    id: draft.featureId,
    name: "Face holes",
    type: "hole",
    componentId: draft.componentId,
    sketchId: sketch.id,
    centerPointIds: input.centers.map((c) => c.id),
    targetBodyIds: [choice.bodyId],
    direction: "negative",
    diameter: expression(input.diameter),
    depth: input.throughAll ? "throughAll" : expression(input.depth),
  };
  const document = bindDocumentExpressions(
    upsertFeature(upsertSketch(draft.document, sketch), feature),
    draft.document,
  );
  assertProjectJsonShape(document);
  return {
    document,
    feature: document.features.find((f) => f.id === feature.id) as HoleFeature,
    centers: resolved,
  };
}
export function commitGuidedHole(
  draft: GuidedHoleDraft,
  staged: ReturnType<typeof stageGuidedHole>,
  result: RebuildResult,
) {
  if (useGuidedHole.getState().draft !== draft || !guidedHoleCurrent(draft))
    throw new Error(
      "Project or selection changed. The preview cannot be applied.",
    );
  assertNativeHolePreview(result, staged.document.id, staged.feature);
  const state = useCadStore.getState();
  state.updateDocument((document) =>
    document === draft.document ? staged.document : document,
  );
  if (useCadStore.getState().history.present === draft.document)
    throw new Error(
      "Guided Hole could not be saved. Check project diagnostics.",
    );
  cancelGuidedHole();
  state.select({
    kind: "feature",
    id: staged.feature.id,
    documentId: staged.document.id,
  });
}
