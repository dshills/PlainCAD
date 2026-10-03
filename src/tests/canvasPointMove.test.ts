import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import {
  canvasPointMoveReason,
  movedCanvasPoint,
} from "../cad/sketch/canvasPointMove";
import {
  createXySketch,
  addConstraint,
  addPoint,
  addLine,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import {
  beginSketchCanvas,
  canvasContext,
  commitCanvasPointMove,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { useCadStore } from "../state/useCadStore";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
function fixture() {
  const empty = createXySketch(),
    sketch = addCanvasGeometry(empty, solveSketch(empty, {}), "rectangle", [
      { x: 0, y: 0 },
      { x: 40, y: 30 },
    ]).sketch;
  const point = Object.values(sketch.entities).find((e) => e.type === "point")!;
  return { sketch, pointId: point.id };
}
beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
afterEach(cleanup);
describe("guarded canvas point movement", () => {
  it("rejects coincidence introduced by re-solving independent underconstrained geometry", () => {
    const a = addPoint(createXySketch(), "0mm", "0mm"),
      b = addPoint(a.sketch, "40mm", "0mm"),
      c = addPoint(b.sketch, "60mm", "0mm"),
      line = addLine(c.sketch, b.pointId, c.pointId),
      sketch = withCanvasDimension(line.sketch, {
        type: "length",
        refs: [line.lineId],
        expression: "20mm",
      }),
      document = upsertSketch(createEmptyDocument(), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const result = rebuildDocument(document),
      solved = result.solvedSketches![sketch.id];
    // A different valid free-translation solution can come from the worker.
    // Canonical re-solving starts from the authored coordinates instead.
    const points = {
      ...solved.points,
      [b.pointId]: { ...solved.points[b.pointId], x: 60 },
      [c.pointId]: { ...solved.points[c.pointId], x: 80 },
    };
    useCadStore.setState({
      rebuild: {
        ...useCadStore.getState().rebuild,
        status: "succeeded",
        result: {
          ...result,
          solvedSketches: {
            ...result.solvedSketches,
            [sketch.id]: {
              ...solved,
              points,
              lines: solved.lines.map((l) => ({
                ...l,
                start: points[b.pointId],
                end: points[c.pointId],
              })),
            },
          },
        },
      },
    });
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    expect(canvasContext(active).solved.points[b.pointId].x).toBe(60);
    expect(() =>
      commitCanvasPointMove(active, before, a.pointId, { x: 40, y: 0 }),
    ).toThrow("after solving");
    expect(useCadStore.getState().history.present).toBe(before);
  });
  it("changes only the numeric point coordinates and preserves shared curve IDs and connectivity", () => {
    const { sketch, pointId } = fixture(),
      moved = movedCanvasPoint(sketch, pointId, { x: 10, y: 12 });
    expect(Object.keys(moved.entities)).toEqual(Object.keys(sketch.entities));
    for (const [id, e] of Object.entries(sketch.entities))
      if (id !== pointId) expect(moved.entities[id]).toBe(e);
    expect(solveSketch(moved, {}).points[pointId]).toMatchObject({
      x: 10,
      y: 12,
    });
  });
  it("rejects parameter-bound, constrained, dimension-bound and arc points rather than overwriting intent", () => {
    const { sketch, pointId } = fixture(),
      point = sketch.entities[pointId];
    if (point.type !== "point") throw new Error("point required");
    const parameterized = {
      ...sketch,
      entities: {
        ...sketch.entities,
        [pointId]: { ...point, x: { expression: "width", unit: "mm" } },
      },
    };
    expect(canvasPointMoveReason(parameterized, pointId)).toContain(
      "parameters",
    );
    expect(
      canvasPointMoveReason(
        addConstraint(sketch, "fixed", { pointIds: [pointId] }),
        pointId,
      ),
    ).toContain("constraint");
    const line = Object.values(sketch.entities).find(
      (e) =>
        e.type === "line" &&
        (e.startPointId === pointId || e.endPointId === pointId),
    )!;
    expect(
      canvasPointMoveReason(
        withCanvasDimension(sketch, {
          type: "length",
          refs: [line.id],
          expression: "40mm",
        }),
        pointId,
      ),
    ).toContain("driving");
    const empty = createXySketch(),
      arc = addCanvasGeometry(empty, solveSketch(empty, {}), "arc", [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]).sketch;
    expect(
      canvasPointMoveReason(
        arc,
        Object.values(arc.entities).find((e) => e.type === "point")!.id,
      ),
    ).toContain("Arc points");
    expect(() =>
      movedCanvasPoint(parameterized, pointId, { x: 10, y: 10 }),
    ).toThrow("parameters");
    expect(() => movedCanvasPoint(sketch, pointId, { x: NaN, y: 10 })).toThrow(
      "finite",
    );
  });
  it("moves an unconstrained circle center without changing its driving diameter", () => {
    const empty = createXySketch(),
      circle = addCanvasGeometry(empty, solveSketch(empty, {}), "circle", [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]).sketch;
    const entity = Object.values(circle.entities).find(
      (e) => e.type === "circle",
    )!;
    if (entity.type !== "circle") throw new Error("circle required");
    const driven = withCanvasDimension(circle, {
      type: "diameter",
      refs: [entity.id],
      expression: "20mm",
    });
    const moved = movedCanvasPoint(driven, entity.centerPointId, {
        x: 12,
        y: 15,
      }),
      solved = solveSketch(moved, {});
    expect(solved.errors).toEqual([]);
    expect(solved.circles[0].center).toMatchObject({ x: 12, y: 15 });
    expect(solved.circles[0].radius).toBeCloseTo(10, 6);
    expect(moved.dimensions).toBe(driven.dimensions);
  });
  it("keeps a point removed by undo visibly lost and disables coordinate moves", () => {
    const { sketch, pointId } = fixture(),
      empty = { ...sketch, entities: {} };
    const document = upsertSketch(createEmptyDocument(), empty);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    useCadStore.getState().updateDocument((d) => upsertSketch(d, sketch));
    render(createElement(SketchCanvasPanel));
    fireEvent.change(screen.getByLabelText("Canvas tool", { exact: true }), {
      target: { value: "move" },
    });
    fireEvent.change(
      screen.getByLabelText("Canvas point to move", { exact: true }),
      { target: { value: pointId } },
    );
    const beforeCollision = useCadStore.getState().history.present;
    fireEvent.change(
      screen.getByLabelText("Canvas coordinate X", { exact: true }),
      { target: { value: "40" } },
    );
    fireEvent.change(
      screen.getByLabelText("Canvas coordinate Y", { exact: true }),
      { target: { value: "0" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move point to coordinate" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Another point occupies",
    );
    expect(useCadStore.getState().history.present).toBe(beforeCollision);
    act(() => useCadStore.getState().undo());
    expect(
      screen.getByRole("option", { name: "Lost point — reselect" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Point reference lost");
    expect(
      screen.getByRole("button", {
        name: "Move point to coordinate",
      }),
    ).toBeDisabled();
  });
  it("commits one undoable edit, skips no-op moves and rejects stale or replacement project gestures", () => {
    const { sketch, pointId } = fixture(),
      document = upsertSketch(createEmptyDocument(), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    commitCanvasPointMove(active, before, pointId, { x: 10, y: 12 });
    const after = useCadStore.getState().history.present;
    expect(() =>
      commitCanvasPointMove(active, after, pointId, { x: 40, y: 0 }),
    ).toThrow("Another point");
    expect(useCadStore.getState().history.present).toBe(after);
    expect(useCadStore.getState().history.past.at(-1)).toBe(before);
    commitCanvasPointMove(active, after, pointId, { x: 10, y: 12 });
    expect(useCadStore.getState().history.present).toBe(after);
    expect(() =>
      commitCanvasPointMove(active, before, pointId, { x: 20, y: 20 }),
    ).toThrow("changed");
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(after);
    useCadStore.getState().setDocument(after);
    expect(() =>
      commitCanvasPointMove(
        active,
        useCadStore.getState().history.present,
        pointId,
        { x: 20, y: 20 },
      ),
    ).toThrow("Reopen");
  });
});
