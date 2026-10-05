import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { useCadStore } from "../state/useCadStore";
import { HoleFeatureControls } from "../ui/panels/HoleFeatureControls";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";

beforeEach(() => useCadStore.setState(useCadStore.getInitialState(), true));
afterEach(() => useCadStore.setState(useCadStore.getInitialState(), true));
function Inspector() {
  const feature = useCadStore((state) =>
    state.history.present.features.find((f) => f.id === "hole"),
  );
  return feature?.type === "hole" ? (
    <HoleFeatureControls feature={feature} />
  ) : null;
}
it("defaults legacy Hole direction to positive and commits a durable negative selection with one Undo", () => {
  const point = addPoint(createXySketch("Centers"), "0mm", "0mm");
  const base = createBoxTemplate();
  const document = upsertFeature(upsertSketch(base, point.sketch), {
    id: "hole",
    name: "Drill",
    type: "hole",
    sketchId: point.sketch.id,
    centerPointIds: [point.pointId],
    targetBodyIds: [`body:${base.features[0].id}`],
    diameter: { expression: "2mm", unit: "mm" },
    depth: { expression: "3mm", unit: "mm" },
  });
  useCadStore.getState().setDocument(document);
  const before = useCadStore.getState().history.present;
  render(<Inspector />);
  expect(screen.getByLabelText("Hole direction")).toHaveValue("positive");
  fireEvent.change(screen.getByLabelText("Hole direction"), {
    target: { value: "negative" },
  });
  const after = useCadStore.getState().history.present;
  expect(screen.getByLabelText("Hole direction")).toHaveValue("negative");
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(after.sketches).toEqual(before.sketches);
  expect(after.parameters).toEqual(before.parameters);
  expect(after.features.find((f) => f.id === "hole")).toMatchObject({
    id: "hole",
    direction: "negative",
    centerPointIds: [point.pointId],
    targetBodyIds: [`body:${base.features[0].id}`],
    diameter: { expression: "2mm" },
    depth: { expression: "3mm" },
  });
  expect(
    importProjectText(serializeProject(after)).features.find(
      (f) => f.id === "hole",
    ),
  ).toMatchObject({ direction: "negative" });
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(before);
  expect(screen.getByLabelText("Hole direction")).toHaveValue("positive");
  act(() => useCadStore.getState().redo());
  expect(useCadStore.getState().history.present).toBe(after);
  expect(screen.getByLabelText("Hole direction")).toHaveValue("negative");
});
