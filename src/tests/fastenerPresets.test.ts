import { expect, it } from "vitest";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { upsertSketch } from "../cad/document/CadDocument";
import { applyCadCommand } from "../commands/cadCommandOperations";
import { buildSolidDimensionEdit } from "../cad/inspection/solidDimensionEdit";
import { stableBodyIdForFeature } from "../cad/document/ids";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject } from "../persistence/exportProject";
import { createBoxTemplate } from "../templates/templates";

it("retains an inch tap-drill preset across save/open and clears it on a custom diameter edit", () => {
  const box = createBoxTemplate();
  const { sketch, pointId } = addPoint(createXySketch("Centers"), "0mm", "0mm");
  const { document, result } = applyCadCommand(upsertSketch(box, sketch), {
    command: "cad.feature.hole",
    arguments: { sketchId: sketch.id, targetBodyIds: [stableBodyIdForFeature(box.features[0].id)],
      centerPointIds: [pointId], preset: { size: "4-40", kind: "tapDrill" }, throughAll: true },
  });
  const saved = serializeProject(document);
  const reopened = importProjectText(saved);
  expect(reopened.features.at(-1)).toMatchObject({ preset: { size: "4-40", kind: "tapDrill" }, diameter: { expression: "0.089in" } });
  expect(buildSolidDimensionEdit(reopened, result.id!, "diameter", { kind: "feature" }, "3mm").features.at(-1))
    .toMatchObject({ preset: undefined, diameter: { expression: "3mm" } });
  expect(() => importProjectText(saved.replace("0.089in", "0.1in"))).toThrow(/preset and diameter/i);
});
