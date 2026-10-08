import type { CadDocument, ExpressionRef, FeaturePatternSettings } from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";
import { featurePatternTransforms, patternSource } from "./featurePattern";
import type { ProfileLoop, SketchProfile } from "../sketch/profileDetection";
import { transformPoint, type Point3 } from "../sketch/planes";

export interface PatternControlInput {
  sourceFeatureId: string; type: "linear" | "circular"; count: string;
  spacing: string; direction: "X" | "Y"; angle: string; centerX: string; centerY: string;
}
export interface PatternPoint { x: number; y: number }
export interface PatternControlModel {
  outlines: PatternPoint[][][];
  centers: PatternPoint[];
  worldCenters: Point3[];
  center: PatternPoint;
  sweep: number;
  spacing: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}
const MAX_OUTLINE_VERTICES = 16384;
const CIRCLE_OUTLINE_POINTS = 48;
const ARC_OUTLINE_POINTS = 32;
function checkOutlineBudget(sourceVertices: number, copies: number) {
  if (sourceVertices * copies > MAX_OUTLINE_VERTICES) throw new Error("Pattern outline is too complex for drag controls. Use the numeric fields.");
}
function outlinePointCount(loop: ProfileLoop) {
  return loop.type === "circle" ? CIRCLE_OUTLINE_POINTS : (loop.segments ?? []).reduce((size, segment) => size + (segment.type === "arc" ? ARC_OUTLINE_POINTS : 1), 0);
}
function outlinePoints(loop: ProfileLoop, profile: SketchProfile): PatternPoint[] {
  if (loop.type === "circle") {
    const hole = profile.holes.find(value => loop.entityIds.includes(value.id));
    if (loop !== profile.outerLoop && !hole) throw new Error("Source inner circle geometry is unavailable.");
    const radius = hole?.radius ?? (profile.bounds.maxX - profile.bounds.minX) / 2;
    const x = hole?.x ?? (profile.bounds.maxX + profile.bounds.minX) / 2, y = hole?.y ?? (profile.bounds.maxY + profile.bounds.minY) / 2;
    return Array.from({ length: CIRCLE_OUTLINE_POINTS }, (_, i) => ({ x: x + radius * Math.cos(i * 2 * Math.PI / CIRCLE_OUTLINE_POINTS), y: y + radius * Math.sin(i * 2 * Math.PI / CIRCLE_OUTLINE_POINTS) }));
  }
  if (!loop.segments?.length) throw new Error("Source profile boundary is unavailable.");
  return loop.segments.flatMap(segment => segment.type === "line" ? [segment.start] : Array.from({ length: ARC_OUTLINE_POINTS }, (_, i) => ({ x: segment.center.x + segment.radius * Math.cos(segment.startAngle + segment.sweep * i / ARC_OUTLINE_POINTS), y: segment.center.y + segment.radius * Math.sin(segment.startAngle + segment.sweep * i / ARC_OUTLINE_POINTS) })));
}
export type PatternDragField = "spacing" | "angle" | "centerX" | "centerY";
function retainedExpression(settings: FeaturePatternSettings | undefined, field: "count" | PatternDragField): ExpressionRef | undefined {
  if (!settings) return;
  if (field === "count") return settings.count;
  if (settings.type === "linear") return field === "spacing" ? settings.spacing : undefined;
  return field === "angle" ? settings.angle : field === "centerX" ? settings.centerX : field === "centerY" ? settings.centerY : undefined;
}
/** Literal recognition deliberately excludes arithmetic and parameters: dragging
 * an expression requires explicit replacement consent in the UI. */
