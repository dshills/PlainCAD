export const CURRENT_SCHEMA_VERSION = 1;

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
  createdAt: string;
  updatedAt: string;
  parameters: Record<string, CadParameter>;
  sketches: Record<string, Sketch>;
  features: Feature[];
  viewState?: ViewState;
  metadata?: Record<string, unknown>;
}

export interface CadParameter {
  id: string;
  name: string;
  expression: string;
  value: number;
  unit: string;
  description?: string;
  locked?: boolean;
}

export interface ExpressionRef {
  expression: string;
  resolvedValue?: number;
  unit: string;
}

export interface Sketch {
  id: string;
  name: string;
  plane: "XY";
  entities: Record<string, SketchEntity>;
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
}

export type SketchEntity = SketchPoint | SketchLine | SketchCircle;

export interface SketchPoint {
  id: string;
  type: "point";
  x: ExpressionRef;
  y: ExpressionRef;
}

export interface SketchLine {
  id: string;
  type: "line";
  startPointId: string;
  endPointId: string;
}

export interface SketchCircle {
  id: string;
  type: "circle";
  centerPointId: string;
  radius: ExpressionRef;
}

export type ConstraintType =
  | "fixed"
  | "horizontal"
  | "vertical"
  | "coincident"
  | "equalLength"
  | "equalRadius";

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];
  pointIds?: string[];
}

export interface SketchDimension {
  id: string;
  type: "length" | "radius" | "diameter" | "horizontalDistance" | "verticalDistance";
  entityIds: string[];
  expression: ExpressionRef;
}

export type Feature = ExtrudeFeature | HoleFeature | FilletFeature | ChamferFeature;

export interface FeatureBase {
  id: string;
  name: string;
  type: string;
  suppressed?: boolean;
  createdAt: string;
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketchId: string;
  profileId: string;
  operation: "newBody" | "join" | "cut";
  distance: ExpressionRef;
  direction: "positive" | "negative" | "symmetric";
}

export interface HoleFeature extends FeatureBase {
  type: "hole";
  targetFeatureId: string;
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

export interface TopologyRef {
  featureId: string;
  kind: "face" | "edge" | "vertex";
  transientId: string;
  stableHint?: string;
}

export interface ViewState {
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
  kind: "sketchEntity" | "feature" | "body" | "face" | "edge" | "vertex" | "parameter" | "sketch";
  id: string;
  documentId: string;
}
