import { expect, it } from "vitest";
import { buildAiPlan } from "../ai/buildPlan";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { aiPlatePlan } from "./fixtures/aiPlan";
import { aiPolygonPlan } from "./fixtures/aiExpandedPlans";
import { validateAiPlan } from "../ai/plan";

it("creates editable driving rectangle/circle dimensions with centered geometry, stable profile IDs and durable intent", () => {
  const base = buildAiPlan(createEmptyDocument(), aiPlatePlan).document;
  const [rectangle, circle] = Object.values(base.sketches);
  const values = evaluateParameters(base.parameters).values;
  const solved = solveSketch(rectangle, values),
    originalProfile = detectProfiles(solved).profiles[0];
  expect(solved.errors).toEqual([]);
  expect(solved.degreesOfFreedom).toBe(0);
  expect(rectangle.dimensions.map((d) => d.type)).toEqual(["length", "length"]);
  const edited = {
    ...rectangle,
    dimensions: rectangle.dimensions.map((d, i) =>
      i === 0 ? { ...d, expression: { expression: "70mm", unit: "mm" } } : d,
    ),
  };
  const changed = solveSketch(edited, values),
    profile = detectProfiles(changed).profiles[0];
  expect(changed.errors).toEqual([]);
  expect(profile.id).toBe(originalProfile.id);
  expect(profile.bounds.minX).toBeCloseTo(-35, 6);
  expect(profile.bounds.maxX).toBeCloseTo(35, 6);
  expect(profile.bounds.minY).toBeCloseTo(-20, 6);
  expect(profile.bounds.maxY).toBeCloseTo(20, 6);
  expect(solveSketch(circle, values).degreesOfFreedom).toBe(0);
  const largerCircle = {
    ...circle,
    dimensions: circle.dimensions.map((d) => ({
      ...d,
      expression: { expression: "3mm", unit: "mm" },
    })),
  };
  expect(solveSketch(largerCircle, values).circles[0].radius).toBeCloseTo(3, 6);
  const restored = importProjectText(
    serializeProject(upsertSketch(base, edited)),
  );
  expect(restored.sketches[edited.id].dimensions.map((d) => d.id)).toEqual(
    edited.dimensions.map((d) => d.id),
  );
  expect(
    detectProfiles(
      solveSketch(
        restored.sketches[edited.id],
        evaluateParameters(restored.parameters).values,
      ),
    ).profiles[0].bounds.maxX,
  ).toBeCloseTo(35, 6);
});
it("maps bounded AI design intent to authored entities and rejects lost, redundant, conflicting or malformed references", () => {
  const first = aiPolygonPlan.steps[0];
  if (first.type !== "sketch") throw new Error("Fixture requires sketch");
  const recipe = {
    ...aiPolygonPlan,
    steps: [
      {
        ...first,
        intent: {
          constraints: [
            { type: "fixed", entities: [], points: [0] },
            { type: "horizontal", entities: [0], points: [] },
          ],
          dimensions: [
            { type: "length", entities: [0], points: [], value: "20mm" },
          ],
        },
      },
      ...aiPolygonPlan.steps.slice(1),
    ],
  };
  const authored = recipe.steps[0];
  if (authored.type !== "sketch") throw new Error("Fixture requires sketch");
  const staged = buildAiPlan(createEmptyDocument(), recipe),
    sketch = Object.values(staged.document.sketches)[0];
  expect(
    solveSketch(sketch, evaluateParameters(staged.document.parameters).values)
      .errors,
  ).toEqual([]);
  expect(sketch.dimensions[0].entityIds).toEqual([
    Object.values(sketch.entities).filter((e) => e.type === "line")[0].id,
  ]);
  for (const intent of [
    {
      ...authored.intent,
      dimensions: [
        { type: "length", entities: [100], points: [], value: "20mm" },
      ],
    },
    {
      ...authored.intent,
      constraints: [
        { type: "fixed", entities: [], points: [0] },
        { type: "fixed", entities: [], points: [0] },
      ],
    },
    {
      ...authored.intent,
      dimensions: [
        { type: "length", entities: [0], points: [], value: "20mm" },
        { type: "length", entities: [0], points: [], value: "21mm" },
      ],
    },
  ])
    expect(() =>
      buildAiPlan(createEmptyDocument(), {
        ...recipe,
        steps: [{ ...first, intent }, ...recipe.steps.slice(1)],
      }),
    ).toThrow(/index|redundant|Cannot satisfy|conflict/i);
  for (const index of [-1, 0.5, 128])
    expect(() =>
      validateAiPlan({
        ...recipe,
        steps: [
          {
            ...first,
            intent: {
              constraints: [],
              dimensions: [
                {
                  type: "length",
                  entities: [index],
                  points: [],
                  value: "20mm",
                },
              ],
            },
          },
          ...recipe.steps.slice(1),
        ],
      }),
    ).toThrow(/indices/);
});

it("accepts zero unsigned distances and diagnoses negative distances before native preview", () => {
  const first = aiPolygonPlan.steps[0];
  if (first.type !== "sketch") throw new Error("Fixture requires sketch");
  const recipe = (value: string) => ({
    ...aiPolygonPlan,
    steps: [
      {
        ...first,
        intent: {
          constraints: [],
          dimensions: [
            { type: "verticalDistance", entities: [], points: [0, 1], value },
          ],
        },
      },
      ...aiPolygonPlan.steps.slice(1),
    ],
  });
  expect(() => buildAiPlan(createEmptyDocument(), recipe("0mm"))).not.toThrow();
  expect(() => buildAiPlan(createEmptyDocument(), recipe("-1mm"))).toThrow(
    /nonnegative length/,
  );
});
