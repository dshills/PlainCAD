import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertParameter,
  upsertSketch,
} from "../src/cad/document/CadDocument";
import {
  addCornerRectangle,
  addCircleAt,
  createXySketch,
} from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";

export const WARMUP = 5,
  TRIALS = 20,
  EXPORT_WARMUP = 1,
  EXPORT_TRIALS = 10;
export function nativeBenchmarkDocument() {
  let doc = upsertParameter(createEmptyDocument("Native rebuild benchmark"), {
    id: "parameter_width",
    name: "width",
    expression: "60mm",
    value: 60,
    unit: "mm",
  });
  const base = addCornerRectangle(
    createXySketch("Benchmark base"),
    "width",
    "40mm",
  );
  const tool = addCircleAt(
    createXySketch("Benchmark cut"),
    "10mm",
    "20mm",
    "3mm",
  );
  doc = upsertSketch(upsertSketch(doc, base), tool);
  const profile = (sketch: typeof base) =>
    detectProfiles(
      solveSketch(sketch, {
        width: { value: 60, unit: "mm", dimension: "length" },
      }),
    ).profiles[0].id;
  const extrude = createExtrudeFeature({
    name: "Benchmark solid",
    sketchId: base.id,
    profileId: profile(base),
    operation: "newBody",
    direction: "positive",
    distance: { expression: "12mm", unit: "mm" },
  });
  doc = upsertFeature(doc, extrude);
  doc = upsertFeature(
    doc,
    createExtrudeFeature({
      name: "Benchmark subtraction",
      sketchId: tool.id,
      profileId: profile(tool),
      operation: "cut",
      targetBodyIds: [`body:${extrude.id}`],
      termination: { type: "throughAll" },
      direction: "positive",
      distance: { expression: "12mm", unit: "mm" },
    }),
  );
  return doc;
}
