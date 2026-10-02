import { describe, expect, it, vi } from "vitest";
import { upsertSketch, createEmptyDocument } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import * as solver from "../cad/sketch/SketchSolver";
import * as profiles from "../cad/sketch/profileDetection";
import { useCadStore } from "../state/useCadStore";
import {
  selectCommandEnablement,
  runCommand,
} from "../ui/commands/commandRegistry";

import {
  addCircleAt,
  addPoint,
  addLine,
  setConstruction,
  createXySketch,
} from "../cad/sketch/SketchModel";

describe("sketch commands", () => {
  it("creates an XY sketch and adds helper geometry to the selected sketch", () => {
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
    });

    runCommand("sketch.createXY");
    const sketch = Object.values(
      useCadStore.getState().history.present.sketches,
    )[0];
    expect(sketch).toBeDefined();
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({
      kind: "sketch",
      id: sketch.id,
    });

    runCommand("sketch.addCenterRectangle");
    runCommand("sketch.addCircle");
    const updated = useCadStore.getState().history.present.sketches[sketch.id];
    expect(
      Object.values(updated.entities).filter(
        (entity) => entity.type === "line",
      ),
    ).toHaveLength(4);
    expect(
      Object.values(updated.entities).filter(
        (entity) => entity.type === "circle",
      ),
    ).toHaveLength(1);
  });

  it("creates sketches on XZ and YZ origin planes", () => {
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
    });

    runCommand("sketch.createXZ");
    runCommand("sketch.createYZ");

    const sketches = Object.values(
      useCadStore.getState().history.present.sketches,
    );
    expect(sketches.map((sketch) => sketch.plane)).toEqual([
      { type: "origin", plane: "XZ" },
      { type: "origin", plane: "YZ" },
    ]);
  });

  it("adds helper geometry to the parent sketch when an entity is selected", () => {
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
    });
    runCommand("sketch.createXY");
    runCommand("sketch.addCircle");
    const sketch = Object.values(
      useCadStore.getState().history.present.sketches,
    )[0];
    const point = Object.values(sketch.entities).find(
      (entity) => entity.type === "point",
    );
    expect(point).toBeDefined();

    useCadStore
      .getState()
      .select({ kind: "sketchEntity", id: point!.id, documentId: document.id });
    runCommand("sketch.addCircle");

    const sketches = Object.values(
      useCadStore.getState().history.present.sketches,
    );
    expect(sketches).toHaveLength(1);
    expect(
      Object.values(sketches[0].entities).filter(
        (entity) => entity.type === "circle",
      ),
    ).toHaveLength(2);
  });

  it("creates, suppresses, and deletes an extrude feature from commands", () => {
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
    });

    runCommand("sketch.createXY");
    runCommand("sketch.addCenterRectangle");
    runCommand("feature.extrude");

    const feature = useCadStore.getState().history.present.features[0];
    expect(feature).toMatchObject({
      type: "extrude",
      operation: "newBody",
      direction: "positive",
    });
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({
      kind: "feature",
      id: feature.id,
    });

    runCommand("feature.suppress");
    expect(useCadStore.getState().history.present.features[0].suppressed).toBe(
      true,
    );

    runCommand("feature.delete");
    expect(useCadStore.getState().history.present.features).toHaveLength(0);
    expect(useCadStore.getState().selection.selectedIds).toHaveLength(0);
  });
  it("enables offset-plane revolve only when a usable stable axis exists", () => {
    let sketch = addCircleAt(createXySketch(), "10mm", "0mm", "2mm");
    sketch = {
      ...sketch,
      plane: {
        type: "offset",
        base: "XY",
        offset: { expression: "20mm", unit: "mm" },
      },
    };
    const document = upsertSketch(createEmptyDocument(), sketch);
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: {
        selectedIds: [
          { kind: "sketch", id: sketch.id, documentId: document.id },
        ],
      },
    });
    expect(selectCommandEnablement(useCadStore.getState()).createRevolve).toBe(
      false,
    );
    const a = addPoint(sketch, "0mm", "-5mm"),
      b = addPoint(a.sketch, "0mm", "5mm"),
      line = addLine(b.sketch, a.pointId, b.pointId);
    sketch = setConstruction(line.sketch, line.lineId, true);
    useCadStore.getState().updateDocument((d) => upsertSketch(d, sketch));
    expect(selectCommandEnablement(useCadStore.getState()).createRevolve).toBe(
      true,
    );
    runCommand("feature.revolve");
    expect(useCadStore.getState().history.present.features[0]).toMatchObject({
      type: "revolve",
      axis: { type: "sketchLine", sketchId: sketch.id, lineId: line.lineId },
    });
  });
  it("uses the current worker analysis without solving in command selectors", () => {
    const sketch = addCircleAt(createXySketch(), "10mm", "0mm", "2mm");
    const document = upsertSketch(createEmptyDocument(), sketch);
    const result = rebuildDocument(document);
    const state = {
      ...useCadStore.getState(),
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
      rebuild: { status: "succeeded" as const, kernelReady: true, result },
    };
    vi.stubGlobal("Worker", class {});
    const solve = vi.spyOn(solver, "solveSketch");
    const detect = vi.spyOn(profiles, "detectProfiles");
    try {
      expect(
        selectCommandEnablement({
          ...state,
          rebuild: { ...state.rebuild, status: "queued" },
        }).createExtrude,
      ).toBe(false);
      expect(
        selectCommandEnablement({
          ...state,
          rebuild: { ...state.rebuild, result: { ...result, profiles: {} } },
        }).createExtrude,
      ).toBe(false);
      expect(selectCommandEnablement(state)).toMatchObject({
        createExtrude: true,
        createRevolve: true,
      });
      expect(
        selectCommandEnablement({
          ...state,
          rebuild: {
            ...state.rebuild,
            status: "failed",
            result: {
              ...result,
              success: false,
              errors: [
                {
                  id: "unrelated-feature",
                  source: "feature",
                  message: "Feature failed",
                },
              ],
            },
          },
        }),
      ).toMatchObject({
        createExtrude: true,
        createRevolve: true,
        exportStl: false,
      });
      expect(solve).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
    } finally {
      solve.mockRestore();
      detect.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
