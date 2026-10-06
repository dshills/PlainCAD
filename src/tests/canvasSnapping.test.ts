import { expect, it } from "vitest";
import { createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch, type ResolvedSketch } from "../cad/sketch/SketchSolver";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import {
  canvasSnapTargets,
  snapCanvasWithFeedback,
  type CanvasSnapOptions,
} from "../cad/sketch/canvasSnapping";
const options: CanvasSnapOptions = {
  pixelsPerUnit: { x: 10, y: 10 },
  tolerancePx: 8,
  grid: 1,
  geometry: true,
  view: { x: -50, y: -50, width: 100, height: 100 },
};
function geometry() {
  let sketch = createXySketch();
  sketch = addCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "line",
    [
      { x: -10, y: 0 },
      { x: 10, y: 0 },
    ],
    true,
  ).sketch;
  sketch = addCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "circle",
    [
      { x: 20, y: 15 },
      { x: 23, y: 15 },
    ],
    true,
  ).sketch;
  sketch = addCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "arc",
    [
      { x: -20, y: 15 },
      { x: -15, y: 15 },
      { x: -20, y: 20 },
    ],
    true,
  ).sketch;
  return { sketch, solved: solveSketch(sketch, {}) };
}
it("snaps line midpoints and curve centers while retaining point reuse and document geometry", () => {
  const { sketch, solved } = geometry(),
    targets = canvasSnapTargets(solved);
  const before = structuredClone(sketch);
  expect(
    snapCanvasWithFeedback({ x: 0.5, y: 0.2 }, targets, options),
  ).toMatchObject({
    point: { x: 0, y: 0 },
    feedback: { kind: "midpoint", label: "Midpoint" },
  });
  for (const center of [solved.circles[0].center, solved.arcs[0].center]) {
    const result = snapCanvasWithFeedback(
      { x: center.x + 0.4, y: center.y + 0.3 },
      targets,
      options,
    );
    expect(result).toMatchObject({
      point: { x: center.x, y: center.y, pointId: center.id },
      feedback: { kind: "center" },
    });
  }
  expect(sketch).toEqual(before);
});
it.each([Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 2])(
  "uses the swept arc midpoint for sweep %s, not the endpoint chord",
  (sweep) => {
    const { solved } = geometry();
    const arc = { ...solved.arcs[0], sweep };
    const targets = canvasSnapTargets({ ...solved, arcs: [arc] });
    const midpoint = targets.geometry.find(
      (p) => p.kind === "midpoint" && p.sourceId === arc.id,
    )!;
    expect(midpoint.x).toBeCloseTo(
      arc.center.x + arc.radius * Math.cos(arc.startAngle + sweep / 2),
    );
    expect(midpoint.y).toBeCloseTo(
      arc.center.y + arc.radius * Math.sin(arc.startAngle + sweep / 2),
    );
    expect(
      snapCanvasWithFeedback(midpoint, targets, options).feedback?.kind,
    ).toBe("midpoint");
  },
);
it("keeps existing points ahead of a closer midpoint and grid", () => {
  const { solved } = geometry(),
    targets = canvasSnapTargets(solved);
  targets.points.push({
    x: 0.6,
    y: 0,
    pointId: "priority",
    kind: "point",
    sourceId: "priority",
  });
  const result = snapCanvasWithFeedback({ x: 0, y: 0 }, targets, options);
  expect(result).toMatchObject({
    point: { x: 0.6, y: 0, pointId: "priority" },
    feedback: { kind: "point" },
  });
});
it("uses eight screen pixels at any zoom and independent axis scales", () => {
  const targets = {
    points: [],
    geometry: [{ x: 0, y: 0, kind: "midpoint" as const, sourceId: "origin" }],
  };
  for (const scale of [
    { x: 10, y: 10 },
    { x: 100, y: 25 },
    { x: 1, y: 4 },
  ]) {
    const current = { ...options, grid: 0, pixelsPerUnit: scale };
    expect(
      snapCanvasWithFeedback(
        { x: 4 / scale.x, y: 4 / scale.y },
        targets,
        current,
      ).feedback?.kind,
    ).toBe("midpoint");
    expect(
      snapCanvasWithFeedback(
        { x: 9 / scale.x, y: 9 / scale.y },
        {
          points: [],
          geometry: [{ x: 0, y: 0, kind: "midpoint", sourceId: "origin" }],
        },
        current,
      ).feedback,
    ).toBeUndefined();
  }
});
it("aligns only nearby axes with visible references and a draft anchor, leaving other coordinates free or on grid", () => {
  const targets = {
    points: [
      { x: 3.25, y: 9.75, kind: "point" as const, sourceId: "reference" },
    ],
    geometry: [],
  };
  const vertical = snapCanvasWithFeedback(
    { x: 3.7, y: -6.2 },
    targets,
    options,
  );
  expect(vertical).toMatchObject({
    point: { x: 3.25, y: -6 },
    feedback: {
      kind: "alignment",
      label: "Vertical alignment",
      guides: [{ start: { x: 3.25, y: 9.75 }, end: { x: 3.25, y: -6 } }],
    },
  });
  expect(
    snapCanvasWithFeedback({ x: -12.2, y: 9.3 }, targets, {
      ...options,
      grid: 0,
    }),
  ).toMatchObject({
    point: { x: -12.2, y: 9.75 },
    feedback: { label: "Horizontal alignment" },
  });
  expect(
    snapCanvasWithFeedback({ x: 3.7, y: -6.2 }, targets, {
      ...options,
      view: { x: -50, y: -50, width: 100, height: 40 },
      grid: 0,
    }).feedback,
  ).toBeUndefined();
  expect(
    snapCanvasWithFeedback(
      { x: 8.4, y: -6.2 },
      { points: [], geometry: [] },
      { ...options, anchor: { x: 8, y: 11 }, grid: 0 },
    ),
  ).toMatchObject({
    point: { x: 8, y: -6.2 },
    feedback: { label: "Vertical alignment" },
  });
});
it("turns off geometric inference independently of existing point and grid snapping; rejects invalid targets", () => {
  const { solved } = geometry(),
    targets = canvasSnapTargets(solved);
  expect(
    snapCanvasWithFeedback({ x: 0.4, y: 0.2 }, targets, {
      ...options,
      geometry: false,
    }),
  ).toMatchObject({ point: { x: 0, y: 0 }, feedback: { kind: "grid" } });
  expect(
    snapCanvasWithFeedback({ x: 0.4, y: 0.2 }, targets, {
      ...options,
      geometry: false,
      grid: 0,
    }),
  ).toEqual({ point: { x: 0.4, y: 0.2 } });
  expect(
    snapCanvasWithFeedback({ x: 10.2, y: 0.1 }, targets, {
      ...options,
      geometry: false,
    }).point.pointId,
  ).toBe(solved.lines[0].end.id);
  const broken: ResolvedSketch = {
    ...solved,
    points: { bad: { id: "bad", x: NaN, y: 0 } },
    lines: [{ ...solved.lines[0], start: { id: "bad", x: NaN, y: 0 } }],
    circles: [],
    arcs: [],
  };
  expect(canvasSnapTargets(broken)).toEqual({ points: [], geometry: [] });
  expect(
    snapCanvasWithFeedback({ x: 1, y: 2 }, targets, {
      ...options,
      pixelsPerUnit: { x: NaN, y: 1 },
    }),
  ).toEqual({ point: { x: 1, y: 2 } });
});
it("breaks equal-distance target ties deterministically regardless of solve order", () => {
  const points = ["z", "a"].map((id) => ({
    x: id === "z" ? -0.5 : 0.5,
    y: 0,
    pointId: id,
    sourceId: id,
    kind: "point" as const,
  }));
  for (const ordered of [points, [...points].reverse()])
    expect(
      snapCanvasWithFeedback(
        { x: 0, y: 0 },
        { points: ordered, geometry: [] },
        options,
      ).point.pointId,
    ).toBe("a");
});

