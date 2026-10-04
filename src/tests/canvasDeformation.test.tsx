import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import type { Sketch } from "../cad/document/schema";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import {
  canvasDeformationPlan,
  deformedCanvasSketch,
  validateCanvasDeformation,
} from "../cad/sketch/canvasDeformation";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import {
  addCircle,
  addConstraint,
  addPoint,
  createXySketch,
} from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { useCadStore } from "../state/useCadStore";
import {
  beginSketchCanvas,
  commitCanvasDeformation,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";

function fixture() {
  const empty = createXySketch();
  let sketch = addCanvasGeometry(empty, solveSketch(empty, {}), "rectangle", [
    { x: 0, y: 0 },
    { x: 20, y: 10 },
  ]).sketch;
  const points = Object.values(sketch.entities).filter(
    (e) => e.type === "point",
  );
  const lines = Object.values(sketch.entities).filter((e) => e.type === "line");
  sketch = addConstraint(sketch, "horizontal", {
    entityIds: [lines[0].id, lines[2].id],
  });
  sketch = addConstraint(sketch, "vertical", {
    entityIds: [lines[1].id, lines[3].id],
  });
  sketch = addConstraint(sketch, "fixed", { pointIds: [points[0].id] });
  return { sketch, points, lines, pointId: points[2].id };
}
function open(sketch: Sketch) {
  const document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.getState().setDocument(document);
  useCadStore.setState({
    rebuild: {
      status: "succeeded",
      kernelReady: false,
      result: rebuildDocument(document),
    },
  });
  useCadStore
    .getState()
    .select({ kind: "sketch", id: sketch.id, documentId: document.id });
  beginSketchCanvas();
  return {
    active: useSketchCanvas.getState().active!,
    before: useCadStore.getState().history.present,
  };
}
afterEach(() => {
  cleanup();
  useSketchCanvas.setState({ active: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
});
describe("bounded orthogonal sketch deformation", () => {
  it("propagates corner coordinates through orthogonal constraints while keeping the fixed anchor and profile IDs", () => {
    const { sketch, pointId, points } = fixture(),
      before = solveSketch(sketch, {});
    const original = structuredClone(sketch);
    const result = deformedCanvasSketch(sketch, before, pointId, {
      x: 30,
      y: 15,
    });
    const after = solveSketch(result.sketch, {});
    validateCanvasDeformation(before, after, result.targets);
    expect(after.points[points[0].id]).toMatchObject({ x: 0, y: 0 });
    expect(after.points[points[1].id]).toMatchObject({ x: 30, y: 0 });
    expect(after.points[points[2].id]).toMatchObject({ x: 30, y: 15 });
    expect(after.points[points[3].id]).toMatchObject({ x: 0, y: 15 });
    expect(detectProfiles(after).profiles.map((p) => p.id)).toEqual(
      detectProfiles(before).profiles.map((p) => p.id),
    );
    expect(result.sketch.constraints).toBe(sketch.constraints);
    expect(result.sketch.dimensions).toBe(sketch.dimensions);
    expect(Object.keys(result.sketch.entities)).toEqual(
      Object.keys(sketch.entities),
    );
    expect(sketch).toEqual(original);
    expect(() =>
      deformedCanvasSketch(sketch, before, pointId, { x: -10, y: 15 }),
    ).toThrow("reverse line");
    expect(() =>
      deformedCanvasSketch(sketch, before, pointId, { x: 0, y: 0 }),
    ).toThrow("collapse");
    expect(() =>
      deformedCanvasSketch(sketch, before, pointId, { x: 5e-7, y: 15 }),
    ).toThrow("collapse");
    expect(() =>
      deformedCanvasSketch(
        sketch,
        before,
        "lost",
        { x: 30, y: 15 },
        canvasDeformationPlan(sketch, before, pointId),
      ),
    ).toThrow("Point reference lost");
  });
  it.each(["length", "horizontalDistance", "verticalDistance"] as const)(
    "preserves a %s dimension and rejects its blocked coordinate",
    (type) => {
      const f = fixture();
      const refs =
        type === "length"
          ? [f.lines[0].id]
          : type === "horizontalDistance"
            ? [f.points[0].id, f.points[1].id]
            : [f.points[0].id, f.points[3].id];
      const sketch = withCanvasDimension(f.sketch, {
        type,
        refs,
        expression: type === "verticalDistance" ? "10mm" : "20mm",
      });
      const before = solveSketch(sketch, {});
      const target =
        type === "verticalDistance" ? { x: 30, y: 10 } : { x: 20, y: 15 };
      const result = deformedCanvasSketch(sketch, before, f.pointId, target);
      const after = solveSketch(result.sketch, {});
      validateCanvasDeformation(before, after, result.targets);
      expect(after.points[f.pointId]).toMatchObject(target);
      expect(result.sketch.dimensions).toBe(sketch.dimensions);
      expect(() =>
        deformedCanvasSketch(sketch, before, f.pointId, { x: 30, y: 15 }),
      ).toThrow("blocked");
    },
  );
  it("preserves parameter expressions on locked axes and intentionally coincident point identities", () => {
    const f = fixture(),
      point = f.sketch.entities[f.pointId];
    if (point.type !== "point") throw new Error("Point required");
    let sketch: Sketch = {
      ...f.sketch,
      entities: {
        ...f.sketch.entities,
        [point.id]: {
          ...point,
          x: {
            expression: "width",
            unit: "mm",
            parameterRefs: { width: "width-id" },
          },
        },
      },
    };
    const duplicate = addPoint(sketch, "20mm", "10mm");
    sketch = addConstraint(duplicate.sketch, "coincident", {
      pointIds: [f.pointId, duplicate.pointId],
    });
    const parameters = {
      width: { value: 20, unit: "mm", dimension: "length" as const },
    };
    const before = solveSketch(sketch, parameters);
    const result = deformedCanvasSketch(sketch, before, f.pointId, {
      x: 20,
      y: 15,
    });
    const after = solveSketch(result.sketch, parameters);
    validateCanvasDeformation(before, after, result.targets);
    expect(after.points[duplicate.pointId]).toMatchObject({ x: 20, y: 15 });
    expect(result.sketch.entities[f.pointId]).toMatchObject({
      x: { expression: "width" },
    });
    expect(Object.keys(result.sketch.entities)).toEqual(
      Object.keys(sketch.entities),
    );
    expect(() =>
      deformedCanvasSketch(sketch, before, f.pointId, { x: 25, y: 15 }),
    ).toThrow("parameter-bound");
  });
  it("diagnoses unsupported curves/constraints/dimensions, invalid coordinates and missing points", () => {
    const f = fixture();
    const curve = addCircle(f.sketch, f.points[0].id, "1mm").sketch;
    expect(
      canvasDeformationPlan(curve, solveSketch(curve, {}), f.pointId).reason,
    ).toContain("point-and-line");
    const parallel = addConstraint(
      {
        ...f.sketch,
        constraints: f.sketch.constraints.filter(
          (constraint) => constraint.type !== "horizontal",
        ),
      },
      "parallel",
      {
        entityIds: [f.lines[0].id, f.lines[2].id],
      },
    );
    expect(solveSketch(parallel, {}).errors).toEqual([]);
    expect(
      canvasDeformationPlan(parallel, solveSketch(parallel, {}), f.pointId)
        .reason,
    ).toContain("parallel");
    const distance = withCanvasDimension(f.sketch, {
      type: "distance",
      refs: [f.points[0].id, f.points[2].id],
      expression: `${Math.sqrt(500)}mm`,
    });
    expect(
      canvasDeformationPlan(distance, solveSketch(distance, {}), f.pointId)
        .reason,
    ).toContain("distance");
    const before = solveSketch(f.sketch, {});
    expect(canvasDeformationPlan(f.sketch, before, "lost").reason).toContain(
      "lost",
    );
    expect(() =>
      deformedCanvasSketch(f.sketch, before, f.pointId, { x: NaN, y: 10 }),
    ).toThrow("finite");
    expect(() =>
      deformedCanvasSketch(f.sketch, before, f.pointId, { x: 1e9, y: 10 }),
    ).toThrow("within");
  });
  it("enforces the point budget", () => {
    let sketch = { ...createXySketch(), solveMode: "validate" as const };
    let selected = "";
    for (let i = 0; i < 81; i++) {
      const result = addPoint(sketch, `${i}mm`, "0mm");
      sketch = { ...result.sketch, solveMode: "validate" };
      selected = result.pointId;
    }
    expect(
      canvasDeformationPlan(sketch, solveSketch(sketch, {}), selected).reason,
    ).toContain("80 points");
  });
  it("preserves no-op history", () => {
    const f = fixture(),
      { active, before } = open(f.sketch);
    const past = useCadStore.getState().history.past.length;
    commitCanvasDeformation(active, before, f.pointId, { x: 20, y: 10 });
    expect(useCadStore.getState().history.present).toBe(before);
    expect(useCadStore.getState().history.past).toHaveLength(past);
  });
  it("rejects newly coincident points, changed profile topology and solver movement outside the plan", () => {
    const f = fixture(),
      outsider = addPoint(f.sketch, "30mm", "15mm"),
      before = solveSketch(outsider.sketch, {});
    const result = deformedCanvasSketch(outsider.sketch, before, f.pointId, {
      x: 30,
      y: 15,
    });
    expect(() =>
      validateCanvasDeformation(
        before,
        solveSketch(result.sketch, {}),
        result.targets,
      ),
    ).toThrow("coincide");
    const regular = solveSketch(f.sketch, {});
    const altered = {
      ...regular,
      points: {
        ...regular.points,
        [f.points[0].id]: { ...regular.points[f.points[0].id], x: 1 },
      },
    };
    expect(() =>
      validateCanvasDeformation(regular, altered, new Map()),
    ).toThrow("other geometry");
    expect(() =>
      validateCanvasDeformation(regular, { ...regular, lines: [] }, new Map()),
    ).toThrow("profile topology");
    expect(() =>
      validateCanvasDeformation(
        regular,
        {
          ...regular,
          points: { ...regular.points, extra: { id: "extra", x: 50, y: 50 } },
        },
        new Map(),
      ),
    ).toThrow('unexpected point "extra"');
  });
  it("commits one atomic history edit, supports undo/redo and rejects stale sessions without mutation", () => {
    const f = fixture(),
      { active, before } = open(f.sketch);
    const past = useCadStore.getState().history.past.length;
    commitCanvasDeformation(active, before, f.pointId, { x: 30, y: 15 });
    const after = useCadStore.getState().history.present;
    expect(useCadStore.getState().history.past).toHaveLength(past + 1);
    expect(after.sketches[f.sketch.id].constraints).toEqual(
      f.sketch.constraints,
    );
    expect(() =>
      commitCanvasDeformation(active, before, f.pointId, { x: 40, y: 20 }),
    ).toThrow("Project changed during deformation");
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(after);
    useCadStore.getState().setDocument(after);
    expect(() =>
      commitCanvasDeformation(
        active,
        useCadStore.getState().history.present,
        f.pointId,
        { x: 40, y: 20 },
      ),
    ).toThrow("Project or sketch changed");
  });
  it("offers exact keyboard deformation with visible blocked-coordinate diagnostics", () => {
    const f = fixture();
    const sketch = withCanvasDimension(f.sketch, {
      type: "length",
      refs: [f.lines[0].id],
      expression: "20mm",
    });
    open(sketch);
    render(<SketchCanvasPanel />);
    fireEvent.change(screen.getByLabelText("Canvas tool"), {
      target: { value: "deform" },
    });
    fireEvent.change(screen.getByLabelText("Canvas point to move"), {
      target: { value: f.pointId },
    });
    fireEvent.change(screen.getByLabelText("Canvas coordinate X"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Canvas coordinate Y"), {
      target: { value: "15" },
    });
    const before = useCadStore.getState().history.present;
    fireEvent.click(
      screen.getByRole("button", { name: "Deform sketch to coordinate" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "X movement is blocked",
    );
    expect(useCadStore.getState().history.present).toBe(before);
    fireEvent.change(screen.getByLabelText("Canvas coordinate X"), {
      target: { value: "20" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Deform sketch to coordinate" }),
    );
    expect(useCadStore.getState().history.present).not.toBe(before);
    expect(
      solveSketch(
        useCadStore.getState().history.present.sketches[f.sketch.id],
        {},
      ).points[f.pointId],
    ).toMatchObject({ x: 20, y: 15 });
  });
});
