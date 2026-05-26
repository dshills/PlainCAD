import { ResolvedCircle, ResolvedLine, ResolvedSketch } from "./SketchSolver";

export interface SketchProfile {
  id: string;
  sketchId: string;
  outerLoop: ProfileLoop;
  innerLoops: ProfileLoop[];
  holes: ProfileHole[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface ProfileLoop {
  entityIds: string[];
  type: "polygon" | "circle";
}

export interface ProfileHole {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface ProfileDetectionResult {
  profiles: SketchProfile[];
  errors: string[];
}

export function detectProfiles(sketch: ResolvedSketch): ProfileDetectionResult {
  const errors: string[] = [];
  const rectangle = detectRectangle(sketch.lines);
  const profiles: SketchProfile[] = [];

  if (rectangle) {
    const insideCircles = sketch.circles.filter((circle) => circleInsideBounds(circle, rectangle.bounds));
    const innerLoops = insideCircles.map((circle) => ({ entityIds: [circle.id], type: "circle" as const }));
    const outside = sketch.circles.filter((circle) => !circleInsideBounds(circle, rectangle.bounds));
    if (outside.length > 0) errors.push("One or more circles are outside the rectangular profile.");
    profiles.push({
      id: `${sketch.id}:profile:rectangle`,
      sketchId: sketch.id,
      outerLoop: { entityIds: rectangle.lineIds, type: "polygon" },
      innerLoops,
      holes: insideCircles.map((circle) => ({ id: circle.id, x: circle.center.x, y: circle.center.y, radius: circle.radius })),
      bounds: rectangle.bounds,
    });
    return { profiles, errors };
  }

  if (sketch.circles.length === 1 && sketch.lines.length === 0) {
    const circle = sketch.circles[0];
    profiles.push({
      id: `${sketch.id}:profile:${circle.id}`,
      sketchId: sketch.id,
      outerLoop: { entityIds: [circle.id], type: "circle" },
      innerLoops: [],
      holes: [],
      bounds: {
        minX: circle.center.x - circle.radius,
        maxX: circle.center.x + circle.radius,
        minY: circle.center.y - circle.radius,
        maxY: circle.center.y + circle.radius,
      },
    });
  } else if (sketch.lines.length > 0) {
    errors.push("Sketch does not contain a supported closed rectangle profile.");
  }

  return { profiles, errors };
}

function detectRectangle(lines: ResolvedLine[]):
  | { lineIds: string[]; bounds: { minX: number; maxX: number; minY: number; maxY: number } }
  | undefined {
  if (lines.length !== 4) return undefined;
  const points = lines.flatMap((line) => [line.start, line.end]);
  const xs = [...new Set(points.map((point) => round(point.x)))].sort((a, b) => a - b);
  const ys = [...new Set(points.map((point) => round(point.y)))].sort((a, b) => a - b);
  if (xs.length !== 2 || ys.length !== 2) return undefined;
  const corners = new Set(points.map((point) => `${round(point.x)},${round(point.y)}`));
  if (corners.size !== 4) return undefined;
  const expected = [`${xs[0]},${ys[0]}`, `${xs[1]},${ys[0]}`, `${xs[1]},${ys[1]}`, `${xs[0]},${ys[1]}`];
  if (!expected.every((corner) => corners.has(corner))) return undefined;
  return { lineIds: lines.map((line) => line.id), bounds: { minX: xs[0], maxX: xs[1], minY: ys[0], maxY: ys[1] } };
}

function circleInsideBounds(circle: ResolvedCircle, bounds: { minX: number; maxX: number; minY: number; maxY: number }): boolean {
  return (
    circle.center.x - circle.radius > bounds.minX &&
    circle.center.x + circle.radius < bounds.maxX &&
    circle.center.y - circle.radius > bounds.minY &&
    circle.center.y + circle.radius < bounds.maxY
  );
}

function round(value: number): number {
  return Math.round(value * 100000) / 100000;
}
