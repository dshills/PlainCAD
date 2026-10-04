import type { CanvasPoint } from "./canvasGeometry";

export const MAX_CANVAS_LABELS = 128;
export const MAX_CANVAS_POINT_OBSTACLES = 750;
export interface CanvasLabelView {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CanvasLabelBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface CanvasLabelInput {
  id: string;
  label: string;
  position: CanvasPoint;
  align: "start" | "middle";
  /** Manual canvas position: clamp to the view, but do not relocate around obstacles. */
  manualPosition?: CanvasPoint;
}
export interface CanvasLabelPlacement {
  position: CanvasPoint;
  box: CanvasLabelBox;
  crowded: boolean;
}
export function canvasBoxesOverlap(a: CanvasLabelBox, b: CanvasLabelBox) {
  return (
    a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
  );
}
function overlapArea(a: CanvasLabelBox, b: CanvasLabelBox) {
  return (
    Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
    Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
  );
}
/** Transient, deterministic label placement with conservative font estimates.
 * At most 128 labels × 49 candidates per family. Crowded fallbacks remain visible.
 * This avoids other label boxes and point handles, not every curve or leader. */
export function layoutCanvasLabels(
  labels: CanvasLabelInput[],
  fontSize: number,
  view: CanvasLabelView,
  reserved: CanvasLabelBox[] = [],
  points: CanvasPoint[] = [],
): Map<string, CanvasLabelPlacement> {
  if (
    ![fontSize, view.width, view.height].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    ![view.x, view.y].every(Number.isFinite)
  )
    throw new Error(
      "Canvas label view must be finite with positive dimensions.",
    );
  const padding = fontSize * 0.3;
  const incomplete =
    points.length > MAX_CANVAS_POINT_OBSTACLES ||
    points.some((p) => ![p.x, p.y].every(Number.isFinite));
  const obstacles = [
    ...reserved.slice(0, MAX_CANVAS_LABELS),
    ...points
      .slice(0, MAX_CANVAS_POINT_OBSTACLES)
      .filter((p) => [p.x, p.y].every(Number.isFinite))
      .map((p) => ({
        minX: p.x - fontSize * 0.5,
        maxX: p.x + fontSize * 0.5,
        minY: p.y - fontSize * 0.5,
        maxY: p.y + fontSize * 0.5,
      })),
  ];
  const result = new Map<string, CanvasLabelPlacement>();
  const directions = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  const bounded = labels.slice(0, MAX_CANVAS_LABELS);
  // Reserve manual labels first so automatic labels avoid the user's placement.
  const ordered = [
    ...bounded.filter((l) => l.manualPosition),
    ...bounded.filter((l) => !l.manualPosition),
  ];
  for (const label of ordered) {
    const requested = label.manualPosition ?? label.position;
    const invalid = ![requested.x, requested.y].every(Number.isFinite);
    const origin = invalid
      ? { x: view.x + view.width / 2, y: view.y + view.height / 2 }
      : requested;
    const width =
      Math.max(fontSize, label.label.length * fontSize * 0.75) + padding * 2;
    const left = label.align === "middle" ? width / 2 : padding;
    const right = width - left;
    const above = fontSize * 1.1,
      below = fontSize * 0.55;
    const fits = width <= view.width && above + below <= view.height;
    const clamp = (value: number, min: number, max: number) =>
      min <= max ? Math.max(min, Math.min(max, value)) : (min + max) / 2;
    const candidates: CanvasPoint[] = [origin];
    for (let ring = 1; !label.manualPosition && ring <= 6; ring++)
      for (const [x, y] of directions)
        candidates.push({
          x: origin.x + x * ring * (width + fontSize),
          y: origin.y + y * ring * (above + below + padding),
        });
    let best: CanvasLabelPlacement | undefined,
      bestCost = Infinity;
    for (const candidate of candidates) {
      const position = {
        x: clamp(candidate.x, view.x + left, view.x + view.width - right),
        y: clamp(candidate.y, view.y + below, view.y + view.height - above),
      };
      const box = {
        minX: position.x - left,
        maxX: position.x + right,
        minY: position.y - below,
        maxY: position.y + above,
      };
      const cost = obstacles.reduce(
        (sum, other) => sum + overlapArea(box, other),
        0,
      );
      if (cost < bestCost) {
        bestCost = cost;
        best = {
          position,
          box,
          crowded: cost > 0 || !fits || invalid || incomplete,
        };
      }
      if (cost === 0 && fits) break;
    }
    if (best) {
      result.set(label.id, best);
      obstacles.push(best.box);
    }
  }
  // A later manual label can overlap an earlier one; report both consistently.
  const entries = [...result];
  for (const [id, placement] of entries) {
    if (
      entries.some(
        ([otherId, other]) =>
          otherId !== id && canvasBoxesOverlap(placement.box, other.box),
      )
    )
      placement.crowded = true;
  }
  return new Map(
    bounded.flatMap((label) => {
      const placement = result.get(label.id);
      return placement ? [[label.id, placement] as const] : [];
    }),
  );
}
