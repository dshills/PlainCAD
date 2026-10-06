import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../src/cad/document/CadDocument";
import { addCornerRectangle, addPoint, createXySketch } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { stableBodyIdForFeature } from "../src/cad/features/featureGraph";
import { createExtrudeEdgeRef } from "../src/cad/features/topologyRefs";

export type WorkbenchOperation = "Extrude" | "Revolve" | "Hole" | "Fillet" | "Chamfer";

/** Portable authored fixtures imported through the public file UI in the built app.
 * No browser store access, test kernel or development diagnostics are required. */
export function workbenchTaskFixture(operation: WorkbenchOperation) {
  let document = createEmptyDocument(`Workbench ${operation}`);
  const sketch = addCornerRectangle(createXySketch("Section"), operation === "Revolve" ? "5mm" : "24mm", operation === "Revolve" ? "10mm" : "16mm");
  document = upsertSketch(document, sketch);
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  if (!profile) throw new Error(`Workbench ${operation} fixture did not produce a closed rectangle profile.`);
  const profileId = profile.id;
  if (operation === "Revolve") {
    return upsertFeature(document, { id: "qa_revolve", name: "Sweep", type: "revolve", sketchId: sketch.id,
      profileId, axis: { type: "origin", axis: "Y" }, operation: "newBody", angle: { expression: "360deg", unit: "deg" } });
  }
  const base = createExtrudeFeature({ name: "Base", sketchId: sketch.id, profileId, operation: "newBody",
    distance: { expression: "8mm", unit: "mm" }, direction: "positive" });
  document = upsertFeature(document, base);
  if (operation === "Extrude") return document;
  if (operation === "Hole") {
    const point = addPoint(createXySketch("Drill center"), "12mm", "8mm");
    return upsertFeature(upsertSketch(document, point.sketch), { id: "qa_hole", name: "Drill", type: "hole",
      sketchId: point.sketch.id, centerPointIds: [point.pointId], targetBodyIds: [stableBodyIdForFeature(base.id)],
      diameter: { expression: "2mm", unit: "mm" }, depth: "throughAll" });
  }
  const refs = [createExtrudeEdgeRef(base.id, "endCapPerimeter")];
  return upsertFeature(document, operation === "Fillet"
    ? { id: "qa_fillet", name: "Round", type: "fillet", targetEdgeRefs: refs, radius: { expression: "1mm", unit: "mm" } }
    : { id: "qa_chamfer", name: "Bevel", type: "chamfer", targetEdgeRefs: refs, distance: { expression: "1mm", unit: "mm" } });
}
