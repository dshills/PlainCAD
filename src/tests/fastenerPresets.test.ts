import { expect, it } from "vitest";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { applyCadCommand } from "../commands/cadCommandOperations";
import { buildSolidDimensionEdit } from "../cad/inspection/solidDimensionEdit";
import { withComponentPlacement } from "../cad/document/componentPlacement";
import { appendProject } from "../persistence/appendProject";
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

it("places a matching nut beside a moved screw and preserves its dependency on insert", () => {
  const { document, result } = applyCadCommand(createEmptyDocument(), {
    command: "cad.hardware.leadScrew", arguments: {
      form: "trapezoidal", hand: "left", starts: 4, diameter: "8mm", pitch: "2mm", screwLength: "18mm",
    },
  });
  const source = document.features[0];
  const moved = withComponentPlacement(document, source.componentId!, { translation: [50, 20, 4], rotation: [0, 0, Math.PI / 2] });
  const pair = applyCadCommand(moved, {
    command: "cad.hardware.leadNut", arguments: { screwFeatureId: result.id!, nutLength: "10mm", clearance: "0.1mm" },
  }).document;
  const nut = pair.features[1];
  expect(pair.components[nut.componentId!].placement).toEqual({ translation: [50, 34, 4], rotation: [0, 0, Math.PI / 2] });
  const reopened = importProjectText(serializeProject(pair));
  const inserted = appendProject(createEmptyDocument(), reopened).document.features;
  expect(inserted[1]).toMatchObject({ type: "leadNut", screwFeatureId: inserted[0].id });
  expect(inserted[0].id).not.toBe(source.id);

  const changeScrew = (changes: { suppressed: boolean } | { pitch: string }) => applyCadCommand(pair, {
    command: "cad.feature.update", arguments: { featureId: source.id, ...changes },
  });
  expect(() => changeScrew({ suppressed: true })).toThrow(/suppress the matching nuts/i);
  expect(() => changeScrew({ pitch: "2.2mm" })).toThrow(/suppress that nut.*updated dimensions/i);
  expect(() => applyCadCommand(document, {
    command: "cad.hardware.leadNut", arguments: { screwFeatureId: result.id!, nutLength: "10mm", clearance: "0.22mm" },
  })).toThrow(/2.5% and 10%/i);
});

it("accepts the exact minimum matching nut clearance in millimeters", () => {
  const { document, result } = applyCadCommand(createEmptyDocument(), {
    command: "cad.hardware.leadScrew", arguments: {
      form: "acme", hand: "right", starts: 1, diameter: "18mm", pitch: "6mm", screwLength: "36mm",
    },
  });
  const nut = applyCadCommand(document, {
    command: "cad.hardware.leadNut", arguments: { screwFeatureId: result.id!, nutLength: "30mm", clearance: "0.15mm" },
  }).document.features.at(-1);
  expect(nut).toMatchObject({ type: "leadNut", clearance: { expression: "0.15mm" } });
});
