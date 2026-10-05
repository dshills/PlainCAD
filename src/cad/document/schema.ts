export const CURRENT_SCHEMA_VERSION = 13;

export type UnitSystem = "metric" | "imperial";

export interface UnitSettings {
  length: "mm" | "cm" | "m" | "in" | "ft";
  angle: "deg" | "rad";
  mass?: "g" | "kg" | "lb";
}

export interface CadDocument {
  schemaVersion: number;
  id: string;
  name: string;
  units: UnitSystem;
  unitSettings: UnitSettings;
  /** Presentation only; never reinterpret already-authored expressions. */
  displayUnits?: UnitSettings;
  createdAt: string;
  updatedAt: string;
  timelineCursor?: number;
  rootComponentId: string;
  components: Record<string, CadComponent>;
  parameters: Record<string, CadParameter>;
  sketches: Record<string, Sketch>;
  features: Feature[];
  viewState?: ViewState;
  metadata?: Record<string, unknown>;
}

/** Internal parts share the project origin; assembly transforms are not supported. */
export interface CadComponent {
  id: string;
  name: string;
}

export interface CadParameter {
  id: string;
  name: string;
  expression: string;
  /** Unit applied to a final scalar result. Absence preserves legacy strict behavior. */
  authoredUnit?: string;
  parameterRefs?: Record<string, string>;
  value: number;
  unit: string;
  description?: string;
  group?: string;
  locked?: boolean;
}

export interface ExpressionRef {
  expression: string;
  authoredUnit?: string;
  parameterRefs?: Record<string, string>;
  resolvedValue?: number;
  unit: string;
}

export type OriginPlane = "XY" | "XZ" | "YZ";

export type SketchPlaneReference =
  | { type: "origin"; plane: OriginPlane }
  | {
      type: "offset";
      base: OriginPlane | FacePlaneReference;
      offset: ExpressionRef;
    }
  | FacePlaneReference;

export interface FacePlaneReference {
  type: "face";
  featureId: string;
  stableFaceId: string;
  lost?: boolean;
}

export interface Sketch {
  componentId?: string;
  id: string;
  name: string;
  plane: SketchPlaneReference;
  timelineStep?: number;
  createdAt?: string;
  entities: Record<string, SketchEntity>;
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
  /** Version 6 and earlier dimensions were checks; migration preserves that intent. */
  solveMode?: "driving" | "validate";
  solveRevision?: number;
}

export type SketchEntity = SketchPoint | SketchLine | SketchCircle | SketchArc;

export interface SketchPoint {
  id: string;
  type: "point";
  x: ExpressionRef;
  y: ExpressionRef;
  construction?: boolean;
}

export interface SketchLine {
  id: string;
  type: "line";
  startPointId: string;
  endPointId: string;
  construction?: boolean;
}

export interface SketchCircle {
  id: string;
  type: "circle";
  centerPointId: string;
  radius: ExpressionRef;
  construction?: boolean;
}

export interface SketchArc {
  id: string;
  type: "arc";
  centerPointId: string;
  startPointId: string;
  endPointId: string;
  clockwise: boolean;
  construction?: boolean;
}

export type ConstraintType =
  | "fixed"
  | "horizontal"
  | "vertical"
  | "coincident"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "equalLength"
  | "equalRadius"
  | "midpoint"
  | "symmetric";

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];
  /** Point references used by point-based constraints such as coincident, midpoint, and symmetric. */
  pointIds?: string[];
}

export interface SketchDimension {
  id: string;
  type:
    | "length"
    | "radius"
    | "diameter"
    | "horizontalDistance"
    | "verticalDistance"
    | "distance"
    | "angle";
  entityIds: string[];
  pointIds?: string[];
  expression: ExpressionRef;
}

export interface FeatureBase {
  componentId?: string;
  id: string;
  name: string;
  type: string;
  suppressed?: boolean;
  timelineStep?: number;
  createdAt?: string;
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketchId: string;
  profileId: string;
  operation: "newBody" | "join" | "cut";
  distance: ExpressionRef;
  termination?: ExtrudeTermination;
  targetBodyIds?: string[];
  direction: "positive" | "negative" | "symmetric";
}

export type ExtrudeTermination =
  | { type: "distance"; distance?: ExpressionRef }
  | { type: "throughAll" }
  | { type: "toFace"; faceRef: TopologyRef };

export type RevolveAxisReference =
  | { type: "origin"; axis: "X" | "Y" | "Z" }
  | { type: "sketchLine"; sketchId: string; lineId: string };

export interface RevolveFeature extends FeatureBase {
  type: "revolve";
  sketchId: string;
  profileId: string;
  axis: RevolveAxisReference;
  operation: "newBody" | "join" | "cut";
  angle: ExpressionRef;
  targetBodyIds?: string[];
}

export interface HoleFeature extends FeatureBase {
  type: "hole";
  /** Absence preserves legacy drilling along the positive sketch normal. */
  direction?: "positive" | "negative";
  targetFeatureId?: string;
  targetBodyId?: string;
  /** Explicit scope is authoritative, including an empty scope. Legacy single IDs remain readable. */
  targetBodyIds?: string[];
  sketchId: string;
  centerPointIds: string[];
  diameter: ExpressionRef;
  depth: ExpressionRef | "throughAll";
}

export interface FilletFeature extends FeatureBase {
  type: "fillet";
  targetEdgeRefs: TopologyRef[];
  radius: ExpressionRef;
}

export interface ChamferFeature extends FeatureBase {
  type: "chamfer";
  targetEdgeRefs: TopologyRef[];
  distance: ExpressionRef;
}

export type Feature =
  | ExtrudeFeature
  | RevolveFeature
  | HoleFeature
  | FilletFeature
  | ChamferFeature;

export interface TopologyRef {
  featureId: string;
  kind: "face" | "edge" | "vertex";
  transientId: string;
  stableHint?: string;
  role?: "profileEdge" | "startCapPerimeter" | "endCapPerimeter" | "planarFace";
  sourceEntityId?: string;
  adjacentRole?: "sideFace" | "startCap" | "endCap";
  repairRequired?: boolean;
}

export interface CameraPose {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraUp: [number, number, number];
}
export interface NamedView extends CameraPose { id: string; name: string }
export interface ViewState {
  namedViews?: NamedView[];
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
}

export interface ValidationIssue {
  source: "document" | "parameter" | "sketch" | "feature";
  sourceId?: string;
  message: string;
}

export interface SelectionState {
  selectedIds: SelectionRef[];
  hoveredId?: SelectionRef;
}

export interface SelectionRef {
  kind:
    | "sketchEntity"
    | "feature"
    | "body"
    | "face"
    | "edge"
    | "vertex"
    | "parameter"
    | "sketch";
  id: string;
  documentId: string;
}
