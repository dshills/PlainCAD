import type { CadDocument, HoleFeature } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import {
  featureComponentId,
  sketchComponentId,
} from "../../cad/document/components";
import { create } from "zustand";
import type { CadStore } from "../../state/useCadStore";
import { useCadStore } from "../../state/useCadStore";
import { createId } from "../../cad/document/ids";
import { upsertFeature } from "../../cad/document/CadDocument";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import {
  evaluateExpressionRef,
  evaluateParameters,
} from "../../cad/parameters/expressionEvaluator";

export const useHoleDraft = create<{
  draft?: {
    document: CadDocument;
    session: number;
    componentId: string;
    featureId: string;
    documentId: string;
    sketchId: string;
    centerPointIds: string[];
  };
}>(() => ({}));
export type HoleDraft = NonNullable<
  ReturnType<typeof useHoleDraft.getState>["draft"]
>;
export const DEFAULT_HOLE_DEPTH = "5mm";

export function holeCreationContext(state: CadStore, sketchId?: string) {
  const document = state.history.present,
    { rebuild } = state;
  if (
    state.fileBusy ||
    !rebuild.kernelReady ||
    rebuild.status !== "succeeded" ||
    !rebuild.result?.success ||
    rebuild.result.documentId !== document.id
  )
    return undefined;
  const selected = state.selection.selectedIds[0];
  const sketch = sketchId
    ? document.sketches[sketchId]
    : selected?.kind === "sketch"
      ? document.sketches[selected.id]
      : selected?.kind === "sketchEntity"
        ? Object.values(document.sketches).find((s) => s.entities[selected.id])
        : undefined;
  if (
    !sketch ||
    sketchComponentId(document, sketch.id) !== state.activeComponentId
  )
    return undefined;
  const solved = rebuild.result.solvedSketches?.[sketch.id];
  const points = Object.values(sketch.entities).filter(
    (e) => e.type === "point" && solved?.points[e.id],
  );
  const nativeIds = new Set(
    rebuild.result.meshes
      .filter(
        (m) =>
          m.geometrySource === "opencascade" && m.geometryAssertions?.valid,
      )
      .map((m) => m.bodyId),
  );
  const bodies = document.features
    .filter(
      (f) =>
        featureComponentId(document, f) ===
          sketchComponentId(document, sketch.id) &&
        !f.suppressed &&
        (f.type === "extrude" || f.type === "revolve") &&
        f.operation === "newBody",
    )
    .flatMap((f) => {
      const bodyId = stableBodyIdForFeature(f.id);
      return nativeIds.has(bodyId)
        ? [{ id: bodyId, name: `${f.name} Body` }]
        : [];
    });
  return points.length && bodies.length
    ? { document, sketch, solved: solved!, points, bodies }
    : undefined;
}

export function beginHoleCreation() {
  const state = useCadStore.getState(),
    context = holeCreationContext(state);
  if (!context) return;
  const selected = state.selection.selectedIds[0];
  const centers =
    selected?.kind === "sketchEntity" &&
    context.points.some((p) => p.id === selected.id)
      ? [selected.id]
      : [];
  useHoleDraft.setState({
    draft: {
      document: context.document,
      session: state.documentSession,
      componentId: state.activeComponentId,
      featureId: createId("feature"),
      documentId: context.document.id,
      sketchId: context.sketch.id,
      centerPointIds: centers,
    },
  });
}