it("normalizes negative zero in grid feedback", () => {
  expect(
    snapCanvasWithFeedback(
      { x: -0.1, y: -0.1 },
      { points: [], geometry: [] },
      options,
    ).point,
  ).toEqual({ x: 0, y: 0 });
});

it("preserves short draft extents in an empty 200-unit viewport without weakening existing-point reuse", () => {
  const wide = {
    ...options,
    pixelsPerUnit: { x: 2.5, y: 1.5 },
    view: { x: -100, y: -100, width: 200, height: 200 },
    anchor: { x: 0, y: 0 },
  };
  const empty = { points: [], geometry: [] };
  for (const { raw, expected } of [
    { raw: { x: 2, y: 0 }, expected: { x: 2, y: 0 } },
    { raw: { x: 0, y: 2 }, expected: { x: 0, y: 2 } },
    { raw: { x: 2, y: 2 }, expected: { x: 2, y: 0 } },
  ]) {
    const result = snapCanvasWithFeedback(raw, empty, wide);
    expect(result.point).toEqual(expected);
    expect(result.feedback?.kind).toBe("alignment");
  }
  expect(snapCanvasWithFeedback({ x: 2, y: 0 }, empty, wide).point).toEqual({
    x: 2,
    y: 0,
  });
  expect(
    snapCanvasWithFeedback({ x: 2, y: 2 }, empty, {
      ...wide,
      anchorShape: "rectangle",
    }).point,
  ).toEqual({ x: 2, y: 2 });
  expect(
    snapCanvasWithFeedback(
      { x: 2, y: 2 },
      {
        points: [{
          x: 0,
          y: 0,
          kind: "point",
          sourceId: "existing",
          pointId: "existing",
        }],
        geometry: [],
      },
      wide,
    ).point,
  ).toEqual({ x: 0, y: 0, pointId: "existing" });
});

