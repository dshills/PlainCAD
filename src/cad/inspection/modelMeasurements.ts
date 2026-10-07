import type { CadDocument } from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import type { Point3 } from "../sketch/planes";
import { sketchPlaneChoices } from "../sketch/planePicking";
import { individualCapOperationGeometry } from "../features/operationTargetGeometry";
import { measureSketchEntity, measureWorldPoint, pointDistance, MeasurementError, type EntityMeasurement } from "./measurements";
import { transformPoint } from "../sketch/planes";
import { sampleArc } from "../sketch/profileDetection";

export interface ModelMeasurementTarget {
  id: string;
  label: string;
  kind: "point" | "curve" | "face";
  sketchId?: string;
  bodyId?: string;
  paths: Point3[][];
  closed?: boolean;
  point?: Point3;
  direction?: Point3;
  curve?: EntityMeasurement;
  plane?: { origin: Point3; normal: Point3 };
}
export const MEASUREMENT_TARGET_LIMIT = 1024;
export const MEASUREMENT_VERTEX_LIMIT = 65536;
const MAX_PATH_POINTS = 8192;
const CIRCLE_PATH_POINTS = 128;
let targetCache: { document: WeakRef<CadDocument>; result: WeakRef<RebuildResult>; targets: ModelMeasurementTarget[] } | undefined;
/** Display sampling is only for picking/highlighting. Values come from solved
 * analytic entities and current native-validated original topology, never mesh chords. */
