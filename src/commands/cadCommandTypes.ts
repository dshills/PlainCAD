import type { CanvasPoint, CanvasTool } from "../cad/sketch/canvasGeometry";
import type { CanvasSizeInput } from "../cad/sketch/sizedCanvasGeometry";
import type { OriginPlane, SketchDimension, UnitSettings } from "../cad/document/schema";
import type { SupportedEdgeRole } from "../cad/features/topologyRefs";

type Named = { name?: string; as?: string };
type Point = { x: string; y: string };
type SketchGeometry = { sketchId: string; construction?: boolean; as?: string };
type Endpoint<Name extends string> = { [Key in Name]: Point } | { [Key in `${Name}PointId`]: string };
type Operation = "newBody" | "join" | "cut";
type Direction = "positive" | "negative" | "symmetric";
type FeatureInput = Named & { sketchId: string; profileId?: string; operation?: Operation; targetBodyIds?: string[] };
type Edge = { featureId: string; role: SupportedEdgeRole; sourceEntityId?: string };
type AuthoredUnit = "" | UnitSettings["length"] | UnitSettings["angle"];
/** Compile-time counterparts of the strict catalog schemas. JSON callers are
 * still validated at runtime; IDs and $aliases share the string representation. */
export type CadCommandArguments = {
  "cad.parameter.add": { name: string; expression: string; authoredUnit?: AuthoredUnit; group?: string; as?: string };
  "cad.parameter.update": { parameterId: string; name?: string; expression?: string; authoredUnit?: AuthoredUnit; group?: string };
  "cad.component.create": { name: string; as?: string };
  "cad.component.rename": { componentId: string; name: string };
  "cad.component.place": { componentId: string; translation: [number, number, number]; rotation: [number, number, number] };
  "cad.sketch.create": { name: string; plane: OriginPlane; componentId?: string; offset?: string; as?: string };
  "cad.sketch.draw": SketchGeometry & { tool: CanvasTool; points: CanvasPoint[]; clockwise?: boolean; sizes?: CanvasSizeInput };
  "cad.sketch.point": SketchGeometry & { point: Point };
  "cad.sketch.rectangle": SketchGeometry & { width: string; height: string; origin?: Point };
  "cad.sketch.circle": SketchGeometry & { center: Point; radius: string };
  "cad.sketch.line": SketchGeometry & Endpoint<"start"> & Endpoint<"end">;
  "cad.sketch.arc": SketchGeometry & Endpoint<"center"> & Endpoint<"start"> & Endpoint<"end"> & { clockwise?: boolean };
  "cad.sketch.construction": { sketchId: string; entityIds: string[]; construction: boolean };
  "cad.sketch.dimension": { sketchId: string; type: SketchDimension["type"]; refs: string[]; expression: string; authoredUnit?: AuthoredUnit; dimensionId?: string; as?: string };
  "cad.sketch.deleteEntities": { sketchId: string; entityIds: string[] };
  "cad.feature.extrude": FeatureInput & { distance: string; direction?: Direction };
  "cad.feature.revolve": FeatureInput & { angle: string; axis?: "X" | "Y" | "Z"; axisLineId?: string };
  "cad.feature.hole": Named & { sketchId: string; centerPointIds: string[]; targetBodyIds: string[]; diameter: string; direction?: "positive" | "negative" } & ({ depth: string; throughAll?: false } | { throughAll: true });
  "cad.feature.fillet": Named & { edges: Edge[]; radius: string };
  "cad.feature.chamfer": Named & { edges: Edge[]; distance: string };
  "cad.feature.update": { featureId: string; name?: string; suppressed?: boolean; distance?: string; angle?: string; diameter?: string; radius?: string; depth?: string; throughAll?: boolean; direction?: Direction; operation?: Operation; targetBodyIds?: string[]; axis?: "X" | "Y" | "Z" };
  "cad.feature.delete": { featureId: string };
};
export type TypedCadCommandCall = { [Id in keyof CadCommandArguments]: { command: Id; arguments: CadCommandArguments[Id] } }[keyof CadCommandArguments];