it.each([
  { offset: { x: -2, y: 0 }, expected: { x: -2, y: 0 } },
  { offset: { x: 0, y: -2 }, expected: { x: 0, y: -2 } },
  { offset: { x: -2, y: -1 }, expected: { x: -2, y: 0 } },
  { offset: { x: -1, y: -2 }, expected: { x: 0, y: -2 } },
])(
  "preserves negative and off-origin draft vectors: $offset",
  ({ offset, expected }) => {
    const anchor = { x: 10, y: -20 };
    const result = snapCanvasWithFeedback(
      { x: anchor.x + offset.x, y: anchor.y + offset.y },
      { points: [], geometry: [] },
      {
        ...options,
        anchor,
        pixelsPerUnit: { x: 2.5, y: 2.5 },
        view: { x: -100, y: -100, width: 200, height: 200 },
      },
    );
    expect(result.point).toEqual({
      x: anchor.x + expected.x,
      y: anchor.y + expected.y,
    });
  },
);

it("preserves rectangle extents when other alignment targets coincide with its off-origin anchor axes", () => {
  const current: CanvasSnapOptions = {
    ...options,
    anchor: { x: 10, y: -20 },
    anchorShape: "rectangle",
    pixelsPerUnit: { x: 2.5, y: 2.5 },
  };
  const targets = {
    points: [],
    geometry: [
      { x: 10, y: 30, kind: "midpoint" as const, sourceId: "aaa-x-reference" },
      { x: 30, y: -20, kind: "center" as const, sourceId: "aaa-y-reference" },
    ],
  };
  expect(
    snapCanvasWithFeedback({ x: 8, y: -22 }, targets, current).point,
  ).toEqual({ x: 8, y: -22 });
  // An exactly zero raw extent is left to the existing modeling diagnostic.
  expect(
    snapCanvasWithFeedback({ x: 10, y: -22 }, targets, current).point,
  ).toEqual({ x: 10, y: -22 });
});
