import { create } from "zustand";
import type { CadStore } from "../../state/useCadStore";
import { useCadStore } from "../../state/useCadStore";
import { createId } from "../../cad/document/ids";
import { upsertFeature } from "../../cad/document/CadDocument";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import {
  evaluateExpression,
  evaluateParameters,
} from "../../cad/parameters/expressionEvaluator";

export const useHoleDraft = create<{
  draft?: { documentId: string; sketchId: string; centerPointIds: string[] };
}>(() => ({}));
export type HoleDraft = NonNullable<
  ReturnType<typeof useHoleDraft.getState>["draft"]
>;
export const DEFAULT_HOLE_DEPTH = "5mm";

export function holeCreationContext(state: CadStore, sketchId?: string) {
  const document = state.history.present,
    { rebuild } = state;
  if (
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
  if (!sketch) return undefined;
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
      documentId: context.document.id,
      sketchId: context.sketch.id,
      centerPointIds: centers,
    },
  });
}

export function createHole(input: {
  name: string;
  targetBodyId: string;
  centerPointIds: string[];
  diameter: string;
  depth: string;
  throughAll: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const state = useCadStore.getState(),
    draft = useHoleDraft.getState().draft;
  const fail = (reason: string): { ok: false; reason: string } => ({
    ok: false,
    reason,
  });
  if (!draft || draft.documentId !== state.history.present.id)
    return fail(
      "Project changed. Close this dialog and choose the source sketch again.",
    );
  const context = holeCreationContext(state, draft.sketchId);
  if (!context)
    return fail(
      "Wait for a successful native rebuild and repair any lost sketch/body references.",
    );
  if (!context.bodies.some((b) => b.id === input.targetBodyId))
    return fail("Choose an explicit current target body.");
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
  for (const [label, expression] of input.throughAll
    ? [["diameter", input.diameter]]
    : [
        ["diameter", input.diameter],
        ["depth", input.depth],
      ]) {
    const evaluated = evaluateExpression(expression, { parameters });
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
    id: createId("feature"),
    name: input.name.trim() || "Hole",
    type: "hole" as const,
    sketchId: context.sketch.id,
    targetBodyId: input.targetBodyId,
    centerPointIds: input.centerPointIds,
    diameter: { expression: input.diameter, unit: "mm" },
    depth: input.throughAll
      ? ("throughAll" as const)
      : { expression: input.depth, unit: "mm" },
  };
  state.updateDocument((d) => upsertFeature(d, feature));
  if (
    !useCadStore
      .getState()
      .history.present.features.some((f) => f.id === feature.id)
  )
    return fail(
      useCadStore.getState().fileError ?? "Hole feature could not be created.",
    );
  state.select({
    kind: "feature",
    id: feature.id,
    documentId: context.document.id,
  });
  useHoleDraft.setState({ draft: undefined });
  return { ok: true };
}
