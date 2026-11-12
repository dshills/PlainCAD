import { createExtrudeFeature, nowIso, upsertFeature, upsertSketch } from "../document/CadDocument";
import { addComponent } from "../document/components";
import { createId, stableBodyIdForFeature } from "../document/ids";
import type { CadDocument, ExpressionRef, RevolveFeature, Sketch } from "../document/schema";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";
import { detectProfiles } from "../sketch/profileDetection";
import { addLine, addPoint, createSketchOnPlane } from "../sketch/SketchModel";
import { solveSketch } from "../sketch/SketchSolver";
import { fastenerSize } from "./fastenerCatalog";

function polygon(sketch: Sketch, vertices: readonly (readonly [string, string])[]) {
  const points = vertices.map(([x, y]) => {
    const point = addPoint(sketch, x, y);
    sketch = point.sketch;
    return point.pointId;
  });
  for (const [index, id] of points.entries()) sketch = addLine(sketch, id, points[(index + 1) % points.length]).sketch;
  return sketch;
}

function closedProfile(sketch: Sketch, document: CadDocument) {
  const solved = solveSketch(sketch, evaluateParameters(document.parameters).values);
  const { profiles } = detectProfiles(solved);
  if (profiles.length !== 1) throw new Error("The fastener dimensions did not produce one closed profile.");
  return profiles[0].id;
}

export function validateFastenerLength(document: CadDocument, length: ExpressionRef) {
  const evaluated = evaluateExpressionRef(length, { parameters: evaluateParameters(document.parameters).values });
  if (evaluated.error || evaluated.quantity?.dimension !== "length" || !(evaluated.quantity.value >= .1 && evaluated.quantity.value <= 1000))
    throw new Error("Fastener length below the head must be between 0.1 and 1000 mm.");
}

/** Editable revolved blank with a blind hex socket. Length is measured below the head. */
export function addFastenerBlank(document: CadDocument, sizeId: string, length: ExpressionRef, name?: string) {
  const size = fastenerSize(sizeId);
  if (!size) throw new Error("Choose a supported fastener size.");
  validateFastenerLength(document, length);
  const { component, document: withComponent } = addComponent(document, name ?? `${size.label} socket-head blank`);
  const [headDiameter, headHeight, acrossFlats, socketDepth] = size.head;
  const inUnit = (value: number) => `${value.toFixed(10)}${size.unit}`;
  const radius = inUnit(size.diameter / 2), headRadius = inUnit(headDiameter / 2);
  // Preserve the user's authoring unit even if the document default changes.
  const shaftEnd = { ...length, expression: `-(${length.expression})` };
  let outline = polygon({ ...createSketchOnPlane("Fastener profile", "XZ"), componentId: component.id }, [
    ["0mm", shaftEnd.expression], [radius, shaftEnd.expression], [radius, "0mm"],
    [headRadius, "0mm"], [headRadius, inUnit(headHeight)], ["0mm", inUnit(headHeight)],
  ]);
  outline = { ...outline, entities: Object.fromEntries(Object.entries(outline.entities).map(([id, entity]) => [id,
    entity.type === "point" && entity.y.expression === shaftEnd.expression ? { ...entity, y: shaftEnd } : entity,
  ])) };
  const blank: RevolveFeature = { id: createId("feature"), createdAt: nowIso(), type: "revolve", name: "Screw blank",
    sketchId: outline.id, profileId: closedProfile(outline, document), componentId: component.id,
    operation: "newBody", axis: { type: "origin", axis: "Z" }, angle: { expression: "360deg", unit: "deg" } };
  const bodyId = stableBodyIdForFeature(blank.id);
  const socket = polygon({ ...createSketchOnPlane("Hex socket", { type: "offset", base: "XY", offset: { expression: inUnit(headHeight), unit: "mm" } }), componentId: component.id },
    Array.from({ length: 6 }, (_, i) => {
      const angle = i * Math.PI / 3, corner = acrossFlats / Math.sqrt(3);
      return [inUnit(corner * Math.cos(angle)), inUnit(corner * Math.sin(angle))] as const;
    }));
  const recess = createExtrudeFeature({ name: "Hex socket", sketchId: socket.id, profileId: closedProfile(socket, document),
    componentId: component.id, operation: "cut", targetBodyIds: [bodyId], direction: "negative", distance: { expression: inUnit(socketDepth), unit: "mm" } });
  return { document: upsertFeature(upsertSketch(upsertFeature(upsertSketch(withComponent, outline), blank), socket), recess),
    id: component.id, featureId: blank.id, bodyId };
}
