import type { AiPlan } from "../../ai/plan";
export const aiRingPlan: AiPlan = {
  name: "Hollow sleeve",
  summary: "A 20mm diameter sleeve with a 12mm bore and 8mm length",
  warnings: [],
  parameters: [
    { name: "outerRadius", value: 10, unit: "mm" },
    { name: "innerRadius", value: 6, unit: "mm" },
    { name: "length", value: 8, unit: "mm" },
  ],
  steps: [
    {
      type: "sketch",
      id: "section",
      name: "Annular section",
      plane: "YZ",
      offset: "-4mm",
      profile: {
        type: "compound",
        outer: { type: "circle", x: "0mm", y: "0mm", radius: "outerRadius" },
        holes: [{ type: "circle", x: "0mm", y: "0mm", radius: "innerRadius" }],
      },
    },
    {
      type: "extrude",
      id: "sleeve",
      name: "Sleeve",
      sketch: "section",
      operation: "newBody",
      targets: [],
      distance: "length",
      termination: "distance",
      direction: "positive",
    },
  ],
};
export const aiTubePlan: AiPlan = {
  name: "Rectangular spacer",
  summary: "A hollow 30 by 20mm section with a 20 by 10mm opening, 8mm long",
  warnings: [],
  parameters: [],
  steps: [
    {
      type: "sketch",
      id: "section",
      name: "Hollow section",
      plane: "XY",
      offset: "0mm",
      profile: {
        type: "compound",
        outer: {
          type: "rectangle",
          x: "0mm",
          y: "0mm",
          width: "30mm",
          height: "20mm",
        },
        holes: [
          {
            type: "rectangle",
            x: "0mm",
            y: "0mm",
            width: "20mm",
            height: "10mm",
          },
        ],
      },
    },
    {
      type: "extrude",
      id: "spacer",
      name: "Spacer",
      sketch: "section",
      operation: "newBody",
      targets: [],
      distance: "8mm",
      termination: "distance",
      direction: "positive",
    },
  ],
};
export const aiIslandPocketPlan: AiPlan = {
  name: "Island pocket",
  summary:
    "A 20 by 20 by 8mm block with a 14mm square pocket 3mm deep around a 6mm diameter island",
  warnings: [],
  parameters: [],
  steps: [
    {
      type: "sketch",
      id: "outline",
      name: "Block outline",
      plane: "XY",
      offset: "0mm",
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
      id: "block",
      name: "Block",
      sketch: "outline",
      operation: "newBody",
      targets: [],
      distance: "8mm",
      termination: "distance",
      direction: "positive",
    },
    {
      type: "sketch",
      id: "pocket",
      name: "Pocket and island",
      plane: "XY",
      offset: "8mm",
      profile: {
        type: "compound",
        outer: {
          type: "rectangle",
          x: "0mm",
          y: "0mm",
          width: "14mm",
          height: "14mm",
        },
        holes: [{ type: "circle", x: "0mm", y: "0mm", radius: "3mm" }],
      },
    },
    {
      type: "extrude",
      id: "cut",
      name: "Pocket cut",
      sketch: "pocket",
      operation: "cut",
      targets: ["block"],
      distance: "3mm",
      termination: "distance",
      direction: "negative",
    },
  ],
};
