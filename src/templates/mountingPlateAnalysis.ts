import { CadDocument } from "../cad/document/schema";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles, ProfileHole } from "../cad/sketch/profileDetection";
import { MOUNTING_PLATE_SKETCH_NAME } from "./mountingPlateConstants";

export interface MountingPlateAnalysis {
  valid: boolean;
  errors: string[];
  dimensions?: {
    width: number;
    height: number;
    thickness: number;
    holeDiameter: number;
  };
  holes: ProfileHole[];
}

const REQUIRED_PARAMETERS = ["plate_width", "plate_height", "plate_thickness", "hole_diameter", "hole_offset_x", "hole_offset_y"] as const;
const MOUNTING_PLATE_TOLERANCE = 1e-7;

export function analyzeMountingPlateDocument(document: CadDocument): MountingPlateAnalysis {
  const errors: string[] = [];
  const evaluated = evaluateParameters(document.parameters);
  for (const error of evaluated.errors) errors.push(error.message);
  for (const name of REQUIRED_PARAMETERS) {
    if (!evaluated.values[name]) errors.push(`Missing or invalid mounting plate parameter ${name}.`);
  }
  if (errors.length > 0) return { valid: false, errors, holes: [] };

  const sketch = Object.values(document.sketches).find((item) => item.name === MOUNTING_PLATE_SKETCH_NAME);
  if (!sketch) {
    return { valid: false, errors: [...errors, "Mounting plate sketch is missing."], holes: [] };
  }

  const solved = solveSketch(sketch, evaluated.values);
  for (const error of solved.errors) errors.push(error.message);
  if (solved.errors.length > 0) return { valid: false, errors, holes: [] };
  const profiles = detectProfiles(solved);
  errors.push(...profiles.errors);
  if (profiles.profiles.length > 1) errors.push("Mounting plate analysis expected exactly one profile.");
  const profile = profiles.profiles[0];
  if (!profile) {
    return { valid: false, errors: [...errors, "Mounting plate profile is missing."], holes: [] };
  }
  if (profile.holes.length !== 4) errors.push(`Mounting plate requires 4 holes; found ${profile.holes.length}.`);

  const width = evaluated.values.plate_width?.value;
  const height = evaluated.values.plate_height?.value;
  const thickness = evaluated.values.plate_thickness?.value;
  const holeDiameter = evaluated.values.hole_diameter?.value;
  const holeOffsetX = evaluated.values.hole_offset_x?.value;
  const holeOffsetY = evaluated.values.hole_offset_y?.value;
  const validDimensions = [width, height, thickness, holeDiameter].every((value) => value !== undefined && Number.isFinite(value) && value > 0);
  if (!validDimensions) {
    errors.push("Mounting plate dimensions must be positive.");
  }
  if (validDimensions && holeOffsetX !== undefined && holeOffsetY !== undefined) {
    errors.push(...validateHoleOffsets(width, height, holeDiameter, holeOffsetX, holeOffsetY));
    errors.push(...validateHoleLayout(profile.holes, width, height, holeDiameter, holeOffsetX, holeOffsetY));
  }

  return {
    valid: errors.length === 0,
    errors,
    dimensions: validDimensions ? { width, height, thickness, holeDiameter } : undefined,
    holes: profile.holes,
  };
}

function validateHoleOffsets(
  width: number,
  height: number,
  holeDiameter: number,
  holeOffsetX: number,
  holeOffsetY: number,
): string[] {
  const radius = holeDiameter / 2;
  const errors: string[] = [];
  if (!Number.isFinite(holeOffsetX) || holeOffsetX <= radius || holeOffsetX >= width / 2 - radius) {
    errors.push("hole_offset_x must keep corner mounting holes inside their left/right half of the plate.");
  }
  if (!Number.isFinite(holeOffsetY) || holeOffsetY <= radius || holeOffsetY >= height / 2 - radius) {
    errors.push("hole_offset_y must keep corner mounting holes inside their top/bottom half of the plate.");
  }
  return errors;
}

function validateHoleLayout(
  holes: ProfileHole[],
  width: number,
  height: number,
  holeDiameter: number,
  holeOffsetX: number,
  holeOffsetY: number,
): string[] {
  const expectedRadius = holeDiameter / 2;
  const expected = [
    { x: -width / 2 + holeOffsetX, y: -height / 2 + holeOffsetY },
    { x: width / 2 - holeOffsetX, y: -height / 2 + holeOffsetY },
    { x: width / 2 - holeOffsetX, y: height / 2 - holeOffsetY },
    { x: -width / 2 + holeOffsetX, y: height / 2 - holeOffsetY },
  ];
  const errors: string[] = [];
  for (const hole of holes) {
    if (Math.abs(hole.radius - expectedRadius) > MOUNTING_PLATE_TOLERANCE) {
      errors.push(`Mounting plate hole at ${formatCoordinate(hole.x)}, ${formatCoordinate(hole.y)} radius does not match hole_diameter / 2.`);
    }
  }
  for (const point of expected) {
    const match = holes.some((hole) => Math.abs(hole.x - point.x) <= MOUNTING_PLATE_TOLERANCE && Math.abs(hole.y - point.y) <= MOUNTING_PLATE_TOLERANCE);
    if (!match) errors.push(`Mounting plate is missing expected hole at ${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}.`);
  }
  return errors;
}

function formatCoordinate(value: number): string {
  return value.toFixed(3);
}
