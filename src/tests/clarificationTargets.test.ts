import { expect, it } from "vitest";
import { buildAiPlan } from "../ai/buildPlan";
import { aiClarificationTargets } from "../ai/clarificationTargets";
import { aiEditContext } from "../ai/editPlan";
import { aiFeatureEditContext } from "../ai/featureEditPlan";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { aiPlatePlan } from "./fixtures/aiPlan";
import { separatePartsPlan } from "./fixtures/aiTargetsPlan";

it("maps separate bounded dimensions to their own current solids and authoring sketches", () => {
  const { document, componentId } = buildAiPlan(
    createEmptyDocument(),
    separatePartsPlan,
  );
  const result = rebuildDocument(document),
    context = aiEditContext(document, componentId);
  const targets = aiClarificationTargets(
    document,
    componentId,
    "edit",
    context.parameters,
    result,
  );
  expect(targets.map((t) => t.label)).toEqual(["width", "depth"]);
  expect(targets.map((t) => t.bodyIds)).toEqual(
    result.meshes.map((m) => [m.bodyId]),
  );
  expect(targets.map((t) => t.bodyNames)).toEqual([
    ["Left solid"],
    ["Right solid"],
  ]);
  expect(targets.map((t) => t.sketchId)).toEqual(
    document.features
      .filter((f) => f.type === "extrude")
      .map((f) => f.sketchId),
  );
  expect(targets[0].sketchEntityIds).toEqual(
    Object.keys(document.sketches[targets[0].sketchId!].entities),
  );
  expect(
    aiClarificationTargets(
      document,
      componentId,
      "edit",
      context.parameters,
      undefined,
    ).every((t) => !t.bodyIds.length),
  ).toBe(true);
  expect(
    aiClarificationTargets(document, componentId, "edit", context.parameters, {
      ...result,
      documentId: "different",
    }).every((t) => !t.bodyIds.length),
  ).toBe(true);
});
it("traces through a cut to the surviving body and filters forged, locked and mismatched choices", () => {
  const { document, componentId } = buildAiPlan(
    createEmptyDocument(),
    aiPlatePlan,
  );
  const context = aiEditContext(document, componentId),
    result = rebuildDocument(document);
  const thickness = context.parameters.find((p) =>
    p.name.endsWith("thickness"),
  )!;
  const targets = aiClarificationTargets(
    document,
    componentId,
    "edit",
    context.parameters,
    result,
  );
  expect(
    targets.every(
      (t) => t.bodyIds.length === 1 && t.bodyIds[0] === result.meshes[0].bodyId,
    ),
  ).toBe(true);
  expect(
    aiClarificationTargets(
      document,
      componentId,
      "edit",
      [
        { ...thickness, id: "forged" },
        { ...thickness, name: "other" },
      ],
      result,
    ),
  ).toEqual([]);
  const locked = {
    ...document,
    parameters: {
      ...document.parameters,
      [thickness.name]: {
        ...document.parameters[thickness.name],
        locked: true,
      },
    },
  };
  expect(
    aiClarificationTargets(locked, componentId, "edit", [thickness], result),
  ).toEqual([]);
  const feature = document.features[0],
    selected = aiFeatureEditContext(document, componentId, feature.id);
  expect(
    aiClarificationTargets(
      document,
      componentId,
      "feature",
      selected.parameters,
      result,
      feature.id,
    )[0].bodyIds,
  ).toEqual([result.meshes[0].bodyId]);
  expect(
    aiClarificationTargets(
      document,
      componentId,
      "feature",
      [thickness],
      result,
      feature.id,
    ),
  ).toEqual([]);
  expect(
    aiClarificationTargets(
      document,
      componentId,
      "create",
      context.parameters,
      result,
    ),
  ).toEqual([]);
});
