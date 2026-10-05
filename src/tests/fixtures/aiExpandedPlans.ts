import type { AiPlan } from "../../ai/plan";
import { aiPlatePlan } from "./aiPlan";

export const aiPolygonPlan: AiPlan = {
  name: "Triangular block",
  summary: "A triangular block",
  warnings: [],
  parameters: [
    { name: "width", value: 20, unit: "mm" },
    { name: "height", value: 10, unit: "mm" },
    { name: "thickness", value: 5, unit: "mm" },
  ],
  steps: [
    {
      type: "sketch",
      id: "outline",
      name: "Triangle",
      plane: "XZ",
      offset: "0mm",
      profile: {
        type: "polygon",
        vertices: [
          { x: "0mm", y: "0mm" },
          { x: "width", y: "0mm" },
          { x: "0mm", y: "height" },
        ],
      },
    },
    {
      type: "extrude",
      id: "body",
      name: "Triangle extrusion",
      sketch: "outline",
      operation: "newBody",
      targets: [],
      distance: "thickness",
      termination: "distance",
      direction: "positive",
    },
  ],
};
export const aiArcPlan: AiPlan = {
  name: "Semicircular block",
  summary: "A semicircular block",
  warnings: [],
  parameters: [
    { name: "radius", value: 5, unit: "mm" },
    { name: "thickness", value: 3, unit: "mm" },
  ],
  steps: [
    {
      type: "sketch",
      id: "outline",
      name: "Semicircle",
      plane: "XY",
      offset: "0mm",
      profile: {
        type: "wire",
        vertices: [
          { x: "-radius", y: "0mm" },
          { x: "radius", y: "0mm" },
        ],
        edges: [
          { type: "arc", center: { x: "0mm", y: "0mm" }, clockwise: false },
          { type: "line" },
        ],
      },
    },
    {
      type: "extrude",
      id: "body",
      name: "Arc extrusion",
      sketch: "outline",
      operation: "newBody",
      targets: [],
      distance: "thickness",
      termination: "distance",
      direction: "positive",
    },
  ],
};
export const aiHolePatternPlan: AiPlan = {
  ...aiPlatePlan,
  name: "Four-hole plate",
  summary: "A plate with four native holes",
  steps: [
    ...aiPlatePlan.steps.slice(0, 2),
    {
      type: "sketch",
      id: "centers",
      name: "Mounting centers",
      plane: "XY",
      offset: "0mm",
      profile: {
        type: "points",
        points: [
          { x: "-20mm", y: "-10mm" },
          { x: "20mm", y: "-10mm" },
          { x: "20mm", y: "10mm" },
          { x: "-20mm", y: "10mm" },
        ],
      },
    },
    {
      type: "hole",
      id: "pattern",
      name: "Mounting holes",
      sketch: "centers",
      targets: ["plate"],
      centers: [0, 1, 2, 3],
      diameter: "diameter",
      depth: "1mm",
      termination: "throughAll",
    },
  ],
};

export const aiDimensionedPolygonPlan: AiPlan = {
  ...aiPolygonPlan,
  name: "Dimensioned triangular block",
  steps: aiPolygonPlan.steps.map((step) =>
    step.type === "sketch"
      ? {
          ...step,
          intent: {
            constraints: [
              { type: "fixed", entities: [], points: [0] },
              { type: "horizontal", entities: [0], points: [] },
            ],
            dimensions: [
              { type: "length", entities: [0], points: [], value: "width" },
            ],
          },
        }
      : step,
  ),
};
