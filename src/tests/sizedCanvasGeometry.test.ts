import { beforeEach, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import {
  addSizedCanvasGeometry,
  sizedCanvasPoints,
} from "../cad/sketch/sizedCanvasGeometry";
import { normalizeQuantity } from "../cad/parameters/units";
import { useCadStore } from "../state/useCadStore";
import { runCommand } from "../ui/commands/commandRegistry";
import {
  commitCanvasGeometry,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";

beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
it("sizes a rectangle in the pointer quadrant using authored units and preserves orthogonal intent on parameter edits", () => {
  const sketch = createXySketch();
  const result = addSizedCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "rectangle",
    [
      { x: 10, y: 20 },
      { x: 4, y: 13 },
    ],
    false,
    false,
    { width: "width", height: "0.5" },
    { width: normalizeQuantity(1, "in") },
    "in",
  ).sketch;
  expect(result.constraints.map((c) => c.type)).toEqual([
    "horizontal",
    "vertical",
    "horizontal",
    "vertical",
  ]);
  expect(result.dimensions.map((d) => d.expression.authoredUnit)).toEqual([
    "in",
    "in",
  ]);
  for (const width of [25.4, 38.1]) {
    const solved = solveSketch(result, {
      width: normalizeQuantity(width, "mm"),
    });
    expect(solved.errors).toEqual([]);
    const profile = detectProfiles(solved).profiles[0];
    expect(profile.bounds.maxX - profile.bounds.minX).toBeCloseTo(width, 6);
    expect(profile.bounds.maxY - profile.bounds.minY).toBeCloseTo(12.7, 6);
    expect(profile.outerLoop.segments).toHaveLength(4);
    result.constraints.forEach((c) => {
      const l = solved.lines.find((line) => line.id === c.entityIds[0])!;
      expect(
        c.type === "vertical" ? l.end.x - l.start.x : l.end.y - l.start.y,
      ).toBeCloseTo(0, 6);
    });
  }
  const initial = solveSketch(result, { width: normalizeQuantity(1, "in") });
  expect(detectProfiles(initial).profiles[0].bounds.minX).toBeCloseTo(-15.4, 6);
});
it("sizes analytic circles and construction circles without creating a solid profile", () => {
  const sketch = createXySketch();
  for (const construction of [false, true]) {
    const next = addSizedCanvasGeometry(
      sketch,
      solveSketch(sketch, {}),
      "circle",
      [
        { x: 4, y: 8 },
        { x: 4, y: 8 },
      ],
      construction,
      false,
      { diameter: "12mm" },
      {},
      "in",
    ).sketch;
    const solved = solveSketch(next, {});
    expect(solved.errors).toEqual([]);
    expect(solved.circles[0]).toMatchObject({
      radius: 6,
      center: { x: 4, y: 8 },
      construction,
    });
    expect(detectProfiles(solved).profiles).toHaveLength(construction ? 0 : 1);
    expect(next.dimensions[0].type).toBe("diameter");
  }
});
it.each(["0", "-2mm", "90deg", "unknown", "1 / 0", "100000001mm"])(
  "rejects an invalid draft size %s without changing history",
  async (width) => {
    await runCommand("sketch.createXY");
    await runCommand("sketch.editCanvas");
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history;
    expect(() =>
      commitCanvasGeometry(
        active,
        before.present,
        "rectangle",
        [
          { x: 0, y: 0 },
          { x: 5, y: 3 },
        ],
        false,
        false,
        { width, height: "3mm" },
      ),
    ).toThrow(/Width/);
    expect(useCadStore.getState().history).toBe(before);
  },
);
it("does not reuse a snapped endpoint when the precise size changes its position", () => {
  const base = createXySketch();
  const sketch = addCanvasGeometry(base, solveSketch(base, {}), "point", [
    { x: 10, y: 10 },
  ]).sketch;
  const id = Object.keys(sketch.entities)[0];
  const points = sizedCanvasPoints(
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 10, y: 10, pointId: id },
    ],
    { width: "20mm", height: "15mm" },
    {},
    "mm",
  );
  expect(points[1]).toEqual({ x: 20, y: 15 });
  const next = addSizedCanvasGeometry(
    sketch,
    solveSketch(sketch, {}),
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 10, y: 10, pointId: id },
    ],
    false,
    false,
    { width: "20mm", height: "15mm" },
    {},
    "mm",
  ).sketch;
  expect(solveSketch(next, {}).points[id]).toMatchObject({ x: 10, y: 10 });
});
it("commits sized geometry and dimensions together and preserves their IDs and units through undo/redo and save/open", async () => {
  const sketch = createXySketch();
  const document = {
    ...upsertSketch(createEmptyDocument(), sketch),
    unitSettings: { length: "in", angle: "deg" } as const,
  };
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  await runCommand("sketch.editCanvas");
  const active = useSketchCanvas.getState().active!,
    before = useCadStore.getState().history;
  commitCanvasGeometry(
    active,
    before.present,
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ],
    false,
    false,
    { width: "1", height: "0.5" },
  );
  const after = useCadStore.getState().history;
  expect(after.past).toHaveLength(before.past.length + 1);
  expect(after.present.sketches[sketch.id].dimensions).toHaveLength(2);
  expect(
    importProjectText(serializeProject(after.present)).sketches[sketch.id],
  ).toEqual(after.present.sketches[sketch.id]);
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(before.present);
  useCadStore.getState().redo();
  expect(useCadStore.getState().history.present).toBe(after.present);
});
