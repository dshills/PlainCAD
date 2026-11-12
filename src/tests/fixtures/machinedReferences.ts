import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../../cad/document/CadDocument";
import { pocketFloorId } from "../../cad/document/faceReferences";
import type { CadDocument, FacePlaneReference } from "../../cad/document/schema";
import { addCanvasGeometry } from "../../cad/sketch/canvasGeometry";
import { addPoint, createSketchOnPlane } from "../../cad/sketch/SketchModel";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { stableFaceId } from "../../cad/sketch/planes";
import { detectProfiles } from "../../cad/sketch/profileDetection";

export const stockBodyId = "body:machined-stock";
export const pocketFloorRef: FacePlaneReference = { type: "face", featureId: "machined-pocket", stableFaceId: pocketFloorId("machined-pocket") };
export const rimId = "hole:machined-hole:entrance";
export const expectedVolume = (depth = 6, diameter = 4) => 60 * 40 * 20 - 12 * 8 * depth - Math.PI * (diameter / 2) ** 2 * 20;

function rectangle(name: string, plane: "XY" | FacePlaneReference, x: number, y: number, width: number, height: number) {
  const empty = createSketchOnPlane(name, plane);
  const { sketch } = addCanvasGeometry(empty, solveSketch(empty, {}), "rectangle", [{ x, y }, { x: x + width, y: y + height }]);
  return { sketch, profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id };
}

export function machinedReferenceFixture(placed = true) {
  let document = upsertParameter(upsertParameter(createEmptyDocument("Machined references"), {
    id: "pocket-depth-param", name: "pocketDepth", expression: "6mm", value: 6, unit: "mm",
  }), { id: "bore-size-param", name: "boreSize", expression: "4mm", value: 4, unit: "mm" });
  if (placed) document = { ...document, components: { ...document.components, [document.rootComponentId]: {
    ...document.components[document.rootComponentId], placement: { translation: [7, -3, 5], rotation: [0, 0, Math.PI / 2] },
  } } };
  const stock = rectangle("Stock outline", "XY", 0, 0, 60, 40);
  document = upsertFeature(upsertSketch(document, stock.sketch), { ...createExtrudeFeature({
    name: "Stock", sketchId: stock.sketch.id, profileId: stock.profileId, distance: { expression: "20mm", unit: "mm" },
    direction: "positive", operation: "newBody",
  }), id: "machined-stock" });
  const top: FacePlaneReference = { type: "face", featureId: "machined-stock", stableFaceId: stableFaceId("machined-stock", "endCap") };
  const pocket = rectangle("Pocket outline", top, 12, 12, 12, 8);
  document = upsertFeature(upsertSketch(document, pocket.sketch), { ...createExtrudeFeature({
    name: "Blind pocket", sketchId: pocket.sketch.id, profileId: pocket.profileId, distance: { expression: "pocketDepth", unit: "mm" },
    direction: "negative", operation: "cut", targetBodyIds: [stockBodyId],
  }), id: "machined-pocket" });
  const hole = addPoint(createSketchOnPlane("Bore center", top), "45mm", "25mm");
  document = upsertFeature(upsertSketch(document, hole.sketch), {
    id: "machined-hole", name: "Drilled hole", type: "hole", sketchId: hole.sketch.id, direction: "negative",
    centerPointIds: [hole.pointId], diameter: { expression: "boreSize", unit: "mm" }, depth: "throughAll", targetBodyIds: [stockBodyId],
  });
  return { document, holeSketch: hole.sketch, holePointId: hole.pointId };
}

export function trimPocketFloor(document: CadDocument) {
  const center = addPoint(createSketchOnPlane("Floor trimming bore", "XY"), "18mm", "16mm");
  return upsertFeature(upsertSketch(document, center.sketch), {
    id: "trim-floor", name: "Drill through the floor", type: "hole", sketchId: center.sketch.id, direction: "positive",
    centerPointIds: [center.pointId], diameter: { expression: "3mm", unit: "mm" }, depth: "throughAll", targetBodyIds: [stockBodyId],
  });
}