export function modelMeasurementTargets(document: CadDocument, result: RebuildResult): ModelMeasurementTarget[] {
  if (!result.success || result.documentId !== document.id) return [];
  if (targetCache?.document.deref() === document && targetCache.result.deref() === result) return targetCache.targets;
  const targets: ModelMeasurementTarget[] = [];
  const labels = new Map<string, string>();
  for (const sketch of Object.values(document.sketches)) {
    const counts: Record<string, number> = {};
    for (const entity of Object.values(sketch.entities)) {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1;
      labels.set(`${sketch.id}:${entity.id}`, `${entity.type} ${counts[entity.type]}`);
    }
  }
  let vertices = 0;
  const add = (target: ModelMeasurementTarget) => {
    const size = target.paths.reduce((sum, path) => sum + path.length, 0);
    if (targets.length < MEASUREMENT_TARGET_LIMIT && vertices + size <= MEASUREMENT_VERTEX_LIMIT) {
      vertices += size;
      targets.push(target);
    }
  };
  const native = new Set(result.meshes.filter((mesh) => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid).map((mesh) => mesh.bodyId));
  for (const edge of result.availableEdges ?? []) {
    if (!edge.sourceEntityId || !native.has(edge.bodyId) || (edge.role !== "startCapPerimeter" && edge.role !== "endCapPerimeter")) continue;
    const feature = document.features.find((item) => item.id === edge.featureId);
    if (feature?.type !== "extrude") continue;
    try {
      const placement = individualCapOperationGeometry(feature.id, edge.role === "endCapPerimeter", edge.sourceEntityId, document, result);
      const curve = measureSketchEntity(document, result, { sketchId: feature.sketchId, entityId: edge.sourceEntityId });
      const id = `edge:${feature.id}:${edge.role}:${edge.sourceEntityId}`, path = placement.loops[0];
      if (!path || path.length < 2) continue;
      const label = `${feature.name} · ${edge.role === "endCapPerimeter" ? "End cap" : "Start cap"} · ${labels.get(`${feature.sketchId}:${edge.sourceEntityId}`) ?? "authored edge"}`;
      const linear = document.sketches[feature.sketchId]?.entities[edge.sourceEntityId]?.type === "line";
      add({ id, label, kind: "curve", bodyId: edge.bodyId,
        paths: placement.loops, closed: placement.closed, curve, ...(linear ? { direction: pointDistance(path[0], path[1]).delta } : {}) });
      if (placement.closed === false) for (const [index, point] of [path[0], path[path.length - 1]].entries())
        add({ id: `${id}:point:${index}`, label: `${label} · endpoint ${index + 1}`, kind: "point", bodyId: edge.bodyId, paths: [[point]], point });
    } catch (error) {
      // Placement helpers report expected lost/unsupported roles as plain Error.
      // Programming and allocation failures must not silently remove targets.
      if (!(error instanceof MeasurementError) && !(error instanceof Error && Object.getPrototypeOf(error) === Error.prototype)) throw error;
    }
  }
  for (const face of sketchPlaneChoices(document, result)) if (face.bodyId && native.has(face.bodyId))
    add({ id: `face:${face.id}`, label: face.label, kind: "face", bodyId: face.bodyId, paths: [], plane: { origin: face.transform.origin, normal: face.transform.normal }, direction: face.transform.normal });
  for (const sketch of Object.values(document.sketches)) {
    const solved = result.solvedSketches?.[sketch.id], plane = result.sketchPlanes?.[sketch.id];
    if (!solved || !plane || solved.errors.some((error) => error.severity === "error")) continue;
    for (const entity of Object.values(sketch.entities)) {
      if (targets.length >= MEASUREMENT_TARGET_LIMIT || vertices >= MEASUREMENT_VERTEX_LIMIT) break;
      const ref = { sketchId: sketch.id, entityId: entity.id }, id = `sketch:${sketch.id}:${entity.id}`;
      const label = `${sketch.name} · ${labels.get(`${sketch.id}:${entity.id}`)}${entity.construction ? " (construction)" : ""}`;
      try {
        if (entity.type === "point") {
          const point = measureWorldPoint(document, result, ref);
          add({ id, label, kind: "point", sketchId: sketch.id, paths: [[point]], point });
        } else {
          const curve = measureSketchEntity(document, result, ref);
          const line = solved.lines.find((item) => item.id === entity.id);
          const arc = solved.arcs.find((item) => item.id === entity.id);
          const circle = solved.circles.find((item) => item.id === entity.id);
          if (arc && (!Number.isFinite(arc.sweep) || Math.ceil(Math.abs(arc.sweep) / (2 * Math.PI / CIRCLE_PATH_POINTS)) + 1 > MAX_PATH_POINTS)) continue;
          const local = line ? [line.start, line.end] : arc ? sampleArc(arc) : circle ? Array.from({ length: CIRCLE_PATH_POINTS }, (_, i) => ({ x: circle.center.x + circle.radius * Math.cos(i * 2 * Math.PI / CIRCLE_PATH_POINTS), y: circle.center.y + circle.radius * Math.sin(i * 2 * Math.PI / CIRCLE_PATH_POINTS) })) : [];
          if (local.length < 2 || local.length > MAX_PATH_POINTS) continue;
          const path = local.map((point) => transformPoint(plane, point.x, point.y));
          add({ id, label, kind: "curve", sketchId: sketch.id, paths: [path], closed: entity.type === "circle", curve,
            ...(line ? { direction: pointDistance(path[0], path[1]).delta } : {}) });
        }
      } catch (error) { if (!(error instanceof MeasurementError)) throw error; }
    }
  }
  targetCache = { document: new WeakRef(document), result: new WeakRef(result), targets };
  return targets;
}
export interface ModelMeasurement { label: string; length?: number; angle?: number; curve?: EntityMeasurement; point?: Point3; paths: Point3[][] }
function angleBetween(first: Point3, second: Point3) {
  const size = Math.hypot(first.x, first.y, first.z) * Math.hypot(second.x, second.y, second.z);
  if (!size || !Number.isFinite(size)) throw new MeasurementError("These directions cannot be measured.");
  // Lines and plane normals are undirected; report their smaller angle.
  const cross = Math.hypot(first.y * second.z - first.z * second.y, first.z * second.x - first.x * second.z, first.x * second.y - first.y * second.x);
  const dot = Math.abs(first.x * second.x + first.y * second.y + first.z * second.z);
  return Math.atan2(cross / size, dot / size) * 180 / Math.PI;
}
export function measureModelTargets(first: ModelMeasurementTarget, second?: ModelMeasurementTarget): ModelMeasurement {
  if (!second) return { label: first.label, curve: first.curve, point: first.point, paths: first.paths };
  if (first.point && second.point) return { label: "Point distance", length: pointDistance(first.point, second.point).length, paths: [[first.point, second.point]] };
  if (first.plane && second.plane) {
    const angle = angleBetween(first.plane.normal, second.plane.normal);
    if (angle < 1e-6) {
      const delta = pointDistance(first.plane.origin, second.plane.origin).delta;
      const n = first.plane.normal;
      return { label: "Parallel plane separation", length: Math.abs(delta.x * n.x + delta.y * n.y + delta.z * n.z) / Math.hypot(n.x, n.y, n.z), angle, paths: [] };
    }
    return { label: "Smaller angle between face planes", angle, paths: [] };
  }
  if (first.kind === "curve" && second.kind === "curve" && first.direction && second.direction)
    return { label: "Smaller angle between straight edges", angle: angleBetween(first.direction, second.direction), paths: [...first.paths, ...second.paths] };
  throw new MeasurementError("Choose two points, two straight edges, or two supported planar faces. Mixed and curved distance pairs are unavailable.");
}