export function patternFieldIsLiteral(expression: string) {
  return /^\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*(?:mm|cm|m|in|ft|deg|rad)?\s*$/.test(expression);
}
export function draggedPatternLiteral(value: number, angle = false) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error("Dragged pattern value is outside the supported range.");
  return `${(angle ? value * 180 / Math.PI : value).toFixed(6)}${angle ? "deg" : "mm"}`;
}
/** Unwrap pointer angles across the +/-pi boundary, retaining the drag's sign. */
export function draggedPatternSweep(previous: number, pointerAngle: number, previousPointerAngle: number) {
  const delta = Math.atan2(Math.sin(pointerAngle - previousPointerAngle), Math.cos(pointerAngle - previousPointerAngle));
  return Math.max(-2 * Math.PI, Math.min(2 * Math.PI, previous + delta));
}
export function patternControlModel(document: CadDocument, input: PatternControlInput, result: RebuildResult, retained?: FeaturePatternSettings): PatternControlModel {
  if (result.documentId !== document.id) throw new Error("Pattern source geometry is stale.");
  const source = patternSource(document, input.sourceFeatureId), solved = result.solvedSketches?.[source.sketchId], plane = result.sketchPlanes?.[source.sketchId];
  if (!solved || solved.errors.length || !plane) throw new Error("Wait for resolved source sketch geometry before dragging.");
  const parameters = result.parameterValues ?? evaluateParameters(document.parameters).values;
  const ref = (field: keyof Pick<PatternControlInput, "count" | PatternDragField>, dimension: "length" | "angle" | "scalar"): ExpressionRef => {
    const existing = retainedExpression(retained, field);
    return existing?.expression.trim() === input[field].trim() ? existing : { expression: input[field], unit: dimension === "length" ? "mm" : dimension === "angle" ? "deg" : "", authoredUnit: dimension === "length" ? document.unitSettings.length : dimension === "angle" ? document.unitSettings.angle : "" };
  };
  const read = (field: PatternDragField, dimension: "length" | "angle") => {
    const value = evaluateExpressionRef(ref(field, dimension), { parameters });
    if (value.error || value.quantity?.dimension !== dimension || !Number.isFinite(value.quantity.value)) throw new Error(value.error ?? `Pattern ${field} must resolve to a finite ${dimension}.`);
    return value.quantity.value;
  };
  const center = input.type === "circular" ? { x: read("centerX", "length"), y: read("centerY", "length") } : { x: 0, y: 0 };
  const sweep = input.type === "circular" ? read("angle", "angle") : 0, spacing = input.type === "linear" ? read("spacing", "length") : 0;
  const settings: FeaturePatternSettings = input.type === "linear" ? { type: "linear", count: ref("count", "scalar"), spacing: ref("spacing", "length"), direction: input.direction } : { type: "circular", count: ref("count", "scalar"), angle: ref("angle", "angle"), centerX: ref("centerX", "length"), centerY: ref("centerY", "length") };
  const transforms = featurePatternTransforms(settings, plane, parameters);
  let loops: PatternPoint[][];
  let anchor: PatternPoint;
  if (source.type === "hole") {
    checkOutlineBudget(CIRCLE_OUTLINE_POINTS, transforms.length);
    const point = solved.points[source.centerPointIds[0]], diameter = evaluateExpressionRef(source.diameter, { parameters });
    if (!point || diameter.quantity?.dimension !== "length" || diameter.quantity.value <= 0) throw new Error("Source hole center or diameter is unavailable.");
    anchor = { x: point.x, y: point.y };
    loops = [Array.from({ length: CIRCLE_OUTLINE_POINTS }, (_, i) => ({ x: point.x + diameter.quantity!.value / 2 * Math.cos(i * 2 * Math.PI / CIRCLE_OUTLINE_POINTS), y: point.y + diameter.quantity!.value / 2 * Math.sin(i * 2 * Math.PI / CIRCLE_OUTLINE_POINTS) }))];
  } else {
    const profile = result.profiles?.[source.sketchId]?.find(value => value.id === source.profileId || value.alternateIds?.includes(source.profileId));
    if (!profile) throw new Error("Source cut profile is unavailable.");
    const boundaries = [profile.outerLoop, ...profile.innerLoops];
    checkOutlineBudget(boundaries.reduce((sum, loop) => sum + outlinePointCount(loop), 0), transforms.length);
    loops = boundaries.map(loop => outlinePoints(loop, profile));
    anchor = { x: (profile.bounds.minX + profile.bounds.maxX) / 2, y: (profile.bounds.minY + profile.bounds.maxY) / 2 };
  }
  const toLocal = (point: Point3): PatternPoint => {
    const offset = { x: point.x - plane.origin.x, y: point.y - plane.origin.y, z: point.z - plane.origin.z };
    return { x: offset.x * plane.u.x + offset.y * plane.u.y + offset.z * plane.u.z, y: offset.x * plane.v.x + offset.y * plane.v.y + offset.z * plane.v.z };
  };
  const worldCenters = transforms.map(transform => transformPoint(transform, anchor.x, anchor.y));
  const centers = worldCenters.map(toLocal), outlines = transforms.map(transform => loops.map(loop => loop.map(point => toLocal(transformPoint(transform, point.x, point.y)))));
  const points = [...outlines.flat(2), ...(input.type === "circular" ? [center] : [])];
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e8 || Math.abs(point.y) > 1e8)) throw new Error("Pattern control coordinates are outside the supported range.");
  return { outlines, centers, worldCenters, center, sweep, spacing, bounds: { minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)) } };
}
