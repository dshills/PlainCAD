import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../cad/document/CadDocument";
import { CadDocument, CadParameter } from "../cad/document/schema";
import { createId } from "../cad/document/ids";
import { addCenterRectangle, addCircleAt, createXySketch } from "../cad/sketch/SketchModel";

function parameter(name: string, expression: string): CadParameter {
  return { id: createId("param"), name, expression, value: 0, unit: "mm" };
}

export function createBoxTemplate(): CadDocument {
  let document = createEmptyDocument("Parametric Box");
  document = upsertParameter(document, parameter("width", "80mm"));
  document = upsertParameter(document, parameter("height", "50mm"));
  document = upsertParameter(document, parameter("depth", "20mm"));
  let sketch = createXySketch("Box Base");
  sketch = addCenterRectangle(sketch, "width", "height");
  document = upsertSketch(document, sketch);
  document = upsertFeature(
    document,
    createExtrudeFeature({
      name: "Box Extrude",
      sketchId: sketch.id,
      profileId: `${sketch.id}:profile:rectangle`,
      operation: "newBody",
      distance: { expression: "depth", unit: "mm" },
      direction: "positive",
    }),
  );
  return document;
}

export function createMountingPlateTemplate(): CadDocument {
  let document = createEmptyDocument("Mounting Plate");
  for (const item of [
    ["plate_width", "80mm"],
    ["plate_height", "50mm"],
    ["plate_thickness", "5mm"],
    ["hole_diameter", "3.2mm"],
    ["hole_offset_x", "10mm"],
    ["hole_offset_y", "10mm"],
  ] as const) {
    document = upsertParameter(document, parameter(item[0], item[1]));
  }
  let sketch = createXySketch("Plate Sketch");
  sketch = addCenterRectangle(sketch, "plate_width", "plate_height");
  const radius = "hole_diameter / 2";
  sketch = addCircleAt(sketch, "-plate_width / 2 + hole_offset_x", "-plate_height / 2 + hole_offset_y", radius);
  sketch = addCircleAt(sketch, "plate_width / 2 - hole_offset_x", "-plate_height / 2 + hole_offset_y", radius);
  sketch = addCircleAt(sketch, "plate_width / 2 - hole_offset_x", "plate_height / 2 - hole_offset_y", radius);
  sketch = addCircleAt(sketch, "-plate_width / 2 + hole_offset_x", "plate_height / 2 - hole_offset_y", radius);
  document = upsertSketch(document, sketch);
  document = upsertFeature(
    document,
    createExtrudeFeature({
      name: "Plate Extrude",
      sketchId: sketch.id,
      profileId: `${sketch.id}:profile:rectangle`,
      operation: "newBody",
      distance: { expression: "plate_thickness", unit: "mm" },
      direction: "positive",
    }),
  );
  return document;
}
