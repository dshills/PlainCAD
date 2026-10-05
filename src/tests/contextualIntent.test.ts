import { expect, it } from "vitest";
import { assertAiIntentPlan, resolveAiIntent } from "../ai/contextualIntent";
import { aiEditContext } from "../ai/editPlan";
import { buildAiPlan } from "../ai/buildPlan";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { aiPlatePlan } from "./fixtures/aiPlan";
import type { AiEditContext } from "../ai/plan";
const context: AiEditContext = {
  componentName: "Plate",
  feature: { type: "extrude", name: "Extrusion" },
  parameters: [
    {
      id: "f:distance",
      name: "distance",
      expression: "5mm",
      value: 5,
      unit: "mm",
    },
  ],
};
it("resolves a selected extrusion thickness and makes an absolute numeric change locally", () => {
  const intent = resolveAiIntent(
    "feature",
    "Make this thicker to 8 mm",
    context,
  );
  expect(intent.target).toBe("distance");
  expect(intent.context?.parameters.map((p) => p.name)).toEqual(["distance"]);
  expect(intent.localPlan?.parameters).toEqual([
    { name: "distance", value: 8, unit: "mm" },
  ]);
  expect(intent.prompt).toContain("Edit only distance of Extrusion");
  expect(() =>
    assertAiIntentPlan(intent, {
      ...intent.localPlan!,
      parameters: [{ name: "angle", value: 90, unit: "deg" }],
    }),
  ).toThrow("only distance");
});
it("requires scope and clarification before guessing which existing dimension to change", () => {
  expect(
    resolveAiIntent("create", "Make this thicker").clarification,
  ).toContain("choose This part");
  const ambiguous = {
    ...context,
    feature: undefined,
    parameters: [
      {
        id: "a",
        name: "width",
        expression: "20mm",
        value: 20,
        unit: "mm" as const,
      },
      {
        id: "b",
        name: "depth",
        expression: "5mm",
        value: 5,
        unit: "mm" as const,
      },
    ],
  };
  expect(
    resolveAiIntent("edit", "Make this thicker to 8mm", ambiguous).choices,
  ).toEqual(ambiguous.parameters);
  expect(
    resolveAiIntent("edit", "Make this thicker to 8mm", ambiguous, "depth")
      .localPlan?.parameters[0].name,
  ).toBe("depth");
  expect(
    resolveAiIntent("edit", "Make this thicker", ambiguous, "removed")
      .clarification,
  ).toBeTruthy();
});
it("excludes locked component parameters and never falls back to another dimension", () => {
  const staged = buildAiPlan(createEmptyDocument(), aiPlatePlan);
  const thickness = Object.values(staged.document.parameters).find((p) =>
    /thickness/.test(p.name),
  )!;
  const doc = {
    ...staged.document,
    parameters: {
      ...staged.document.parameters,
      [thickness.name]: { ...thickness, locked: true },
    },
  };
  const allowed = aiEditContext(doc, staged.componentId);
  expect(allowed.parameters.some((p) => p.name === thickness.name)).toBe(false);
  expect(
    resolveAiIntent("edit", "Make this thicker", allowed).clarification,
  ).toBeTruthy();
});
it("does not treat relative or compound requests as an absolute assignment", () => {
  expect(
    resolveAiIntent("feature", "Make this thicker by 2mm", context).localPlan,
  ).toBeUndefined();
  expect(
    resolveAiIntent("feature", "Make this thicker to 8mm or 10mm", context)
      .localPlan,
  ).toBeUndefined();
  expect(
    resolveAiIntent("feature", "Make this thicker to 8deg", context).localPlan,
  ).toBeUndefined();
  expect(
    resolveAiIntent(
      "feature",
      "Make this thicker to 8mm and adjust width",
      context,
    ).localPlan,
  ).toBeUndefined();
  expect(
    resolveAiIntent("feature", "Make this thicker", {
      ...context,
      feature: { type: "revolve", name: "Turn" },
    }).clarification,
  ).toBeTruthy();
});
it("accepts an explicitly named dimension and preserves general provider edits", () => {
  expect(
    resolveAiIntent("feature", "Set distance to 7mm", context).localPlan
      ?.parameters[0].value,
  ).toBe(7);
  expect(
    resolveAiIntent(
      "feature",
      "Change dimensions based on the drawing",
      context,
    ),
  ).toEqual({ prompt: "Change dimensions based on the drawing", context });
});

it("allows creation prompts that describe a new part with pronouns and handles oversized local values as clarification", () => {
  expect(
    resolveAiIntent("create", "Make a bracket; it should be wider at the base")
      .clarification,
  ).toBeUndefined();
  expect(
    resolveAiIntent("create", "Can you make this thicker").clarification,
  ).toBeTruthy();
  expect(
    resolveAiIntent(
      "feature",
      "Set distance to 99999999999999999999999mm",
      context,
    ).clarification,
  ).toBeTruthy();
});

it("resolves friendly AI parameter names and retains explicit multi-dimension requests", () => {
  const part: AiEditContext = {
    componentName: "Plate",
    parameters: [
      {
        id: "w",
        name: "ai_1_width",
        expression: "20mm",
        value: 20,
        unit: "mm",
      },
      {
        id: "t",
        name: "ai_1_thickness",
        expression: "5mm",
        value: 5,
        unit: "mm",
      },
    ],
  };
  expect(
    resolveAiIntent("edit", "Set width to 30mm", part).localPlan?.parameters[0]
      .name,
  ).toBe("ai_1_width");
  expect(
    resolveAiIntent("edit", "Set width to 30mm and thickness to 8mm", part),
  ).toEqual({
    prompt: "Set width to 30mm and thickness to 8mm",
    context: part,
  });
  const ambiguous = {
    ...part,
    parameters: [
      ...part.parameters,
      {
        id: "w2",
        name: "ai_2_width",
        expression: "10mm",
        value: 10,
        unit: "mm" as const,
      },
    ],
  };
  expect(
    resolveAiIntent("edit", "Make this width larger", ambiguous).clarification,
  ).toBeTruthy();
});

it("clarifies incompatible numeric units before any provider request", () => {
  expect(
    resolveAiIntent("feature", "Set distance to 8deg", context).clarification,
  ).toBe("Use mm for distance.");
});

it("clarifies contradictory directional requests while accepting explicit absolute assignments", () => {
  for (const prompt of [
    "make this thicker to 3mm",
    "make this thinner to 8mm",
    "increase distance to 3mm",
    "decrease distance to 8mm",
  ]) {
    const intent = resolveAiIntent("feature", prompt, context);
    expect(intent.target).toBe("distance");
    expect(intent.localPlan).toBeUndefined();
    expect(intent.clarification).toContain("opposite direction");
  }
  expect(
    resolveAiIntent("feature", "set distance to 3mm", context).localPlan
      ?.parameters,
  ).toEqual([{ name: "distance", value: 3, unit: "mm" }]);
});

it("uses the leading directive rather than negated or explanatory direction words", () => {
  for (const prompt of [
    "make this thinner, not larger, to 3mm",
    "set distance because it is smaller than before to 8mm",
    "make this thicker to 8mm",
  ]) {
    expect(resolveAiIntent("feature", prompt, context).localPlan).toBeDefined();
  }
  expect(
    resolveAiIntent(
      "feature",
      "make this thicker, not thinner, to 3mm",
      context,
    ).clarification,
  ).toContain("opposite direction");
  expect(
    resolveAiIntent("feature", "make this thicker to 3mm", context, "distance")
      .localPlan,
  ).toBeDefined();
});
