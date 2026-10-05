import type { AiPlan } from "../../ai/plan";
export const aiFaceBossPlan: AiPlan = {
  name: "Face-mounted boss",
  summary:
    "A 20 by 10 by 4mm block with a 4mm diameter, 3mm high boss joined on its top face",
  warnings: [],
  parameters: [{ name: "baseThickness", value: 4, unit: "mm" }],
  steps: [
    {
      type: "sketch",
      id: "outline",
      name: "Base outline",
      plane: "XY",
      offset: "0mm",
      profile: {
        type: "rectangle",
        x: "0mm",
        y: "0mm",
        width: "20mm",
        height: "10mm",
      },
    },
    {
      type: "extrude",
      id: "base",
      name: "Base",
      sketch: "outline",
      operation: "newBody",
      targets: [],
      distance: "baseThickness",
      termination: "distance",
      direction: "positive",
    },
    {
      type: "sketch",
      id: "bossSection",
      name: "Boss section",
      plane: { owner: "base", role: "endCap" },
      offset: "0mm",
      profile: { type: "circle", x: "0mm", y: "0mm", radius: "2mm" },
    },
    {
      type: "extrude",
      id: "boss",
      name: "Boss join",
      sketch: "bossSection",
      operation: "join",
      targets: ["base"],
      distance: "3mm",
      termination: "distance",
      direction: "positive",
    },
  ],
};
export const aiSideBossPlan: AiPlan = {
  ...aiFaceBossPlan,
  name: "Side-mounted tab",
  summary:
    "A 20 by 10 by 4mm block with a centered 4 by 2mm tab projecting 3mm from its front straight side",
  steps: aiFaceBossPlan.steps.map((step) =>
    step.type === "sketch" && step.id === "bossSection"
      ? {
          ...step,
          plane: { owner: "base", role: "side", edge: 0 },
          profile: {
            type: "rectangle",
            x: "10mm",
            y: "baseThickness / 2",
            width: "4mm",
            height: "2mm",
          },
        }
      : step,
  ),
};
export const aiToFacePillarPlan: AiPlan = {
  name: "To-face pillar",
  summary:
    "A 4mm square pillar from Z=0 to the bottom face of a 20mm square, 2mm thick ceiling at Z=12mm, as two bodies",
  warnings: [],
  parameters: [{ name: "targetHeight", value: 12, unit: "mm" }],
  steps: [
    {
      type: "sketch",
      id: "ceilingSection",
      name: "Ceiling outline",
      plane: "XY",
      offset: "targetHeight",
      profile: {
        type: "rectangle",
        x: "0mm",
        y: "0mm",
        width: "20mm",
        height: "20mm",
      },
    },
    {
      type: "extrude",
      id: "ceiling",
      name: "Ceiling",
      sketch: "ceilingSection",
      operation: "newBody",
      targets: [],
      distance: "2mm",
      termination: "distance",
      direction: "positive",
    },
    {
      type: "sketch",
      id: "pillarSection",
      name: "Pillar section",
      plane: "XY",
      offset: "0mm",
      profile: {
        type: "rectangle",
        x: "0mm",
        y: "0mm",
        width: "4mm",
        height: "4mm",
      },
    },
    {
      type: "extrude",
      id: "pillar",
      name: "Pillar",
      sketch: "pillarSection",
      operation: "newBody",
      targets: [],
      distance: "1mm",
      termination: "toFace",
      face: { owner: "ceiling", role: "startCap" },
      direction: "positive",
    },
  ],
};
