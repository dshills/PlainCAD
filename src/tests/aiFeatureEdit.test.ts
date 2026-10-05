import { expect, it } from "vitest";
import { buildAiPlan } from "../ai/buildPlan";
import {
  aiFeatureEditContext,
  buildAiFeatureEdit,
} from "../ai/featureEditPlan";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { aiHolePatternPlan, aiPolygonPlan } from "./fixtures/aiExpandedPlans";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { validateAiEditContext } from "../ai/plan";

it("changes only a selected dimension, retaining IDs, scope, other bindings and project parameters across persistence", () => {
  const staged = buildAiPlan(createEmptyDocument(), aiHolePatternPlan),
    base = staged.document;
  const feature = base.features.find((f) => f.type === "hole")!;
  const context = aiFeatureEditContext(base, staged.componentId, feature.id);
  expect(context.feature?.type).toBe("hole");
  expect(context.parameters.map((p) => p.name)).toEqual(["diameter"]);
  const plan = {
    name: "Hole",
    summary: "Larger holes",
    warnings: [],
    steps: [],
    parameters: [{ name: "diameter", value: 6, unit: "mm" }],
  };
  const edited = buildAiFeatureEdit(base, staged.componentId, feature.id, plan);
  expect(edited.document.parameters).toEqual(base.parameters);
  expect(edited.document.sketches).toEqual(base.sketches);
  expect(edited.editedFeature).toEqual({
    ...feature,
    diameter: { expression: "6mm", unit: "mm", parameterRefs: undefined },
  });
  const restored = importProjectText(serializeProject(edited.document));
  expect(restored.features.map((f) => f.id)).toEqual(
    edited.document.features.map((f) => f.id),
  );
  expect(restored.features.find((f) => f.id === feature.id)).toMatchObject({
    diameter: { expression: "6mm", unit: "mm" },
  });
  expect(restored.parameters).toMatchObject(edited.document.parameters);
  expect(serializeProject(importProjectText(serializeProject(restored)))).toBe(
    serializeProject(restored),
  );
  for (const parameters of [
    [{ name: "diameter", value: -1, unit: "mm" }],
    [{ name: "other", value: 6, unit: "mm" }],
    [{ name: "diameter", value: 6, unit: "deg" }],
    [],
  ])
    expect(() =>
      buildAiFeatureEdit(base, staged.componentId, feature.id, {
        ...plan,
        parameters,
      }),
    ).toThrow();
  expect(() =>
    buildAiFeatureEdit(base, staged.componentId, feature.id, {
      ...plan,
      steps: aiPolygonPlan.steps,
    }),
  ).toThrow(/dimension changes only/);
  expect(() =>
    aiFeatureEditContext(base, base.rootComponentId, feature.id),
  ).toThrow(/active component/);
  expect(() =>
    validateAiEditContext({
      ...context,
      feature: { type: "hole", name: "Drill", geometry: [] },
    }),
  ).toThrow();
});

it("converts Revolve angles, synchronizes explicit Extrude distances, and rejects unsupported fields and contexts", () => {
  const staged = buildAiPlan(createEmptyDocument(), {
    ...aiPolygonPlan,
    steps: [
      {
        type: "sketch",
        id: "outline",
        name: "Section",
        plane: "XY",
        offset: "0mm",
        profile: {
          type: "rectangle",
          x: "2.5mm",
          y: "5mm",
          width: "5mm",
          height: "10mm",
        },
      },
      {
        type: "revolve",
        id: "body",
        name: "Ring",
        sketch: "outline",
        axis: "Y",
        angle: "180deg",
        operation: "newBody",
        targets: [],
      },
    ],
  });
  const feature = staged.document.features[0];
  const base = {
    ...staged.document,
    features: [
      {
        ...feature,
        angle: { expression: "3.141592653589793rad", unit: "rad" },
      },
    ],
  } as typeof staged.document;
  expect(
    aiFeatureEditContext(base, staged.componentId, feature.id).parameters[0]
      .value,
  ).toBeCloseTo(180);
  const plan = {
    name: "Angle edit",
    summary: "Quarter ring",
    warnings: [],
    steps: [],
    parameters: [{ name: "angle", value: 90, unit: "deg" }],
  };
  expect(
    buildAiFeatureEdit(base, staged.componentId, feature.id, plan)
      .editedFeature,
  ).toMatchObject({ id: feature.id, angle: { expression: "90deg" } });
  expect(() =>
    buildAiFeatureEdit(base, staged.componentId, feature.id, {
      ...plan,
      parameters: [{ name: "angle", value: 361, unit: "deg" }],
    }),
  ).toThrow(/360deg/);
  for (const value of [null, 0, "", undefined])
    expect(() =>
      validateAiEditContext({
        ...aiFeatureEditContext(base, staged.componentId, feature.id),
        feature: value,
      }),
    ).toThrow();
  const plate = buildAiPlan(createEmptyDocument(), aiHolePatternPlan);
  const extrusion = plate.document.features.find((f) => f.type === "extrude")!;
  const explicit = {
    ...plate.document,
    features: plate.document.features.map((f) =>
      f.id === extrusion.id
        ? {
            ...extrusion,
            termination: {
              type: "distance",
              distance: { expression: "5mm", unit: "mm" },
            },
          }
        : f,
    ),
  } as typeof plate.document;
  expect(
    buildAiFeatureEdit(explicit, plate.componentId, extrusion.id, {
      ...plan,
      parameters: [{ name: "distance", value: 8, unit: "mm" }],
    }).editedFeature,
  ).toMatchObject({
    distance: { expression: "8mm" },
    termination: { type: "distance", distance: { expression: "8mm" } },
  });
  for (const patch of [
    { suppressed: true },
    { termination: { type: "throughAll" } },
  ])
    expect(() =>
      aiFeatureEditContext(
        {
          ...plate.document,
          features: plate.document.features.map((f) =>
            f.id === extrusion.id ? { ...f, ...patch } : f,
          ),
        } as typeof plate.document,
        plate.componentId,
        extrusion.id,
      ),
    ).toThrow();
  const hole = plate.document.features.find((f) => f.type === "hole")!;
  const blind = {
    ...plate.document,
    features: plate.document.features.map((f) =>
      f.id === hole.id ? { ...f, depth: { expression: "2mm", unit: "mm" } } : f,
    ),
  } as typeof plate.document;
  expect(
    aiFeatureEditContext(blind, plate.componentId, hole.id).parameters.map(
      (p) => p.name,
    ),
  ).toEqual(["diameter", "depth"]);
  expect(
    buildAiFeatureEdit(blind, plate.componentId, hole.id, {
      ...plan,
      parameters: [{ name: "depth", value: 3, unit: "mm" }],
    }).editedFeature,
  ).toMatchObject({ depth: { expression: "3mm" } });
});
