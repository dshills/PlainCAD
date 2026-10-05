import { expect, it, vi } from "vitest";
import { buildAiPlan } from "../ai/buildPlan";
import { validateAiPlan } from "../ai/plan";
import {
  createEmptyDocument,
  upsertParameter,
} from "../cad/document/CadDocument";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import {
  aiRingPlan,
  aiTubePlan,
  aiIslandPocketPlan,
} from "./fixtures/aiCompoundPlans";

it("compiles one material region with durable inner loops and driving dimensions, preserving profiles through parameter edits and save/open", () => {
  for (const recipe of [aiRingPlan, aiTubePlan, aiIslandPocketPlan]) {
    const document = buildAiPlan(createEmptyDocument(), recipe).document,
      values = evaluateParameters(document.parameters).values;
    const sketch = Object.values(document.sketches).at(-1)!;
    const solved = solveSketch(sketch, values),
      profiles = detectProfiles(solved);
    expect(solved.errors).toEqual([]);
    expect(profiles.profiles).toHaveLength(1);
    expect(profiles.profiles[0].innerLoops).toHaveLength(1);
    const restored = importProjectText(serializeProject(document));
    expect(
      detectProfiles(
        solveSketch(
          restored.sketches[sketch.id],
          evaluateParameters(restored.parameters).values,
        ),
      ).profiles[0].id,
    ).toBe(profiles.profiles[0].id);
  }
  const document = buildAiPlan(createEmptyDocument(), aiRingPlan).document,
    sketch = Object.values(document.sketches)[0],
    before = detectProfiles(
      solveSketch(sketch, evaluateParameters(document.parameters).values),
    );
  const parameter = document.parameters.ai_1_innerRadius,
    changed = upsertParameter(document, { ...parameter, expression: "7mm" });
  const after = detectProfiles(
    solveSketch(
      changed.sketches[sketch.id],
      evaluateParameters(changed.parameters).values,
    ),
  );
  expect(after.errors).toEqual([]);
  expect(after.profiles[0].id).toBe(before.profiles[0].id);
  expect(after.profiles[0].holes[0].radius).toBeCloseTo(7, 6);
});
it("rejects disconnected, touching, overlapping and nested-island openings, points boundaries, recursive compounds and excessive resources", () => {
  const first = aiRingPlan.steps[0];
  if (first.type !== "sketch" || first.profile.type !== "compound")
    throw new Error("Expected ring fixture");
  const ring = first.profile,
    circle = ring.holes[0];
  if (circle.type !== "circle") throw new Error("Expected circle fixture");
  const recipe = (profile: unknown) => ({
    ...aiRingPlan,
    steps: [{ ...first, profile }, ...aiRingPlan.steps.slice(1)],
  });
  for (const [holes, expected] of [
    [
      [{ ...circle, x: "30mm" }],
      /Compound openings must be separate and strictly inside/,
    ],
    [[{ ...circle, x: "4mm" }], /touch tangentially or ambiguously/],
    [
      [circle, { ...circle, x: "1mm" }],
      /Compound openings must be separate and strictly inside/,
    ],
    [
      [circle, { ...circle, radius: "3mm" }],
      /Compound openings must be separate and strictly inside/,
    ],
  ] as const)
    expect(() =>
      buildAiPlan(createEmptyDocument(), recipe({ ...ring, holes })),
    ).toThrow(expected);
  const polygon = (radius: number, x: number) => ({
    type: "polygon",
    vertices: Array.from({ length: 32 }, (_, i) => ({
      x: `${x + radius * Math.cos((i * 2 * Math.PI) / 32)}mm`,
      y: `${radius * Math.sin((i * 2 * Math.PI) / 32)}mm`,
    })),
  });
  for (const [profile, expected] of [
    [
      {
        ...ring,
        holes: [{ type: "points", points: [{ x: "0mm", y: "0mm" }] }],
      },
      /closed loops/,
    ],
    [{ ...ring, holes: [ring] }, /profile is unsupported/],
    [{ ...ring, holes: Array.from({ length: 9 }, () => circle) }, /limit of 8/],
    [{ ...ring, holes: [] }, /at least one inner opening/],
    [
      {
        ...ring,
        outer: polygon(10, 0),
        holes: [polygon(2, -4), polygon(2, 4)],
      },
      /sketch point budget/,
    ],
  ] as const)
    expect(() => validateAiPlan(recipe(profile))).toThrow(expected);
  expect(() =>
    buildAiPlan(createEmptyDocument(), {
      ...aiRingPlan,
      steps: [
        { ...first, intent: { constraints: [], dimensions: [] } },
        ...aiRingPlan.steps.slice(1),
      ],
    }),
  ).toThrow(/explicit indexed intent/);
});

it("rejects generated identity collisions rather than overwriting earlier compound loops", () => {
  const uuid = vi
    .spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValue("12345678-1234-4321-8123-123456789abc");
  try {
    expect(() => buildAiPlan(createEmptyDocument(), aiRingPlan)).toThrow(
      /duplicate identities/,
    );
  } finally {
    uuid.mockRestore();
  }
});
