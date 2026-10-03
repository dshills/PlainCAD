import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import type { Sketch } from "../cad/document/schema";
import { validateDocument } from "../cad/document/validate";
import {
  addArc,
  addCircle,
  addLine,
  addPoint,
  createXySketch,
} from "../cad/sketch/SketchModel";
import {
  replaceSketchPointReference,
  setArcDirection,
  sketchPointReferences,
} from "../cad/sketch/entityReferences";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { snapCanvasPoint } from "../cad/sketch/canvasGeometry";
import { canvasContext } from "../ui/commands/sketchCanvasCommand";
import { useCadStore } from "../state/useCadStore";

const initialStore = useCadStore.getState();
afterEach(() => {
  cleanup();
  useCadStore.setState(initialStore, true);
});

function fixture(type: "line" | "circle" | "arc") {
  let sketch = createXySketch("Reference section");
  const points: string[] = [];
  for (const [x, y] of [
    [0, 0],
    [10, 0],
    [0, 10],
  ]) {
    const result = addPoint(sketch, `${x}mm`, `${y}mm`);
    sketch = result.sketch;
    points.push(result.pointId);
  }
  if (type === "line") {
    const result = addLine(sketch, points[1], points[2]);
    return { sketch: result.sketch, id: result.lineId, points };
  }
  if (type === "circle") {
    const result = addCircle(sketch, points[0], "10mm");
    return { sketch: result.sketch, id: result.circleId, points };
  }
  const result = addArc(sketch, points[0], points[1], points[2], false);
  return { sketch: result.sketch, id: result.arcId, points };
}
describe("sketch point reference repair", () => {
  it.each(["line", "circle", "arc"] as const)(
    "opens lost %s references for repair while rejecting malformed IDs",
    (type) => {
      const { sketch, id, points } = fixture(type);
      const field = sketchPointReferences(sketch.entities[id])[0].field;
      const lost: Sketch = {
        ...sketch,
        entities: {
          ...sketch.entities,
          [id]: { ...sketch.entities[id], [field]: "lost-point" },
        },
      };
      const document = upsertSketch(createEmptyDocument(), lost);
      const imported = importProjectText(serializeProject(document));
      expect(imported.sketches[sketch.id].entities[id]).toEqual(
        lost.entities[id],
      );
      expect(validateDocument(imported)).toContainEqual(
        expect.objectContaining({
          sourceId: id,
          message: expect.stringContaining("missing"),
        }),
      );
      const repaired = replaceSketchPointReference(
        imported.sketches[sketch.id],
        id,
        field,
        points[0],
      );
      expect(validateDocument(upsertSketch(imported, repaired))).toEqual([]);
      expect(repaired.entities[id].id).toBe(id);
      expect(lost.entities[id]).toHaveProperty(field, "lost-point");
      for (const malformed of [0, null, {}, "", " "]) {
        const bad = {
          ...lost,
          entities: {
            ...lost.entities,
            [id]: { ...lost.entities[id], [field]: malformed },
          },
        } as unknown as Sketch;
        expect(() =>
          importProjectText(JSON.stringify(upsertSketch(document, bad))),
        ).toThrow(/missing.*point/);
      }
    },
  );
  it.each(["line", "circle", "arc"] as const)(
    "diagnoses lost %s references safely in solving, profile detection and canvas hit testing",
    (type) => {
      const { sketch, id } = fixture(type);
      const field = sketchPointReferences(sketch.entities[id])[0].field;
      const lost: Sketch = {
        ...sketch,
        entities: {
          ...sketch.entities,
          [id]: { ...sketch.entities[id], [field]: "lost-point" },
        },
      };
      const document = importProjectText(
        serializeProject(upsertSketch(createEmptyDocument(), lost)),
      );
      const solved = solveSketch(document.sketches[sketch.id], {});
      expect(solved.errors.length).toBeGreaterThan(0);
      expect(detectProfiles(solved).profiles).toEqual([]);
      expect(() => snapCanvasPoint({ x: 0, y: 0 }, solved, 1, 1)).not.toThrow();
      useCadStore.setState({
        history: { past: [], present: document, future: [] },
        rebuild: { status: "failed", kernelReady: false },
      });
      const active = {
        documentId: document.id,
        session: useCadStore.getState().documentSession,
        sketchId: sketch.id,
      };
      expect(
        canvasContext(active, useCadStore.getState(), true).solved.errors
          .length,
      ).toBeGreaterThan(0);
      expect(() => canvasContext(active)).toThrow("Repair the sketch");
    },
  );
  it("limits replacements to same-sketch points and retains constraint/dimension intent", () => {
    const { sketch, id, points } = fixture("arc");
    const original = {
      ...sketch,
      constraints: [
        {
          id: "fixed",
          type: "fixed" as const,
          entityIds: [],
          pointIds: [points[0]],
        },
      ],
      dimensions: [
        {
          id: "radius",
          type: "radius" as const,
          entityIds: [id],
          expression: { expression: "10mm", unit: "mm" },
        },
      ],
    };
    expect(
      replaceSketchPointReference(
        original,
        id,
        "centerPointId",
        "outside-sketch",
      ),
    ).toBe(original);
    expect(replaceSketchPointReference(original, id, "centerPointId", id)).toBe(
      original,
    );
    expect(
      replaceSketchPointReference(
        original,
        points[0],
        "centerPointId",
        points[1],
      ),
    ).toBe(original);
    expect(
      replaceSketchPointReference(original, id, "centerPointId", points[0]),
    ).toBe(original);
    const reversed = setArcDirection(original, id, true);
    expect(reversed.entities[id]).toMatchObject({ clockwise: true });
    expect(original.entities[id]).toMatchObject({ clockwise: false });
    expect(reversed.constraints).toBe(original.constraints);
    expect(reversed.dimensions).toBe(original.dimensions);
    expect(setArcDirection(reversed, id, true)).toBe(reversed);
    expect(setArcDirection(original, points[0], true)).toBe(original);
  });
  it("offers lost reference repair, point navigation, arc direction and undo without navigation edits", async () => {
    const { sketch, id, points } = fixture("arc");
    const entity = sketch.entities[id];
    if (entity.type !== "arc") throw new Error("Expected arc");
    const lost: Sketch = {
      ...sketch,
      entities: {
        ...sketch.entities,
        [id]: { ...entity, centerPointId: "lost-point" },
      },
    };
    const document = upsertSketch(createEmptyDocument(), lost);
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: {
        selectedIds: [{ kind: "sketchEntity", id, documentId: document.id }],
      },
    });
    render(<InspectorPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Center point reference is missing",
    );
    expect(
      screen.getByRole("button", { name: "Inspect center point" }),
    ).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText("Center point"),
      points[0],
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useCadStore.getState().history.past).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("Clockwise arc"));
    expect(
      useCadStore.getState().history.present.sketches[sketch.id].entities[id],
    ).toMatchObject({ clockwise: true });
    act(() => useCadStore.getState().undo());
    expect(screen.getByLabelText("Clockwise arc")).not.toBeChecked();
    const present = useCadStore.getState().history.present;
    await userEvent.click(
      screen.getByRole("button", { name: "Inspect center point" }),
    );
    expect(screen.getByLabelText("X")).toHaveValue("0mm");
    expect(useCadStore.getState().selection.selectedIds[0].id).toBe(points[0]);
    expect(useCadStore.getState().history.present).toBe(present);
  });
});
