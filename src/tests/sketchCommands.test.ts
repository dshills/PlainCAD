import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import { runCommand } from "../ui/commands/commandRegistry";

describe("sketch commands", () => {
  it("creates an XY sketch and adds helper geometry to the selected sketch", () => {
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
    });

    runCommand("sketch.createXY");
    const sketch = Object.values(useCadStore.getState().history.present.sketches)[0];
    expect(sketch).toBeDefined();
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({ kind: "sketch", id: sketch.id });

    runCommand("sketch.addCenterRectangle");
    runCommand("sketch.addCircle");
    const updated = useCadStore.getState().history.present.sketches[sketch.id];
    expect(Object.values(updated.entities).filter((entity) => entity.type === "line")).toHaveLength(4);
    expect(Object.values(updated.entities).filter((entity) => entity.type === "circle")).toHaveLength(1);
  });

  it("adds helper geometry to the parent sketch when an entity is selected", () => {
    const document = createEmptyDocument();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
    });
    runCommand("sketch.createXY");
    runCommand("sketch.addCircle");
    const sketch = Object.values(useCadStore.getState().history.present.sketches)[0];
    const point = Object.values(sketch.entities).find((entity) => entity.type === "point");
    expect(point).toBeDefined();

    useCadStore.getState().select({ kind: "sketchEntity", id: point!.id, documentId: document.id });
    runCommand("sketch.addCircle");

    const sketches = Object.values(useCadStore.getState().history.present.sketches);
    expect(sketches).toHaveLength(1);
    expect(Object.values(sketches[0].entities).filter((entity) => entity.type === "circle")).toHaveLength(2);
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
    expect(feature).toMatchObject({ type: "extrude", operation: "newBody", direction: "positive" });
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({ kind: "feature", id: feature.id });

    runCommand("feature.suppress");
    expect(useCadStore.getState().history.present.features[0].suppressed).toBe(true);

    runCommand("feature.delete");
    expect(useCadStore.getState().history.present.features).toHaveLength(0);
    expect(useCadStore.getState().selection.selectedIds).toHaveLength(0);
  });
});