export interface HoleInput {
  name: string;
  targetBodyId?: string;
  targetBodyIds?: string[];
  centerPointIds: string[];
  diameter: string;
  depth: string;
  throughAll: boolean;
}
export function isCurrentHoleDraft(
  draft: HoleDraft,
  state: CadStore = useCadStore.getState(),
) {
  return (
    state.history.present === draft.document &&
    state.documentSession === draft.session &&
    state.activeComponentId === draft.componentId &&
    !state.fileBusy
  );
}
export function stageHole(
  input: HoleInput,
  state: CadStore = useCadStore.getState(),
  draft = useHoleDraft.getState().draft,
):
  | { ok: true; feature: HoleFeature; document: CadDocument }
  | { ok: false; reason: string } {
  const fail = (reason: string): { ok: false; reason: string } => ({
    ok: false,
    reason,
  });
  if (!draft || !isCurrentHoleDraft(draft, state))
    return fail(
      "Project changed. Close this dialog and choose the source sketch again.",
    );
  const context = holeCreationContext(state, draft.sketchId);
  if (!context)
    return fail(
      "Wait for a successful native rebuild and repair any lost sketch/body references.",
    );
  const targets =
    input.targetBodyIds ?? (input.targetBodyId ? [input.targetBodyId] : []);
  if (
    !targets.length ||
    targets.length > MODEL_RESOURCE_LIMITS.maxBodies ||
    new Set(targets).size !== targets.length ||
    targets.some((id) => !context.bodies.some((b) => b.id === id))
  )
    return fail(
      `Choose unique explicit current target body IDs (at most ${MODEL_RESOURCE_LIMITS.maxBodies}).`,
    );
  if (!input.centerPointIds.length)
    return fail("Choose at least one center point.");
  if (input.centerPointIds.length > MODEL_RESOURCE_LIMITS.maxHoleCenters)
    return fail(
      `Choose at most ${MODEL_RESOURCE_LIMITS.maxHoleCenters} center points.`,
    );
  if (
    new Set(input.centerPointIds).size !== input.centerPointIds.length ||
    input.centerPointIds.some((id) => !context.points.some((p) => p.id === id))
  )
    return fail(
      "Center references were lost or repeated. Reselect unique sketch points.",
    );
  const parameters = evaluateParameters(context.document.parameters).values;
  const authoredUnit = context.document.unitSettings.length;
  for (const [label, expression] of input.throughAll
    ? [["diameter", input.diameter]]
    : [
        ["diameter", input.diameter],
        ["depth", input.depth],
      ]) {
    const evaluated = evaluateExpressionRef(
      { expression, authoredUnit },
      { parameters },
    );
    if (
      evaluated.error ||
      !evaluated.quantity ||
      evaluated.quantity.dimension !== "length" ||
      !Number.isFinite(evaluated.quantity.value) ||
      evaluated.quantity.value <= 0
    )
      return fail(
        `Hole ${label} must be a positive length.${evaluated.error ? ` ${evaluated.error}` : ""}`,
      );
  }
  const feature = {
    id: draft.featureId,
    name: input.name.trim() || "Hole",
    type: "hole" as const,
    sketchId: context.sketch.id,
    targetBodyIds: [...targets],
    centerPointIds: input.centerPointIds,
    diameter: { expression: input.diameter, authoredUnit, unit: "mm" },
    depth: input.throughAll
      ? ("throughAll" as const)
      : { expression: input.depth, authoredUnit, unit: "mm" },
  };
  return {
    ok: true,
    feature,
    document: upsertFeature(draft.document, feature),
  };
}
export function assertNativeHolePreview(
  result: RebuildResult,
  documentId: string,
  feature: HoleFeature,
) {
  if (result.documentId !== documentId || !result.success)
    throw new Error(
      result.errors.map((error) => error.message).join(" ") ||
        "Hole preview failed or belongs to another project.",
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
    throw new Error("Hole preview requires valid native solid geometry.");
  // The native rebuild rejects no-op centers/targets before publishing a
  // successful result; this guard additionally refuses fallback or wrong outputs.
  const targets =
    feature.targetBodyIds ??
    (feature.targetBodyId ? [feature.targetBodyId] : []);
  if (
    !targets.length ||
    targets.some(
      (id) =>
        !result.meshes.some(
          (mesh) => mesh.bodyId === id && mesh.kernelOperation === "cut",
        ),
    )
  )
    throw new Error("Hole preview did not drill every selected target body.");
}
export function createHole(
  input: HoleInput,
  preview?: { feature: HoleFeature; result: RebuildResult },
): { ok: true } | { ok: false; reason: string } {
  const staged = stageHole(input);
  if (!staged.ok) return staged;
  if (
    !preview ||
    JSON.stringify(preview.feature) !== JSON.stringify(staged.feature)
  )
    return {
      ok: false,
      reason: "Wait for the current native hole preview before applying.",
    };
  try {
    assertNativeHolePreview(preview.result, staged.document.id, staged.feature);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const state = useCadStore.getState(),
    feature = staged.feature;
  state.updateDocument((d) => upsertFeature(d, feature));
  if (
    !useCadStore
      .getState()
      .history.present.features.some((f) => f.id === feature.id)
  )
    return {
      ok: false,
      reason:
        useCadStore.getState().fileError ??
        "Hole feature could not be created.",
    };
  state.select({
    kind: "feature",
    id: feature.id,
    documentId: staged.document.id,
  });
  useHoleDraft.setState({ draft: undefined });
  return { ok: true };
}
