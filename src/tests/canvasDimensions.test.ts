import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { addConstraint, createXySketch } from "../cad/sketch/SketchModel";
import {
  canvasAnnotations,
  withCanvasDimension,
} from "../cad/sketch/canvasDimensions";
import { useCadStore } from "../state/useCadStore";
import {
  beginSketchCanvas,
  canvasContext,
  commitCanvasDimension,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
const units = { length: "mm", angle: "deg" } as const;
function circle() {
  const sketch = createXySketch();
  return addCanvasGeometry(sketch, solveSketch(sketch, {}), "circle", [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
  ]).sketch;
}
beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
afterEach(cleanup);
describe("graphical sketch dimensions", () => {
  it("shows solved reference measurements and follows the display unit without modifying geometry", () => {
    const sketch = circle(),
      solved = solveSketch(sketch, {});
    const annotations = canvasAnnotations(
      sketch,
      solved,
      { ...units, length: "in" },
      100,
      true,
    );
    expect(annotations).toHaveLength(1);
    expect(annotations[0].label).toBe("R 0.1969 in");
    expect(annotations[0].lines).toEqual([
      [
        {
          id: Object.keys(solved.points)[0],
          x: 0,
          y: 0,
          construction: undefined,
        },
        { x: 5, y: 0 },
      ],
    ]);
    expect(canvasAnnotations(sketch, solved, units, 100, false)).toEqual([]);
  });
  it("drives a circle diameter and measures the current solution instead of the authored radius", () => {
    const sketch = circle(),
      id = Object.values(sketch.entities).find((e) => e.type === "circle")!.id;
    const driven = withCanvasDimension(sketch, {
        type: "diameter",
        refs: [id],
        expression: "14mm",
      }),
      solved = solveSketch(driven, {});
    expect(solved.errors).toEqual([]);
    expect(solved.circles[0].radius).toBeCloseTo(7, 6);
    const labels = canvasAnnotations(driven, solved, units, 100, true);
    expect(labels).toHaveLength(1);
    expect(labels[0].label).toBe("D1 Ø 14.0000 mm");
    expect(labels[0].title).toContain("14mm");
  });
  it("reports conflicting or lost dimensions as unavailable and omits misleading reference values", () => {
    let sketch = circle(),
      id = Object.values(sketch.entities).find((e) => e.type === "circle")!.id;
    sketch = addConstraint(sketch, "fixed", { entityIds: [id] });
    sketch = withCanvasDimension(sketch, {
      type: "radius",
      refs: [id],
      expression: "10mm",
    });
    const solved = solveSketch(sketch, {});
    expect(solved.errors.length).toBeGreaterThan(0);
    const labels = canvasAnnotations(sketch, solved, units, 100, true);
    expect(labels).toHaveLength(1);
    expect(labels[0].unavailable).toBe(true);
    expect(labels[0].label).toContain("unavailable");
    const lost = {
      ...sketch,
      dimensions: sketch.dimensions.map((d) => ({ ...d, entityIds: ["lost"] })),
    };
    expect(
      canvasAnnotations(lost, solveSketch(lost, {}), units, 100, true)[0]
        .unavailable,
    ).toBe(true);
  });
  it("supports lengths, horizontal/vertical/distance and true unsigned angles with stable references", () => {
    let sketch = createXySketch();
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ]).sketch;
    const solved = solveSketch(sketch, {}),
      first = solved.lines.find(
        (l) =>
          l.start.x === 0 && l.start.y === 0 && l.end.x === 30 && l.end.y === 0,
      )!,
      second = solved.lines.find(
        (l) =>
          l.start.x === 30 &&
          l.start.y === 0 &&
          l.end.x === 30 &&
          l.end.y === 40,
      )!;
    for (const [type, refs, expression, text] of [
      ["length", [first.id], "30mm", "L 30.0000 mm"],
      [
        "horizontalDistance",
        [first.start.id, second.end.id],
        "30mm",
        "ΔX 30.0000 mm",
      ],
      [
        "verticalDistance",
        [first.start.id, second.end.id],
        "40mm",
        "ΔY 40.0000 mm",
      ],
      ["distance", [first.start.id, second.end.id], "50mm", "d 50.0000 mm"],
      ["angle", [first.id, second.id], "90deg", "∠ 90.000 deg"],
    ] as const) {
      const driven = withCanvasDimension(sketch, {
        type,
        refs: [...refs],
        expression,
      });
      expect(
        canvasAnnotations(driven, solveSketch(driven, {}), units, 100, false)[0]
          .label,
      ).toBe(`D1 ${text}`);
    }
  });
  it("marks pending dimensions unavailable instead of showing a previous valid value", () => {
    const sketch = circle(),
      id = Object.values(sketch.entities).find((e) => e.type === "circle")!.id;
    const driven = withCanvasDimension(sketch, {
      type: "radius",
      refs: [id],
      expression: "5mm",
    });
    const annotations = canvasAnnotations(
      driven,
      solveSketch(driven, {}),
      units,
      100,
      true,
      true,
    );
    expect(annotations[0].label).toContain("unavailable");
    expect(annotations[0].title).toContain("rebuild pending");
  });
  it("targets arc leaders onto the swept boundary and preserves type/references while editing", () => {
    let sketch = createXySketch();
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "arc", [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
    ]).sketch;
    const solved = solveSketch(sketch, {}),
      labels = canvasAnnotations(sketch, solved, units, 100, true);
    const end = labels[0].lines[0][1];
    expect(end.x).toBeCloseTo(-Math.sqrt(50), 6);
    expect(end.y).toBeCloseTo(Math.sqrt(50), 6);
    const driven = withCanvasDimension(sketch, {
      type: "radius",
      refs: [solved.arcs[0].id],
      expression: "10mm",
    });
    const edited = withCanvasDimension(driven, {
      id: driven.dimensions[0].id,
      type: "angle",
      refs: [],
      expression: "12mm",
    });
    expect(edited.dimensions[0]).toMatchObject({
      id: driven.dimensions[0].id,
      type: "radius",
      entityIds: driven.dimensions[0].entityIds,
    });
    expect(() =>
      withCanvasDimension(driven, {
        type: "radius",
        refs: [solved.arcs[0].id],
        expression: " ",
      }),
    ).toThrow("required");
  });
  it("ignores a retained old rebuild with the same document ID after an edit synchronously queues a new rebuild", () => {
    const sketch = circle(),
      document = upsertSketch(createEmptyDocument(), sketch),
      id = Object.values(sketch.entities).find((e) => e.type === "circle")!.id;
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      result = rebuildDocument(document);
    useCadStore.setState({
      rebuild: {
        ...useCadStore.getState().rebuild,
        status: "succeeded",
        result,
      },
    });
    expect(canvasContext(active).pending).toBe(false);
    useCadStore.getState().updateDocument((d) => {
      const stored = d.sketches[sketch.id],
        circle = stored.entities[id];
      if (circle.type !== "circle") throw new Error("circle required");
      return upsertSketch(d, {
        ...stored,
        entities: {
          ...stored.entities,
          [id]: { ...circle, radius: { expression: "8mm", unit: "mm" } },
        },
      });
    });
    expect(useCadStore.getState().rebuild.status).toBe("queued");
    expect(useCadStore.getState().rebuild.result?.documentId).toBe(document.id);
    const context = canvasContext(active);
    expect(context.pending).toBe(true);
    expect(context.solved.circles[0].radius).toBe(8);
  });
  it("keeps lost-reference dimensions repairable in the list without anchoring them to unrelated geometry", () => {
    const original = circle(),
      id = Object.values(original.entities).find(
        (e) => e.type === "circle",
      )!.id;
    const driven = withCanvasDimension(original, {
      type: "radius",
      refs: [id],
      expression: "5mm",
    });
    const sketch = {
      ...driven,
      dimensions: driven.dimensions.map((d) => ({ ...d, entityIds: ["lost"] })),
    };
    const document = upsertSketch(createEmptyDocument(), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    render(createElement(SketchCanvasPanel));
    expect(
      screen.getByRole("button", { name: "Edit canvas dimension 1" }),
    ).toHaveTextContent("unavailable");
    const svg = screen.getByLabelText("Sketch drawing canvas", { exact: true });
    expect(svg.querySelector("[data-dimension-id]")).toBeNull();
    expect(
      canvasAnnotations(sketch, solveSketch(sketch, {}), units, 100, true)[0]
        .anchored,
    ).toBe(false);
  });
  it("rejects incompatible references and activates driving explicitly on legacy sketches", () => {
    const sketch = circle(),
      id = Object.values(sketch.entities).find((e) => e.type === "circle")!.id;
    expect(() =>
      withCanvasDimension(sketch, {
        type: "length",
        refs: [id],
        expression: "10mm",
      }),
    ).toThrow("incompatible");
    const driven = withCanvasDimension(
      { ...sketch, solveMode: "validate" },
      { type: "diameter", refs: [id], expression: "20mm" },
    );
    expect(driven.solveMode).toBe("driving");
    expect(solveSketch(driven, {}).circles[0].radius).toBeCloseTo(10, 6);
  });
  it("creates/edits/deletes dimensions through one undoable document edit, persists IDs, and rejects stale edits", () => {
    const sketch = circle(),
      document = upsertSketch(createEmptyDocument(), sketch),
      id = Object.values(sketch.entities).find((e) => e.type === "circle")!.id;
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    const dimensionId = commitCanvasDimension(active, before, {
      type: "diameter",
      refs: [id],
      expression: "14mm",
    })!;
    const after = useCadStore.getState().history.present;
    expect(canvasContext(active).solved.circles[0].radius).toBeCloseTo(7, 6);
    expect(
      importProjectText(serializeProject(after)).sketches[sketch.id]
        .dimensions[0].id,
    ).toBe(dimensionId);
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(after);
    expect(() =>
      commitCanvasDimension(active, before, {
        id: dimensionId,
        type: "diameter",
        refs: [],
        expression: "20mm",
      }),
    ).toThrow("changed");
    commitCanvasDimension(active, after, undefined, dimensionId);
    expect(
      useCadStore.getState().history.present.sketches[sketch.id].dimensions,
    ).toEqual([]);
  });
});
