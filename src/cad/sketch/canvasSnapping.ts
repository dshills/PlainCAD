import type { ResolvedSketch } from "./SketchSolver";
import type { CanvasPoint } from "./canvasGeometry";

export type CanvasSnapKind = "point" | "midpoint" | "center";
export interface CanvasSnapTarget extends CanvasPoint {
  kind: CanvasSnapKind;
  sourceId: string;
}
export interface CanvasSnapTargets {
  points: CanvasSnapTarget[];
  geometry: CanvasSnapTarget[];
}
export interface CanvasSnapFeedback {
  kind: CanvasSnapKind | "alignment" | "grid";
  label: string;
  guides: Array<{ start: CanvasPoint; end: CanvasPoint }>;
}
export interface CanvasSnapOptions {
  pixelsPerUnit: { x: number; y: number };
  tolerancePx: number;
  grid: number;
  geometry: boolean;
  view: { x: number; y: number; width: number; height: number };
  anchor?: CanvasPoint;
  /** Rectangles require independent nonzero extents from their first corner. */
  anchorShape?: "rectangle";
}
const finite = (point: CanvasPoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

function nearerTarget(
  candidate: CanvasSnapTarget,
  distance: number,
  best: CanvasSnapTarget | undefined,
  bestDistance: number,
) {
  return (
    !best ||
    distance < bestDistance ||
    (distance === bestDistance &&
      candidate.sourceId.localeCompare(best.sourceId) < 0)
  );
}

/** One linear, reusable target pass per solve; snapping never adds constraints. */
export function canvasSnapTargets(solved: ResolvedSketch): CanvasSnapTargets {
  const centers = new Map<string, string>();
  const geometry: CanvasSnapTarget[] = [];
  for (const curve of [...solved.circles, ...solved.arcs]) {
    const previous = centers.get(curve.center.id);
    if (!previous || curve.id.localeCompare(previous) < 0)
      centers.set(curve.center.id, curve.id);
    if (finite(curve.center))
      geometry.push({
        x: curve.center.x,
        y: curve.center.y,
        kind: "center",
        sourceId: curve.id,
      });
  }
  for (const line of solved.lines)
    if (finite(line.start) && finite(line.end))
      geometry.push({
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2,
        kind: "midpoint",
        sourceId: line.id,
      });
  for (const arc of solved.arcs) {
    const angle = arc.startAngle + arc.sweep / 2;
    const point = {
      x: arc.center.x + arc.radius * Math.cos(angle),
      y: arc.center.y + arc.radius * Math.sin(angle),
    };
    if (finite(point) && Number.isFinite(arc.radius) && arc.radius > 0)
      geometry.push({ ...point, kind: "midpoint", sourceId: arc.id });
  }
  return {
    points: Object.values(solved.points)
      .filter(finite)
      .map((point) => ({
        x: point.x,
        y: point.y,
        pointId: point.id,
        kind: centers.has(point.id) ? "center" : "point",
        sourceId: centers.get(point.id) ?? point.id,
      })),
    geometry,
  };
}

/** Existing points, geometric targets, alignment, then grid. All proximity
 * checks use screen pixels on both axes, including nonuniform SVG scaling. */
export function snapCanvasWithFeedback(
  raw: CanvasPoint,
  targets: CanvasSnapTargets,
  options: CanvasSnapOptions,
): { point: CanvasPoint; feedback?: CanvasSnapFeedback } {
  const { pixelsPerUnit: scale, tolerancePx: tolerance, view } = options;
  if (
    !finite(raw) ||
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    scale.x <= 0 ||
    scale.y <= 0 ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    return { point: raw };
  const distance = (a: CanvasPoint, b: CanvasPoint) =>
    Math.hypot((a.x - b.x) * scale.x, (a.y - b.y) * scale.y);
  const visible = (point: CanvasPoint) =>
    finite(point) &&
    point.x >= view.x - tolerance / scale.x &&
    point.x <= view.x + view.width + tolerance / scale.x &&
    point.y >= view.y - tolerance / scale.y &&
    point.y <= view.y + view.height + tolerance / scale.y;
  const nearest = (candidates: CanvasSnapTarget[]) => {
    let best: CanvasSnapTarget | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (!visible(candidate)) continue;
      const current = distance(raw, candidate);
      if (
        current <= tolerance &&
        nearerTarget(candidate, current, best, bestDistance)
      ) {
        best = candidate;
        bestDistance = current;
      }
    }
    return best;
  };
  const target =
    nearest(targets.points) ??
    (options.geometry ? nearest(targets.geometry) : undefined);
  if (target)
    return {
      point: {
        x: target.x,
        y: target.y,
        ...(target.pointId ? { pointId: target.pointId } : {}),
      },
      feedback: {
        kind: target.kind,
        label:
          target.kind === "point"
            ? "Existing point"
            : target.kind === "midpoint"
              ? "Midpoint"
              : "Center",
        guides: [],
      },
    };
  const grid =
    options.grid > 0 && Number.isFinite(options.grid) ? options.grid : 0;
  // Canonical +0 for rounded grid values; reuse preserves exact solved coordinates.
  const point: CanvasPoint = grid
    ? {
        x: Math.round(raw.x / grid) * grid + 0,
        y: Math.round(raw.y / grid) * grid + 0,
      }
    : { x: raw.x, y: raw.y };
  if (options.geometry) {
    let x: CanvasSnapTarget | undefined, y: CanvasSnapTarget | undefined;
    let dx = Infinity,
      dy = Infinity;
    const anchor: CanvasSnapTarget[] =
      options.anchor && visible(options.anchor)
        ? [{ ...options.anchor, kind: "point", sourceId: "draft-anchor" }]
        : [];
    for (const list of [targets.points, targets.geometry, anchor])
      for (const candidate of list) {
        if (!visible(candidate)) continue;
        const cx = Math.abs(raw.x - candidate.x) * scale.x;
        const cy = Math.abs(raw.y - candidate.y) * scale.y;
        if (cx <= tolerance && nearerTarget(candidate, cx, x, dx)) {
          x = candidate;
          dx = cx;
        }
        if (cy <= tolerance && nearerTarget(candidate, cy, y, dy)) {
          y = candidate;
          dy = cy;
        }
      }
    // Inference must not erase a deliberate extent from the draft anchor.
    // Actual existing-point reuse was handled above and remains unchanged.
    const draftAnchor = options.anchor;
    if (draftAnchor) {
      if (options.anchorShape === "rectangle") {
        if (x?.x === draftAnchor.x && raw.x !== draftAnchor.x) {
          x = undefined;
          if (point.x === draftAnchor.x) point.x = raw.x;
        }
        if (y?.y === draftAnchor.y && raw.y !== draftAnchor.y) {
          y = undefined;
          if (point.y === draftAnchor.y) point.y = raw.y;
        }
      } else if (
        (x?.x ?? point.x) === draftAnchor.x &&
        (y?.y ?? point.y) === draftAnchor.y &&
        (raw.x !== draftAnchor.x || raw.y !== draftAnchor.y)
      ) {
        // Keep the closer axis, freeing the other coordinate for short lines,
        // circle radii, and arc gestures even at the initial wide zoom.
        if (
          raw.x !== draftAnchor.x &&
          (!y || dx >= dy || raw.y === draftAnchor.y)
        ) {
          x = undefined;
          if (point.x === draftAnchor.x) point.x = raw.x;
        } else {
          y = undefined;
          if (point.y === draftAnchor.y) point.y = raw.y;
        }
      }
    }
    if (x) point.x = x.x;
    if (y) point.y = y.y;
    if (x || y)
      return {
        point,
        feedback: {
          kind: "alignment",
          label:
            x && y
              ? "Horizontal and vertical alignment"
              : x
                ? "Vertical alignment"
                : "Horizontal alignment",
          guides: [x, y]
            .filter((p): p is CanvasSnapTarget => Boolean(p))
            .map((start) => ({ start, end: point })),
        },
      };
  }
  return {
    point,
    ...(grid
      ? { feedback: { kind: "grid" as const, label: "Grid", guides: [] } }
      : {}),
  };
}
