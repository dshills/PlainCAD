import { expect, it } from "vitest";
import { buildAiPlan } from "../ai/buildPlan";
import { validateAiPlan } from "../ai/plan";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import {
  aiFaceBossPlan,
  aiSideBossPlan,
  aiToFacePillarPlan,
} from "./fixtures/aiFacePlans";

it("binds recipe-owned cap/straight-side planes and to-face terminations to stable feature IDs and preserves them across persistence", () => {
  for (const recipe of [aiFaceBossPlan, aiSideBossPlan, aiToFacePillarPlan]) {
    const document = buildAiPlan(createEmptyDocument(), recipe).document,
      owner = document.features[0],
      sketch = Object.values(document.sketches)[1];
    if (recipe !== aiToFacePillarPlan) {
      expect(sketch.plane).toMatchObject({
        type: "offset",
        base: { type: "face", featureId: owner.id },
      });
      if (
        sketch.plane.type !== "offset" ||
        typeof sketch.plane.base === "string"
      )
        throw new Error("Expected face base");
      const line = Object.values(
        Object.values(document.sketches)[0].entities,
      ).find((e) => e.type === "line")!;
      const expected =
        recipe === aiFaceBossPlan
          ? `extrude:${owner.id}:endCap`
          : `extrude:${owner.id}:side:${line.id}`;
      expect(sketch.plane.base.stableFaceId).toBe(expected);
    } else
      expect(document.features[1]).toMatchObject({
        termination: {
          type: "toFace",
          faceRef: {
            featureId: owner.id,
            kind: "face",
            stableHint: `extrude:${owner.id}:startCap`,
          },
        },
      });
    const restored = importProjectText(serializeProject(document));
    expect(restored.sketches[sketch.id].plane).toEqual(sketch.plane);
    expect(restored.features[1]).toMatchObject(
      JSON.parse(JSON.stringify(document.features[1])),
    );
  }
});
it("diagnoses forward, modifier, modified and curved-side owners and unsupported to-face directions/fields before preview", () => {
  const face = aiFaceBossPlan.steps[2];
  if (face.type !== "sketch") throw new Error("Expected face sketch");
  for (const plane of [
    { owner: "future", role: "endCap" },
    { owner: "boss", role: "endCap" },
    { owner: "base", role: "side", edge: 31 },
  ])
    expect(() =>
      buildAiPlan(createEmptyDocument(), {
        ...aiFaceBossPlan,
        steps: [
          ...aiFaceBossPlan.steps.slice(0, 2),
          { ...face, plane },
          aiFaceBossPlan.steps[3],
        ],
      }),
    ).toThrow(/earlier live|straight outer-boundary/);
  const modified = {
    ...aiFaceBossPlan,
    steps: [...aiFaceBossPlan.steps, { ...face, id: "laterFace" }],
  };
  expect(() => buildAiPlan(createEmptyDocument(), modified)).toThrow(
    /modified by an earlier operation/,
  );
  expect(() =>
    buildAiPlan(createEmptyDocument(), {
      ...aiFaceBossPlan,
      steps: [
        ...aiFaceBossPlan.steps,
        {
          ...face,
          id: "modifierFace",
          plane: { owner: "boss", role: "endCap" },
        },
      ],
    }),
  ).toThrow(/earlier live distance New Body/);
  const circular = {
    ...aiFaceBossPlan,
    steps: aiFaceBossPlan.steps.map((step, i) =>
      i === 0 && step.type === "sketch"
        ? {
            ...step,
            profile: { type: "circle", x: "0mm", y: "0mm", radius: "10mm" },
          }
        : i === 2 && step.type === "sketch"
          ? { ...step, plane: { owner: "base", role: "side", edge: 0 } }
          : step,
    ),
  };
  expect(() => buildAiPlan(createEmptyDocument(), circular)).toThrow(
    /curved and inner-loop sides/,
  );
  const pillar = aiToFacePillarPlan.steps[3];
  if (pillar.type !== "extrude") throw new Error("Expected extrusion");
  for (const patch of [
    { direction: "negative" },
    { direction: "symmetric" },
    { face: undefined },
    { termination: "distance" },
    { face: { owner: "ceiling", role: "side", edge: -1 } },
  ])
    expect(() =>
      validateAiPlan({
        ...aiToFacePillarPlan,
        steps: [
          ...aiToFacePillarPlan.steps.slice(0, 3),
          { ...pillar, ...patch },
        ],
      }),
    ).toThrow(/positive direction|unsupported|only valid|integer/);
});
