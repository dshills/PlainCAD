import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import {
  canvasConstraintAnnotations,
  MAX_CANVAS_CONSTRAINT_REFERENCES,
  withCanvasConstraintReferences,
} from "../cad/sketch/canvasConstraints";
import {
  addConstraint,
  addPoint,
  createXySketch,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { useCadStore } from "../state/useCadStore";
import {
  beginSketchCanvas,
  commitCanvasConstraintReferences,
  useSketchCanvas,
} from "../ui/commands/sketchCanvasCommand";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import type { ConstraintType } from "../cad/document/schema";

function fixture() {
  const empty = createXySketch(),
    sketch = addCanvasGeometry(empty, solveSketch(empty, {}), "rectangle", [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
    ]).sketch;
  const lines = Object.values(sketch.entities).filter((e) => e.type === "line");
  return { sketch, lines };
}
beforeEach(() => {
  useCadStore.getState().setDocument(createEmptyDocument());
  useSketchCanvas.setState({ active: undefined });
});
afterEach(cleanup);
describe("drawing constraint annotations and repair", () => {
  it("anchors every supported constraint type to its current referenced geometry", () => {
    const { sketch: base, lines } = fixture();
    let sketch = addCanvasGeometry(base, solveSketch(base, {}), "circle", [
      { x: 0, y: 5 },
      { x: 5, y: 5 },
    ]).sketch;
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "circle", [
      { x: 0, y: 15 },
      { x: 5, y: 15 },
    ]).sketch;
    const circles = Object.values(sketch.entities).filter(
      (e) => e.type === "circle",
    );
    const solved = solveSketch(sketch, {}),
      pointIds = Object.values(solved.points);
    const origin = pointIds.find((p) => p.x === 0 && p.y === 0)!.id;
    const duplicate = addPoint(sketch, "0mm", "0mm"),
      midpoint = addPoint(duplicate.sketch, "10mm", "0mm"),
      axisStart = addPoint(midpoint.sketch, "10mm", "-5mm"),
      axisEnd = addPoint(axisStart.sketch, "10mm", "5mm");
    sketch = axisEnd.sketch;
    const refs: Record<
      ConstraintType,
      { entityIds?: string[]; pointIds?: string[] }
    > = {
      fixed: { entityIds: [circles[0].id] },
      coincident: { pointIds: [origin, duplicate.pointId] },
      horizontal: { entityIds: [lines[0].id] },
      vertical: { entityIds: [lines[1].id] },
      parallel: { entityIds: [lines[0].id, lines[2].id] },
      perpendicular: { entityIds: [lines[0].id, lines[1].id] },
      tangent: { entityIds: [lines[0].id, circles[0].id] },
      equalLength: { entityIds: [lines[0].id, lines[2].id] },
      equalRadius: { entityIds: circles.map((c) => c.id) },
      midpoint: { entityIds: [lines[0].id], pointIds: [midpoint.pointId] },
      symmetric: {
        pointIds: [
          origin,
          lines[0].endPointId,
          axisStart.pointId,
          axisEnd.pointId,
        ],
      },
    };
    for (const type of [
      "fixed",
      "coincident",
      "horizontal",
      "vertical",
      "parallel",
      "perpendicular",
      "tangent",
      "equalLength",
      "equalRadius",
      "midpoint",
      "symmetric",
    ] as ConstraintType[]) {
      const authored = addConstraint(sketch, type, refs[type]);
      expect(
        withCanvasConstraintReferences(
          authored,
          authored.constraints[0].id,
          refs[type].entityIds ?? [],
          refs[type].pointIds ?? [],
        ),
      ).toBe(authored);
      const current = solveSketch(authored, {});
      expect(current.errors).toEqual([]);
      const annotation = canvasConstraintAnnotations(authored, current, 100)[0];
      expect(annotation.state).toBe("satisfied");
      expect(annotation.position).toBeDefined();
      expect(annotation.anchors).toHaveLength(
        (refs[type].entityIds?.length ?? 0) +
          (refs[type].pointIds?.length ?? 0),
      );
      expect(
        annotation.anchors.every(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
      ).toBe(true);
      expect(annotation.title).toContain(type);
    }
  });
  it("hides anchors while pending and leaves missing references in the repairable list", () => {
    const { sketch, lines } = fixture(),
      constrained = addConstraint(sketch, "horizontal", {
        entityIds: [lines[0].id],
      });
    const solved = solveSketch(constrained, {});
    expect(
      canvasConstraintAnnotations(constrained, solved, 100, true)[0],
    ).toMatchObject({ state: "pending", position: undefined, anchors: [] });
    const lost = {
      ...constrained,
      entities: Object.fromEntries(
        Object.entries(constrained.entities).filter(
          ([id]) => id !== lines[0].id,
        ),
      ),
    };
    const annotation = canvasConstraintAnnotations(
      lost,
      solveSketch(lost, {}),
      100,
    )[0];
    expect(annotation).toMatchObject({
      state: "lost",
      position: undefined,
      anchors: [],
    });
    expect(annotation.title).toContain("reference lost");
  });
  it("reports actual conflicting and redundant solver results without showing other intent as satisfied after failure", () => {
    const { sketch, lines } = fixture();
    const fixed = addConstraint(sketch, "fixed", {
      pointIds: Object.values(sketch.entities)
        .filter((e) => e.type === "point")
        .map((e) => e.id),
    });
    const bad = addConstraint(fixed, "vertical", { entityIds: [lines[0].id] }),
      solved = solveSketch(bad, {});
    expect(solved.errors.some((e) => e.severity === "error")).toBe(true);
    const annotations = canvasConstraintAnnotations(bad, solved, 100);
    expect(annotations.some((a) => a.state === "conflicting")).toBe(true);
    expect(annotations.some((a) => a.state === "satisfied")).toBe(false);
    const first = addConstraint(sketch, "horizontal", {
        entityIds: [lines[0].id],
      }),
      duplicate = addConstraint(first, "horizontal", {
        entityIds: [lines[0].id],
      });
    const redundant = solveSketch(duplicate, {});
    expect(
      canvasConstraintAnnotations(duplicate, redundant, 100).some(
        (a) => a.state === "redundant",
      ),
    ).toBe(true);
  });
  it("preserves constraint identity, type and ordered references during explicit repair", () => {
    const { sketch, lines } = fixture(),
      original = addConstraint(sketch, "horizontal", {
        entityIds: [lines[0].id],
      }),
      c = original.constraints[0];
    const repaired = withCanvasConstraintReferences(
      original,
      c.id,
      [lines[2].id],
      [],
    );
    expect(repaired.constraints[0]).toMatchObject({
      id: c.id,
      type: c.type,
      entityIds: [lines[2].id],
    });
    expect(repaired.entities).toBe(original.entities);
    expect(() =>
      withCanvasConstraintReferences(original, c.id, ["missing"], []),
    ).toThrow("lost");
    expect(() =>
      withCanvasConstraintReferences(original, c.id, [], []),
    ).toThrow("Choose geometry");
    expect(() =>
      withCanvasConstraintReferences(
        original,
        c.id,
        [lines[0].id, lines[0].id],
        [],
      ),
    ).toThrow("distinct");
    expect(() =>
      withCanvasConstraintReferences(
        original,
        c.id,
        [lines[0].startPointId],
        [],
      ),
    ).toThrow("One or more lines");
    expect(() =>
      withCanvasConstraintReferences(
        original,
        c.id,
        [lines[0].id],
        [lines[0].startPointId],
      ),
    ).toThrow("no point references");
    expect(() =>
      withCanvasConstraintReferences(
        original,
        c.id,
        Array.from(
          { length: MAX_CANVAS_CONSTRAINT_REFERENCES + 1 },
          (_, i) => `ref${i}`,
        ),
        [],
      ),
    ).toThrow("reference limit");
    const symmetric = addConstraint(sketch, "symmetric", {
        pointIds: lines.map((l) => l.startPointId),
      }),
      constraint = symmetric.constraints[0],
      ordered = [...constraint.pointIds!].reverse();
    expect(
      withCanvasConstraintReferences(symmetric, constraint.id, [], ordered)
        .constraints[0].pointIds,
    ).toEqual(ordered);
  });
  it("repairs and deletes through one undoable edit, while rejecting stale document/session actions", () => {
    const { sketch, lines } = fixture(),
      constrained = addConstraint(sketch, "horizontal", {
        entityIds: [lines[0].id],
      }),
      c = constrained.constraints[0];
    const doc = upsertSketch(createEmptyDocument(), constrained);
    useCadStore.getState().setDocument(doc);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: doc.id });
    beginSketchCanvas();
    const active = useSketchCanvas.getState().active!,
      before = useCadStore.getState().history.present;
    commitCanvasConstraintReferences(active, before, c.id, {
      entityIds: [lines[2].id],
      pointIds: [],
    });
    const after = useCadStore.getState().history.present;
    commitCanvasConstraintReferences(active, after, c.id, {
      entityIds: [lines[2].id],
      pointIds: [],
    });
    expect(useCadStore.getState().history.present).toBe(after);
    expect(after.sketches[sketch.id].constraints[0].entityIds).toEqual([
      lines[2].id,
    ]);
    expect(() =>
      commitCanvasConstraintReferences(active, before, c.id),
    ).toThrow("changed");
    commitCanvasConstraintReferences(active, after, c.id);
    expect(
      useCadStore.getState().history.present.sketches[sketch.id].constraints,
    ).toEqual([]);
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(after);
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().setDocument(before);
    expect(() =>
      commitCanvasConstraintReferences(
        active,
        useCadStore.getState().history.present,
        c.id,
      ),
    ).toThrow("Reopen");
  });
  it("lets users inspect and remove a lost constraint without inventing a marker at the origin", () => {
    const { sketch, lines } = fixture(),
      constrained = addConstraint(sketch, "horizontal", {
        entityIds: ["missing-line"],
      });
    const document = upsertSketch(createEmptyDocument(), constrained);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginSketchCanvas();
    render(createElement(SketchCanvasPanel));
    const before = useCadStore.getState().history.present;
    fireEvent.click(
      screen.getByRole("button", {
        name: /Inspect canvas constraint C1 H — lost/,
      }),
    );
    expect(useCadStore.getState().history.present).toBe(before);
    expect(
      screen.queryByRole("button", { name: /Inspect drawing constraint/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Canvas constraint entity 1"), {
      target: { value: lines[0].startPointId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply constraint references" }),
    );
    expect(
      screen
        .getAllByRole("alert")
        .some((e) => e.textContent?.includes("horizontal references")),
    ).toBe(true);
    expect(useCadStore.getState().history.present).toBe(before);
    fireEvent.change(screen.getByLabelText("Canvas constraint entity 1"), {
      target: { value: lines[0].id },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply constraint references" }),
    );
    expect(
      useCadStore.getState().history.present.sketches[sketch.id].constraints[0]
        .entityIds,
    ).toEqual([lines[0].id]);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete canvas constraint" }),
    );
    expect(
      useCadStore.getState().history.present.sketches[sketch.id].constraints,
    ).toEqual([]);
  });
});
