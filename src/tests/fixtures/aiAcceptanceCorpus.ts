import type { AiPlan } from "../../ai/plan";
import {
  aiHolePatternPlan,
  aiDimensionedPolygonPlan,
  aiArcPlan,
} from "./aiExpandedPlans";
import { aiRingPlan, aiTubePlan, aiIslandPocketPlan } from "./aiCompoundPlans";
import {
  aiFaceBossPlan,
  aiSideBossPlan,
  aiToFacePillarPlan,
} from "./aiFacePlans";
export interface AiAcceptanceCase {
  id: string;
  prompt: string;
  plan: AiPlan;
  volume: number;
  bodies: number;
  span: { axis: 0 | 1 | 2; min: number; max: number };
}
/** Mechanical prompts and independent analytic oracles shared by offline and opt-in live checks. */
export const aiAcceptanceCorpus: AiAcceptanceCase[] = [
  {
    id: "mounting-plate",
    prompt:
      "Make a centered 60 by 40 by 5mm plate on XY with four 4mm diameter through holes centered at x=±20mm, y=±10mm. Keep thickness editable. No other features.",
    plan: aiHolePatternPlan,
    volume: 12000 - 80 * Math.PI,
    bodies: 1,
    span: { axis: 2, min: 0, max: 5 },
  },
  {
    id: "dimensioned-triangle",
    prompt:
      "Make a right triangular prism on XZ with local vertices (0,0), (20,0), (0,10)mm and a driving 20mm base dimension, extruded 5mm along the negative world Y normal.",
    plan: aiDimensionedPolygonPlan,
    volume: 500,
    bodies: 1,
    span: { axis: 1, min: -5, max: 0 },
  },
  {
    id: "analytic-semicircle",
    prompt:
      "Make a radius 5mm semicircle below local Y=0 on XY, bounded by a straight diameter, extruded 3mm in positive Z. Use an analytic arc.",
    plan: aiArcPlan,
    volume: 37.5 * Math.PI,
    bodies: 1,
    span: { axis: 2, min: 0, max: 3 },
  },
  {
    id: "hollow-sleeve",
    prompt:
      "Make a hollow sleeve with 20mm outer diameter, 12mm bore and 8mm length along X, centered at the world origin (X=-4 to +4mm). Use one YZ section sketch containing the inner opening and one extrusion. No extra features.",
    plan: aiRingPlan,
    volume: 512 * Math.PI,
    bodies: 1,
    span: { axis: 0, min: -4, max: 4 },
  },
  {
    id: "rectangular-spacer",
    prompt:
      "Make a hollow rectangular spacer on XY, centered at the origin: outer section 30 by 20mm, inner opening 20 by 10mm, extrusion 8mm in positive Z. Use one sketch for both loops.",
    plan: aiTubePlan,
    volume: 3200,
    bodies: 1,
    span: { axis: 2, min: 0, max: 8 },
  },
  {
    id: "island-pocket",
    prompt:
      "Make a centered 20 by 20 by 8mm block on XY. Cut a centered 14mm square pocket 3mm deep from the top, retaining a 6mm diameter central island. Use one pocket sketch with an inner opening.",
    plan: aiIslandPocketPlan,
    volume: 2612 + 27 * Math.PI,
    bodies: 1,
    span: { axis: 2, min: 0, max: 8 },
  },
  {
    id: "face-boss",
    prompt:
      "Make a centered 20 by 10 by 4mm rectangular block on XY at Z=0. Sketch a centered 4mm diameter circle on its top face and extrude 3mm outward, joined to the base as one body. Base thickness must remain editable. No extra features or edge treatments.",
    plan: aiFaceBossPlan,
    volume: 800 + 12 * Math.PI,
    bodies: 1,
    span: { axis: 2, min: 0, max: 7 },
  },
  {
    id: "straight-side-tab",
    prompt:
      "Make a centered 20 by 10 by 4mm block on XY and join a centered 4 by 2mm rectangular tab projecting 3mm from its front face at Y=-5mm. Put the tab sketch on that straight side face.",
    plan: aiSideBossPlan,
    volume: 824,
    bodies: 1,
    span: { axis: 1, min: -8, max: 5 },
  },
  {
    id: "to-face-pillar",
    prompt:
      "Make a centered 20mm square ceiling, 2mm thick, on XY starting at Z=12mm. Make a centered 4mm square pillar from Z=0 terminated To Face at the ceiling bottom. Keep these as two bodies and make target height editable.",
    plan: aiToFacePillarPlan,
    volume: 992,
    bodies: 2,
    span: { axis: 2, min: 0, max: 14 },
  },
];
export const liveAiAcceptanceCases = aiAcceptanceCorpus.filter(
  (c) => c.id === "hollow-sleeve" || c.id === "face-boss",
);

if (liveAiAcceptanceCases.length !== 2)
  throw new Error(
    "Live AI acceptance requires exactly the sleeve and face-boss cases.",
  );
