import type { CommandDescriptor } from "./registry";
import type { CadCommandArguments } from "./cadCommandTypes";
import { FASTENER_SIZES } from "../cad/hardware/fastenerCatalog";
import { aliasSchema, arraySchema, commandSchemaJson, enumSchema, expressionSchema, nameSchema, objectSchema, pointSchema, referenceSchema, type CommandSchema } from "./commandSchemas";

const bool: CommandSchema = { type: "boolean" };
const lengthUnit = enumSchema(["mm", "cm", "m", "in", "ft"]);
const unit = enumSchema(["", "mm", "cm", "m", "in", "ft", "deg", "rad"]);
const operation = enumSchema(["newBody", "join", "cut"]);
const direction = enumSchema(["positive", "negative", "symmetric"]);
const shellOpening = enumSchema(["startCap", "endCap"]);
const fastenerSize = enumSchema(FASTENER_SIZES.map(size => size.id));
const holePreset = objectSchema({ size: fastenerSize, kind: enumSchema(["clearance", "tapDrill"]) }, ["size", "kind"]);
const vector = arraySchema({ type: "number", minimum: -1e8, maximum: 1e8 }, 3, 3);
const rotation = arraySchema({ type: "number", minimum: -2 * Math.PI, maximum: 2 * Math.PI }, 3, 3);
const refs = arraySchema(referenceSchema);
const edges = arraySchema(objectSchema({ featureId: referenceSchema, role: enumSchema(["profileEdge", "startCapPerimeter", "endCapPerimeter"]), sourceEntityId: referenceSchema }, ["featureId", "role"]));
const featureProperties = { name: nameSchema, sketchId: referenceSchema, profileId: referenceSchema, operation, targetBodyIds: refs, as: aliasSchema };
const endFace = { featureId: referenceSchema, stableFaceId: referenceSchema };
const termination: CommandSchema = {
  ...objectSchema({ type: enumSchema(["throughAll", "toFace"]), ...endFace }, ["type"]),
  description: "Choose Through All without a face, or To Face with featureId and stableFaceId.",
  oneOf: [objectSchema({ type: enumSchema(["throughAll"]) }, ["type"]),
    objectSchema({ type: enumSchema(["toFace"]), ...endFace }, ["type", "featureId", "stableFaceId"])],
};
const extrusionFields = { ...featureProperties, direction };
const pocketFields = { name: nameSchema, sketchId: referenceSchema, profileId: referenceSchema, targetBodyId: referenceSchema, as: aliasSchema };
const throughAll: CommandSchema = { type: "boolean", enum: [true], description: "Use true instead of distance to cut through the explicit body." };
const pocketRequired = ["sketchId", "targetBodyId"];
const holeFields = { name: nameSchema, sketchId: referenceSchema, centerPointIds: refs, targetBodyIds: refs, depth: expressionSchema, throughAll: bool, direction: enumSchema(["positive", "negative"]), as: aliasSchema };
const holeRequired = ["sketchId", "centerPointIds", "targetBodyIds"];
const canvasPoint = objectSchema({ x: { type: "number", minimum: -1e8, maximum: 1e8 }, y: { type: "number", minimum: -1e8, maximum: 1e8 }, pointId: referenceSchema }, ["x", "y"]);
export const CAD_COMMAND_SCHEMAS = {
  "cad.parameter.add": objectSchema({ name: nameSchema, expression: expressionSchema, authoredUnit: unit, group: nameSchema, as: aliasSchema }, ["name", "expression"]),
  "cad.parameter.update": objectSchema({ parameterId: referenceSchema, name: nameSchema, expression: expressionSchema, authoredUnit: unit, group: nameSchema }, ["parameterId"]),
  "cad.component.create": objectSchema({ name: nameSchema, as: aliasSchema }, ["name"]),
  "cad.component.rename": objectSchema({ componentId: referenceSchema, name: nameSchema }, ["componentId", "name"]),
  "cad.component.place": objectSchema({ componentId: referenceSchema, translation: vector, rotation }, ["componentId", "translation", "rotation"]),
  "cad.sketch.create": objectSchema({ name: nameSchema, componentId: referenceSchema, plane: enumSchema(["XY", "XZ", "YZ"]), offset: expressionSchema, as: aliasSchema }, ["name", "plane"]),
  "cad.sketch.createOnFace": objectSchema({ name: nameSchema, componentId: referenceSchema, featureId: referenceSchema, stableFaceId: referenceSchema, as: aliasSchema }, ["name", "featureId", "stableFaceId"]),
  "cad.sketch.draw": objectSchema({ sketchId: referenceSchema, tool: enumSchema(["point", "line", "rectangle", "circle", "arc"]), points: arraySchema(canvasPoint, 3), construction: bool, clockwise: bool, sizes: objectSchema({ width: expressionSchema, height: expressionSchema, diameter: expressionSchema, rectangleMode: enumSchema(["corner", "center"]) }), as: aliasSchema }, ["sketchId", "tool", "points"]),
  "cad.sketch.point": objectSchema({ sketchId: referenceSchema, point: pointSchema, construction: bool, as: aliasSchema }, ["sketchId", "point"]),
  "cad.sketch.rectangle": objectSchema({ sketchId: referenceSchema, origin: pointSchema, width: expressionSchema, height: expressionSchema, construction: bool, as: aliasSchema }, ["sketchId", "width", "height"]),
  "cad.sketch.circle": objectSchema({ sketchId: referenceSchema, center: pointSchema, radius: expressionSchema, construction: bool, as: aliasSchema }, ["sketchId", "center", "radius"]),
  "cad.sketch.line": objectSchema({ sketchId: referenceSchema, start: pointSchema, end: pointSchema, startPointId: referenceSchema, endPointId: referenceSchema, construction: bool, as: aliasSchema }, ["sketchId"]),
  "cad.sketch.arc": objectSchema({ sketchId: referenceSchema, center: pointSchema, start: pointSchema, end: pointSchema, centerPointId: referenceSchema, startPointId: referenceSchema, endPointId: referenceSchema, clockwise: bool, construction: bool, as: aliasSchema }, ["sketchId"]),
  "cad.sketch.construction": objectSchema({ sketchId: referenceSchema, entityIds: refs, construction: bool }, ["sketchId", "entityIds", "construction"]),
  "cad.sketch.dimension": objectSchema({ sketchId: referenceSchema, dimensionId: referenceSchema, type: enumSchema(["length", "radius", "diameter", "horizontalDistance", "verticalDistance", "distance", "angle"]), refs, expression: expressionSchema, authoredUnit: unit, as: aliasSchema }, ["sketchId", "type", "refs", "expression"]),
  "cad.sketch.deleteEntities": objectSchema({ sketchId: referenceSchema, entityIds: refs }, ["sketchId", "entityIds"]),
  "cad.feature.extrude": {
    ...objectSchema({ ...extrusionFields, distance: expressionSchema, termination }, ["sketchId"]),
    description: "Provide distance or termination, exclusively.",
    oneOf: [objectSchema({ ...extrusionFields, distance: expressionSchema }, ["sketchId", "distance"]),
      objectSchema({ ...extrusionFields, termination }, ["sketchId", "termination"])],
  },
  "cad.feature.pocket": {
    ...objectSchema({ ...pocketFields, distance: expressionSchema, throughAll }, pocketRequired),
    description: "Provide pocket distance or throughAll: true, exclusively.",
    oneOf: [objectSchema({ ...pocketFields, distance: expressionSchema }, [...pocketRequired, "distance"]),
      objectSchema({ ...pocketFields, throughAll }, [...pocketRequired, "throughAll"])],
  },
  "cad.feature.revolve": objectSchema({ ...featureProperties, angle: expressionSchema, axis: enumSchema(["X", "Y", "Z"]), axisLineId: referenceSchema }, ["sketchId", "angle"]),
  "cad.feature.hole": {
    ...objectSchema({ ...holeFields, diameter: expressionSchema, preset: holePreset }, holeRequired),
    oneOf: [
      objectSchema({ ...holeFields, diameter: expressionSchema }, [...holeRequired, "diameter"]),
      objectSchema({ ...holeFields, preset: holePreset }, [...holeRequired, "preset"]),
    ],
  },
  "cad.hardware.fastener": objectSchema({ size: fastenerSize, length: expressionSchema, name: nameSchema, as: aliasSchema }, ["size", "length"]),
  "cad.feature.fillet": objectSchema({ name: nameSchema, edges, radius: expressionSchema, as: aliasSchema }, ["edges", "radius"]),
  "cad.feature.chamfer": objectSchema({ name: nameSchema, edges, distance: expressionSchema, as: aliasSchema }, ["edges", "distance"]),
  "cad.feature.shell": objectSchema({ name: nameSchema, sourceFeatureId: referenceSchema, opening: shellOpening, wallThickness: expressionSchema, as: aliasSchema }, ["sourceFeatureId", "opening", "wallThickness"]),
  "cad.feature.update": objectSchema({ featureId: referenceSchema, name: nameSchema, suppressed: bool, distance: expressionSchema, angle: expressionSchema, diameter: expressionSchema, preset: holePreset, radius: expressionSchema, depth: expressionSchema, throughAll: bool, direction, operation, targetBodyIds: refs, axis: enumSchema(["X", "Y", "Z"]), opening: shellOpening, wallThickness: expressionSchema }, ["featureId"]),
  "cad.feature.delete": objectSchema({ featureId: referenceSchema }, ["featureId"]),
} as const satisfies Record<keyof CadCommandArguments, CommandSchema>;
export type CadCommandId = keyof typeof CAD_COMMAND_SCHEMAS;
export type { CadCommandArguments, TypedCadCommandCall } from "./cadCommandTypes";
export const CAD_COMMANDS: CommandDescriptor[] = (Object.keys(CAD_COMMAND_SCHEMAS) as CadCommandId[]).map(id => ({
  id, label: id.replace("cad.", "").replaceAll(".", " "), kind: "domain", source: "src/commands/cadCommandOperations.ts",
  description: id === "cad.feature.pocket" ? "Plan-only inward cut from a supported face sketch into its explicit body. Provide distance or throughAll: true. Native preview must reduce volume and leave one solid." :
    id === "cad.hardware.fastener" ? "Plan-only socket-head fastener blank with a smooth shaft, named size and length below the head." :
    id === "cad.feature.shell" ? "Plan-only native Shell. Choose one supported rectangular extrusion cap and inward wall thickness; Apply requires a valid cavity proof." :
    "Immutable semantic CAD edit. Geometry requires a successful current native rebuild; use command plans for preview and one-step Undo.",
  input: commandSchemaJson(CAD_COMMAND_SCHEMAS[id]),
}));
export function isCadCommandId(value: string): value is CadCommandId { return Object.hasOwn(CAD_COMMAND_SCHEMAS, value); }
export { lengthUnit };
