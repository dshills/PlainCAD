import type { CadDocument, ExpressionRef, SketchEntity } from "../document/schema";
import { createId } from "../document/ids";
import { upsertSketch } from "../document/CadDocument";
import { validateDocument } from "../document/validate";
import { bindDocumentExpressions } from "../parameters/expressionBindings";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";
import { solveSketch, type ResolvedSketch } from "./SketchSolver";
import { detectProfiles, type SketchProfile } from "./profileDetection";
import { MIN_ENTITY_SIZE, SKETCH_TOLERANCE as EPS } from "./tolerances";
import { offsetAuthoredContour, offsetCurvesTouch, type OffsetCurve } from "./offsetContour";

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
function verifyContacts(copied: OffsetCurve[], solved: ResolvedSketch) {
  const existing: OffsetCurve[] = [
    ...solved.lines.filter((curve) => !curve.construction).map((curve) => ({ ...curve, type: "line" as const })),
    ...solved.circles.filter((curve) => !curve.construction).map((curve) => ({ ...curve, type: "circle" as const })),
    ...solved.arcs.filter((curve) => !curve.construction).map((curve) => ({ ...curve, type: "arc" as const })),
  ];
  if (copied.some((curve) => existing.some((source) => offsetCurvesTouch(curve, source))))
    throw new Error("Offset intersects or touches existing outline geometry, an arc, circle or opening. Reduce the distance; existing holes are not resized.");
}
function authoredContour(profile: SketchProfile, sketch: CadDocument["sketches"][string], solved: ResolvedSketch) {
  const segments = profile.outerLoop.segments;
  if (!segments?.length || segments.length > 64 || new Set(segments.map((segment) => segment.id)).size !== segments.length || segments.some((segment) =>
    sketch.entities[segment.id]?.type !== segment.type || (segment.type === "line" && segment.sourceEntityId && segment.sourceEntityId !== segment.id) ||
    (segment.type === "arc" && !solved.arcs.some((arc) => arc.id === segment.id && Math.abs(Math.abs(arc.sweep) - Math.abs(segment.sweep)) * arc.radius <= EPS))))
    throw new Error("Outline offset supports at most 64 whole authored lines and analytic arcs. Fragmented boundaries are unsupported; choose a complete authored outline.");
  return segments;
}
export function sketchOffsetProfiles(document: CadDocument, sketchId: string) {
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Sketch was removed. Open a current sketch.");
  if (Object.keys(sketch.entities).length > 512) throw new Error("Outline offset supports sketches with at most 512 entities.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before offsetting an outline.");
  const solved = solveSketch(sketch, evaluation.values), detected = detectProfiles(solved);
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
    verifyContacts([{ type: "circle", id: "offset-circle", center: circle.center, radius }], solved);
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
    if (distance.dependencies.length) throw new Error("Line/arc outline offsets currently require a literal length or literal arithmetic. Parameter-bound distance is supported for circles; use a circle or re-offset the outline after editing its dimensions.");
    const segments = offsetAuthoredContour(authoredContour(profile, sketch, solved), signed);
    verifyContacts(segments, solved);
    const pointIds = segments.map((segment) => { const id = createId("point"); add({ id, type: "point", x: ref(segment.start.x), y: ref(segment.start.y) }); return id; });
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index], startPointId = pointIds[index], endPointId = pointIds[(index + 1) % pointIds.length];
      if (segment.type === "line") add({ id: createId("line"), type: "line", startPointId, endPointId });
      else {
        const centerPointId = createId("point");
        add({ id: centerPointId, type: "point", x: ref(segment.center.x), y: ref(segment.center.y) });
        add({ id: createId("arc"), type: "arc", centerPointId, startPointId, endPointId, clockwise: segment.sweep < 0 });
      }
    }
    changes.push("Added an exact analytic contour with new IDs: mitered line corners and tangent arc joins. Current solved coordinates, arc centers/radii and distance are captured; the independent copy does not follow later source or distance parameter edits.");
  }
  if (Object.keys(entities).length > 512) throw new Error("Offset would exceed the 512-entity editing limit. Use a smaller sketch.");
  const next = bindDocumentExpressions(upsertSketch(document, { ...sketch, entities, solveRevision: (sketch.solveRevision ?? 0) + 1 }), document);
  const issues = validateDocument(next);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(" "));
  const rebuilt = solveSketch(next.sketches[sketchId], evaluation.values), detected = detectProfiles(rebuilt);
  if (rebuilt.errors.some((error) => error.severity === "error") || detected.errors.length || !detected.profiles.length)
    throw new Error(`The copied outline did not produce a valid closed profile. Reduce its distance or repair the source sketch. ${[...detected.errors, ...rebuilt.errors.filter((error) => error.severity === "error").map((error) => error.message)].join(" ")}`);
  const copiedCurves = copiedEntityIds.filter((id) => entities[id].type !== "point");
  if (!detected.profiles.some((item) => [item.outerLoop, ...item.innerLoops].some((loop) => copiedCurves.every((id) => loop.entityIds.includes(id)))))
    throw new Error("Offset merged or fragmented the copied contour. Use a smaller distance or separate sketch.");
  changes.push("Original geometry, IDs, dimensions and constraints are unchanged.");
  if (profile.innerLoops.length) changes.push("Only the selected region's outer boundary was copied. Existing holes retain their original geometry and intent.");
  if (document.features.some((feature) => !feature.suppressed && "sketchId" in feature && feature.sketchId === sketchId))
    changes.push("Adding this outline changes profile nesting. Review all existing feature geometry in the native preview before Apply.");
  return { base: document, document: next, sketchId, sourceProfileId: profile.id, copiedEntityIds, profileCount: detected.profiles.length, changes };
}
