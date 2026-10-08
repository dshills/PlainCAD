import { withComponentPlacement } from "../cad/document/componentPlacement";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import {
  addCanvasGeometry,
  snapCanvasPoint,
} from "../cad/sketch/canvasGeometry";
import { useCadStore } from "../state/useCadStore";
import {
  beginSketchCanvas,
  canvasContext,
  commitCanvasGeometry,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import {
  runCommand,
  selectCommandEnablement,
} from "../ui/commands/commandRegistry";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";

beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
describe("canvas sketch authoring", () => {
  it("draws a non-template triangle with shared endpoint IDs and a stable closed profile", () => {
    let sketch = createXySketch();
    const first = addCanvasGeometry(sketch, solveSketch(sketch, {}), "line", [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
    sketch = first.sketch;
    const second = addCanvasGeometry(sketch, solveSketch(sketch, {}), "line", [
      first.endpoint!,
      { x: 0, y: 30 },
    ]);
    sketch = second.sketch;
    const solved = solveSketch(sketch, {}),
      origin = snapCanvasPoint({ x: 0.1, y: 0.1 }, solved, 0.5, 1);
    sketch = addCanvasGeometry(sketch, solved, "line", [
      second.endpoint!,
      origin,
    ]).sketch;
    expect(
      Object.values(sketch.entities).filter((e) => e.type === "point"),
    ).toHaveLength(3);
    const profiles = detectProfiles(solveSketch(sketch, {}));
    expect(profiles.errors).toEqual([]);
    expect(profiles.profiles).toHaveLength(1);
    const segments = profiles.profiles[0].outerLoop.segments!;
    expect(
      Math.abs(
        segments.reduce(
          (area, s) => area + s.start.x * s.end.y - s.end.x * s.start.y,
          0,
        ),
      ) / 2,
    ).toBeCloseTo(600);
  });
  it("keeps circles and arcs analytic, projects free arc endpoints and excludes construction curves", () => {
    let sketch = createXySketch();
    sketch = addCanvasGeometry(
      sketch,
      solveSketch(sketch, {}),
      "circle",
      [
        { x: 20, y: 20 },
        { x: 25, y: 20 },
      ],
      true,
    ).sketch;
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "arc", [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 30 },
    ]).sketch;
    const solved = solveSketch(sketch, {});
    expect(solved.errors).toEqual([]);
    expect(solved.arcs[0].end.y).toBeCloseTo(10);
    expect(solved.arcs[0].sweep).toBeCloseTo(Math.PI / 2);
    expect(solved.circles[0]).toMatchObject({ radius: 5, construction: true });
    expect(detectProfiles(solved).profiles).toEqual([]);
  });
  it("reuses existing derived rectangle corners and does not change reused construction points", () => {
    let sketch = createXySketch();
    sketch = addCanvasGeometry(
      sketch,
      solveSketch(sketch, {}),
      "point",
      [{ x: 20, y: 0 }],
      true,
    ).sketch;
    const id = Object.keys(sketch.entities)[0];
    const before = sketch;
    expect(
      addCanvasGeometry(sketch, solveSketch(sketch, {}), "point", [
        { x: 20, y: 0 },
      ]).sketch,
    ).toBe(before);
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
    ]).sketch;
    expect(
      Object.values(sketch.entities).filter((e) => e.type === "point"),
    ).toHaveLength(4);
    expect(sketch.entities[id].construction).toBe(true);
    expect(
      Object.values(sketch.entities)
        .filter((e) => e.type === "line")
        .some((e) => e.startPointId === id || e.endPointId === id),
    ).toBe(true);
  });
  it("round-trips tiny coordinates without exponent/unit parsing errors", () => {
    const sketch = createXySketch(),
      result = addCanvasGeometry(sketch, solveSketch(sketch, {}), "point", [
        { x: 5e-7, y: -2e-7 },
      ]).sketch;
    const solved = solveSketch(result, {});
    expect(solved.errors).toEqual([]);
    expect(Object.values(solved.points)[0].x).toBeCloseTo(5e-7, 12);
  });
  it("rejects degenerate rectangles, off-radius snapped arc endpoints and nonfinite coordinates atomically", () => {
    const sketch = createXySketch(),
      solved = solveSketch(sketch, {});
    expect(() =>
      addCanvasGeometry(sketch, solved, "rectangle", [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
      ]),
    ).toThrow("nonzero width");
    expect(() =>
      addCanvasGeometry(sketch, solved, "point", [{ x: Infinity, y: 0 }]),
    ).toThrow("finite");
    expect(() =>
      addCanvasGeometry(sketch, solved, "arc", [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 20, pointId: "existing" },
      ]),
    ).toThrow("same radius");
    expect(sketch.entities).toEqual({});
  });
  it("saves a whole primitive as one undoable edit with explicit millimeter expressions, IDs and save/open", () => {
    runCommand("sketch.createXZ");
    expect(selectCommandEnablement(useCadStore.getState()).sketchCanvas).toBe(
      true,
    );
    runCommand("sketch.editCanvas");
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    commitCanvasGeometry(
      active,
      before,
      "rectangle",
      [
        { x: 10, y: 20 },
        { x: 40, y: 50 },
      ],
      false,
      false,
    );
    const after = useCadStore.getState().history.present;
    expect(
      Object.values(after.sketches[active.sketchId].entities).filter(
        (e) => e.type === "line",
      ),
    ).toHaveLength(4);
    const loaded = importProjectText(serializeProject(after));
    expect(loaded.sketches[active.sketchId].entities).toEqual(
      after.sketches[active.sketchId].entities,
    );
    expect(canvasContext(active).plane.normal).toEqual({ x: 0, y: -1, z: 0 });
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(after);
  });
  it("keeps history unchanged on a rejected primitive and a reused point no-op", () => {
    runCommand("sketch.createXY");
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    expect(() =>
      commitCanvasGeometry(
        active,
        before,
        "line",
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        false,
        false,
      ),
    ).toThrow("distinct");
    expect(useCadStore.getState().history.present).toBe(before);
    commitCanvasGeometry(
      active,
      before,
      "point",
      [{ x: 1, y: 2 }],
      true,
      false,
    );
    const after = useCadStore.getState().history.present;
    commitCanvasGeometry(
      active,
      after,
      "point",
      [{ x: 1, y: 2 }],
      false,
      false,
    );
    expect(useCadStore.getState().history.present).toBe(after);
  });
  it("rejects stale gestures and replacement documents, even if IDs are retained", () => {
    runCommand("sketch.createXY");
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    useCadStore.getState().updateDocument((d) => ({ ...d, name: "Changed" }));
    expect(() =>
      commitCanvasGeometry(
        active,
        before,
        "point",
        [{ x: 10, y: 10 }],
        false,
        false,
      ),
    ).toThrow("Project changed");
    useCadStore.getState().setDocument(before);
    expect(() => canvasContext(active)).toThrow("Reopen");
  });
  it("blocks lost planes and creation without an explicit current sketch selection", () => {
    expect(selectCommandEnablement(useCadStore.getState()).sketchCanvas).toBe(
      false,
    );
    const sketch = {
      ...createXySketch(),
      plane: {
        type: "face" as const,
        featureId: "missing",
        stableFaceId: "lost",
      },
    };
    useCadStore
      .getState()
      .setDocument(upsertSketch(createEmptyDocument(), sketch));
    useCadStore.getState().select({
      kind: "sketch",
      id: sketch.id,
      documentId: useCadStore.getState().history.present.id,
    });
    beginSketchCanvas();
    expect(() => canvasContext(useSketchCanvas.getState().active!)).toThrow(
      "reference lost",
    );
  });
  it("opens pending sketch canvas in the component's posed frame without changing authored drawing coordinates", () => {
    let document = createEmptyDocument();
    const sketch = createXySketch();
    document = upsertSketch(document, sketch);
    document = withComponentPlacement(document, document.rootComponentId, { translation: [30, -7, 4], rotation: [Math.PI / 2, 0, 0] });
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!, state = useCadStore.getState();
    const context = canvasContext(active, { ...state, rebuild: { ...state.rebuild, status: "queued", result: undefined } });
    expect(context.plane.origin).toEqual({ x: 30, y: -7, z: 4 });
    expect(context.plane.normal).toEqual({ x: 0, y: -1, z: 0 });
    commitCanvasGeometry(active, state.history.present, "point", [{ x: 8, y: 3 }], false, false);
    const solved = solveSketch(useCadStore.getState().history.present.sketches[sketch.id], {});
    expect(Object.values(solved.points)).toEqual([expect.objectContaining({ x: 8, y: 3 })]);
    expect(useCadStore.getState().history.present.components[document.rootComponentId].placement).toEqual(document.components[document.rootComponentId].placement);
  });

});
