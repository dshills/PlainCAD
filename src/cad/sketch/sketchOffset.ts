import type { CadDocument, ExpressionRef, SketchEntity } from "../document/schema";
import { createId } from "../document/ids";
import { upsertSketch } from "../document/CadDocument";
import { validateDocument } from "../document/validate";
import { bindDocumentExpressions } from "../parameters/expressionBindings";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";
import { solveSketch, type ResolvedSketch } from "./SketchSolver";
import { detectProfiles, type SketchProfile } from "./profileDetection";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE as EPS } from "./tolerances";
import type { CanvasPoint } from "./canvasGeometry";

export interface SketchOffsetInput {
  distance: string;
  direction: "inward" | "outward";
  holes: "reject" | "outerOnly";
}
export interface SketchOffsetPlan {
  base: CadDocument;
  document: CadDocument;
  sketchId: string;
  sourceProfileId: string;
  copiedEntityIds: string[];
  profileCount: number;
  changes: string[];
}
const subtract = (a: CanvasPoint, b: CanvasPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: CanvasPoint, b: CanvasPoint) => a.x * b.y - a.y * b.x;
const dot = (a: CanvasPoint, b: CanvasPoint) => a.x * b.x + a.y * b.y;
const length = (point: CanvasPoint) => Math.hypot(point.x, point.y);
const separation = (a: CanvasPoint, b: CanvasPoint) => length(subtract(a, b));
function mm(value: number) {
  const text = String(Number(value.toPrecision(15)));
  if (!text.includes("e")) return `${text}mm`;
  // The expression parser deliberately accepts decimal literals, not exponents.
  const [mantissa, exponent] = text.split("e");
  const negative = mantissa.startsWith("-"), unsigned = negative ? mantissa.slice(1) : mantissa;
  const digits = unsigned.replace(".", ""), position = (unsigned.indexOf(".") < 0 ? unsigned.length : unsigned.indexOf(".")) + Number(exponent);
  const decimal = position <= 0 ? `0.${"0".repeat(-position)}${digits}` : position >= digits.length ? `${digits}${"0".repeat(position - digits.length)}` : `${digits.slice(0, position)}.${digits.slice(position)}`;
  return `${negative ? "-" : ""}${decimal}mm`;
}
const ref = (value: number): ExpressionRef => ({ expression: mm(value), unit: "mm", authoredUnit: "mm" });
function checked(point: CanvasPoint) {
  if (![point.x, point.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 1e8))
    throw new Error("Offset coordinates exceed the supported ±100,000,000 mm range. Reduce the distance.");
  return point;
}
function pointOnSegment(point: CanvasPoint, a: CanvasPoint, b: CanvasPoint) {
  const r = subtract(b, a), q = subtract(point, a), size = length(r);
  return size > EPS && Math.abs(cross(q, r)) <= EPS * size && dot(q, r) >= -EPS * size && dot(q, r) <= dot(r, r) + EPS * size;
}
function segmentsTouch(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) {
  if ([c, d].some((point) => pointOnSegment(point, a, b)) || [a, b].some((point) => pointOnSegment(point, c, d))) return true;
  const r = subtract(b, a), s = subtract(d, c), q = subtract(c, a), determinant = cross(r, s);
  if (Math.abs(determinant) <= Number.EPSILON * length(r) * length(s) * 32) return false;
  const t = cross(q, s) / determinant, u = cross(q, r) / determinant;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
function circleTouchesLine(center: CanvasPoint, radius: number, start: CanvasPoint, end: CanvasPoint) {
  const r = subtract(end, start), square = dot(r, r);
  if (square <= EPS * EPS) return Math.abs(separation(center, start) - radius) <= EPS;
  const t = Math.max(0, Math.min(1, dot(subtract(center, start), r) / square));
  const nearest = separation(center, { x: start.x + r.x * t, y: start.y + r.y * t });
  const farthest = Math.max(separation(center, start), separation(center, end));
  return nearest <= radius + EPS && farthest >= radius - EPS;
}
function verifyContacts(points: CanvasPoint[] | undefined, circle: { center: CanvasPoint; radius: number } | undefined, solved: ResolvedSketch) {
  const edges = points?.map((start, index) => ({ start, end: points[(index + 1) % points.length] })) ?? [];
  if (edges.some((edge) => solved.lines.some((line) => !line.construction && segmentsTouch(edge.start, edge.end, line.start, line.end))))
    throw new Error("Offset intersects or touches existing outline geometry. Reduce the distance or use a separate sketch.");
  if (edges.some((edge) => solved.circles.some((curve) => !curve.construction && circleTouchesLine(curve.center, curve.radius, edge.start, edge.end))))
    throw new Error("Offset intersects an existing circle or opening. Reduce the distance; existing holes are not resized.");
  if (circle) {
    if (solved.lines.some((line) => !line.construction && circleTouchesLine(circle.center, circle.radius, line.start, line.end)))
      throw new Error("Offset circle intersects or touches existing lines. Reduce the distance.");
    if (solved.circles.some((curve) => {
      if (curve.construction) return false;
      const distance = separation(circle.center, curve.center);
      return distance <= circle.radius + curve.radius + EPS && distance >= Math.abs(circle.radius - curve.radius) - EPS;
    })) throw new Error("Offset circle intersects or touches an existing circle. Reduce the distance.");
  }
}
function polygonOffset(profile: SketchProfile, sketch: CadDocument["sketches"][string], distance: number) {
  const segments = profile.outerLoop.segments;
  if (!segments?.length || segments.length > 64 || segments.some((segment) => segment.type !== "line" || sketch.entities[segment.id]?.type !== "line" || (segment.sourceEntityId && segment.sourceEntityId !== segment.id)))
    throw new Error("Outline offset supports at most 64 authored straight edges. Arc, mixed and fragmented outlines are unsupported; choose a simple convex line outline or circle.");
  const points = segments.map((segment) => segment.start);
  if (segments.some((segment, index) => separation(segment.end, points[(index + 1) % points.length]) > EPS))
    throw new Error("Outline is not a single continuous closed boundary. Repair its connections first.");
  const relative = points.map((point) => subtract(point, points[0]));
  const area = relative.reduce((sum, point, index) => sum + cross(point, relative[(index + 1) % relative.length]), 0) / 2;
  if (Math.abs(area) <= MIN_ENTITY_SIZE * MIN_ENTITY_SIZE) throw new Error("The source outline is collapsed or too small to offset.");
  const orientation = area > 0 ? 1 : -1;
  const edges = points.map((point, index) => subtract(points[(index + 1) % points.length], point));
  const normals = edges.map((edge) => {
    const size = length(edge);
    if (size <= MIN_ENTITY_SIZE) throw new Error("The source outline has a zero-length or undersized edge. Repair it first.");
    return { x: orientation * edge.y / size, y: -orientation * edge.x / size };
  });
  for (let index = 0; index < edges.length; index++) {
    const previous = edges[(index + edges.length - 1) % edges.length], current = edges[index];
    if (orientation * cross(previous, current) < -Number.EPSILON * length(previous) * length(current) * 64)
      throw new Error("Concave outlines are not supported by the current miter offset. Use a convex outline or circle; no self-intersecting approximation is created.");
  }
  const copied = points.map((point, index) => {
    const previous = normals[(index + normals.length - 1) % normals.length], current = normals[index];
    const denominator = 1 + dot(previous, current);
    if (denominator < 1e-8) throw new Error("An acute or reversing corner needs an unsupported miter. Simplify the outline.");
    return checked({ x: point.x + distance * (previous.x + current.x) / denominator,
      y: point.y + distance * (previous.y + current.y) / denominator });
  });
  for (let index = 0; index < copied.length; index++) {
    const edge = subtract(copied[(index + 1) % copied.length], copied[index]);
    if (dot(edge, edges[index]) <= MIN_ENTITY_SIZE * length(edges[index]))
      throw new Error("Inward offset collapses or reverses an edge. Reduce the distance; no collapsed or self-intersecting contour is created.");
    for (let other = index + 1; other < copied.length; other++) {
      if (other === index + 1 || (index === 0 && other === copied.length - 1)) continue;
      if (segmentsTouch(copied[index], copied[(index + 1) % copied.length], copied[other], copied[(other + 1) % copied.length]))
        throw new Error("Offset would self-intersect. Reduce the distance or simplify the outline.");
    }
  }
  return copied;
}
export function sketchOffsetProfiles(document: CadDocument, sketchId: string) {
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Sketch was removed. Open a current sketch.");
  if (Object.keys(sketch.entities).length > 512) throw new Error("Outline offset supports sketches with at most 512 entities.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before offsetting an outline.");
  const solved = solveSketch(sketch, evaluation.values), detected = detectProfiles(solved);
  if (solved.arcs.some((arc) => !arc.construction)) throw new Error("Outline offset currently supports straight line outlines and circles. Analytic arc offsets are unavailable; no sampled approximation is created.");
  if (solved.errors.some((error) => error.severity === "error") || detected.errors.length)
    throw new Error("Repair sketch constraints and closed profiles before offsetting an outline.");
  if (!detected.profiles.length) throw new Error("Draw a closed outline before using outline offset. Sketch-plane offset is a different command.");
  return { sketch, solved, profiles: detected.profiles, evaluation };
}
export function buildSketchOffset(document: CadDocument, sketchId: string, profileId: string, input: SketchOffsetInput): SketchOffsetPlan {
  if (!["inward", "outward"].includes(input.direction) || !["reject", "outerOnly"].includes(input.holes)) throw new Error("Choose an inward/outward direction and an explicit holes policy.");
  const { sketch, solved, profiles, evaluation } = sketchOffsetProfiles(document, sketchId);
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("Choose a current closed profile from this sketch.");
  if (profile.innerLoops.length && input.holes !== "outerOnly") throw new Error("This region contains holes. Choose Outer boundary only explicitly; existing holes will remain unchanged and are not offset.");
  const distance = evaluateExpressionRef({ expression: input.distance, authoredUnit: document.unitSettings.length }, { parameters: evaluation.values });
  if (distance.error || distance.quantity?.dimension !== "length" || !Number.isFinite(distance.quantity.value) || distance.quantity.value <= MIN_ENTITY_SIZE)
    throw new Error(`Offset distance must be a positive length larger than ${MIN_ENTITY_SIZE} mm. ${distance.error ?? ""}`);
  const signed = (input.direction === "outward" ? 1 : -1) * distance.quantity.value;
  const entities: Record<string, SketchEntity> = { ...sketch.entities }, copiedEntityIds: string[] = [];
  const add = (entity: SketchEntity) => { entities[entity.id] = entity; copiedEntityIds.push(entity.id); };
  const changes: string[] = [`${input.direction === "outward" ? "Outward" : "Inward"} outline offset: ${input.distance}`];
  if (profile.outerLoop.type === "circle") {
    const circleId = profile.outerLoop.entityIds[0], source = sketch.entities[circleId];
    const circle = solved.circles.find((item) => item.id === circleId);
    if (source?.type !== "circle" || !circle || profile.outerLoop.entityIds.length !== 1) throw new Error("Choose a single authored circle boundary. Fragmented circular outlines are unsupported.");
    const radius = circle.radius + signed;
    if (radius <= MIN_ENTITY_SIZE) throw new Error("Inward offset collapses the circle. Use a distance smaller than its radius.");
    if (radius > 1e8) throw new Error("Offset circle radius exceeds 100,000,000 mm. Reduce the distance.");
    verifyContacts(undefined, { center: circle.center, radius }, solved);
    const center = sketch.entities[source.centerPointId];
    if (center?.type !== "point") throw new Error("Circle center reference is missing. Repair it first.");
    const preserve = (expression: ExpressionRef, value: number) => {
      const evaluated = evaluateExpressionRef(expression, { parameters: evaluation.values });
      if (evaluated.quantity?.dimension === "length" && Math.abs(evaluated.quantity.value - value) <= 1e-6) {
        const raw = evaluateExpressionRef({ expression: expression.expression }, { parameters: evaluation.values });
        if (raw.quantity?.dimension === "length") return { ...expression, resolvedValue: undefined };
        if (raw.quantity?.dimension === "scalar" && expression.authoredUnit) {
          const scale = evaluateExpressionRef({ expression: "1", authoredUnit: expression.authoredUnit }, { parameters: evaluation.values });
          if (scale.quantity?.dimension === "length") return { ...expression, expression: `(${expression.expression}) * ${mm(scale.quantity.value)}`, authoredUnit: "mm", resolvedValue: undefined };
        }
      }
      return ref(value);
    };
    const driving = sketch.solveMode === "driving" ? sketch.dimensions.filter((dimension) => dimension.entityIds.includes(circleId) && ["radius", "diameter"].includes(dimension.type)) : [];
    const drivingRadius = driving.length === 1 ? { ...driving[0].expression,
      expression: driving[0].type === "diameter" ? `(${driving[0].expression.expression}) / 2` : driving[0].expression.expression } : source.radius;
    const baseRadius = preserve(drivingRadius, circle.radius);
    const normalizedDistance = distance.dependencies.length ? preserve({ expression: input.distance, authoredUnit: document.unitSettings.length, unit: document.unitSettings.length }, distance.quantity.value).expression : mm(distance.quantity.value);
    const centerId = createId("point"), copiedId = createId("circle");
    add({ id: centerId, type: "point", x: preserve(center.x, circle.center.x), y: preserve(center.y, circle.center.y) });
    add({ id: copiedId, type: "circle", centerPointId: centerId, radius: { ...baseRadius,
      expression: `(${baseRadius.expression}) ${input.direction === "outward" ? "+" : "-"} (${normalizedDistance})`, unit: "mm", authoredUnit: "mm" } });
    changes.push("Added an independently editable circle. Matching source radius/center parameter expressions and the distance expression remain bound; later source entity or constraint edits are not associative.");
  } else {
    if (distance.dependencies.length) throw new Error("Polygon outline offsets currently require a literal length or literal arithmetic. Parameter-bound distance is supported for circles; use a circle or re-offset the polygon after editing its dimensions.");
    const points = polygonOffset(profile, sketch, signed);
    verifyContacts(points, undefined, solved);
    const pointIds = points.map((point) => { const id = createId("point"); add({ id, type: "point", x: ref(point.x), y: ref(point.y) }); return id; });
    for (let index = 0; index < pointIds.length; index++) add({ id: createId("line"), type: "line", startPointId: pointIds[index], endPointId: pointIds[(index + 1) % pointIds.length] });
    changes.push("Added a convex miter contour with new IDs, capturing the current source shape and distance. The polygon copy is independently editable and does not follow later source or distance parameter edits.");
  }
  if (Object.keys(entities).length > 512) throw new Error("Offset would exceed the 512-entity editing limit. Use a smaller sketch.");
  const next = bindDocumentExpressions(upsertSketch(document, { ...sketch, entities, solveRevision: (sketch.solveRevision ?? 0) + 1 }), document);
  const issues = validateDocument(next);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(" "));
  const rebuilt = solveSketch(next.sketches[sketchId], evaluation.values), detected = detectProfiles(rebuilt);
  if (rebuilt.errors.some((error) => error.severity === "error") || detected.errors.length || !detected.profiles.length)
    throw new Error(`The copied outline did not produce a valid closed profile. Reduce its distance or repair the source sketch. ${rebuilt.errors.filter((error) => error.severity === "error").map((error) => error.message).join(" ")}`);
  const copiedCurves = copiedEntityIds.filter((id) => entities[id].type !== "point");
  if (!detected.profiles.some((item) => [item.outerLoop, ...item.innerLoops].some((loop) => copiedCurves.every((id) => loop.entityIds.includes(id)))))
    throw new Error("Offset merged or fragmented the copied contour. Use a smaller distance or separate sketch.");
  changes.push("Original geometry, IDs, dimensions and constraints are unchanged.");
  if (profile.innerLoops.length) changes.push("Only the selected region's outer boundary was copied. Existing holes retain their original geometry and intent.");
  if (document.features.some((feature) => !feature.suppressed && "sketchId" in feature && feature.sketchId === sketchId))
    changes.push("Adding this outline changes profile nesting. Review all existing feature geometry in the native preview before Apply.");
  return { base: document, document: next, sketchId, sourceProfileId: profile.id, copiedEntityIds, profileCount: detected.profiles.length, changes };
}
