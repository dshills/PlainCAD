import type { CadDocument, ConstraintType, ExpressionRef, Sketch } from "../document/schema";
import { upsertSketch } from "../document/CadDocument";
import { addConstraint } from "./SketchModel";
import { solveSketch, type ResolvedSketch } from "./SketchSolver";
import { detectProfiles } from "./profileDetection";
import { collectExpressionDependencies, evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";

export type ContextualConstraintType = Extract<ConstraintType, "horizontal" | "vertical" | "coincident" | "parallel" | "perpendicular" | "tangent">;
export interface ContextualConstraintOption { type: ContextualConstraintType; label: string; }
export interface ContextualConstraintPlan {
  base: CadDocument;
  document: CadDocument;
  sketchId: string;
  type: ContextualConstraintType;
  selectedIds: string[];
  addedIds: string[];
  changes: string[];
  profileCount: number;
  solved: ResolvedSketch;
}
const labels: Record<ContextualConstraintType, string> = { horizontal: "Horizontal", vertical: "Vertical", coincident: "Coincident", parallel: "Parallel", perpendicular: "Perpendicular", tangent: "Tangent" };
/** Selection shape only establishes availability; Preview checks actual design intent. */
export function contextualConstraintOptions(sketch: Sketch, ids: readonly string[]): ContextualConstraintOption[] {
  if (!ids.length || ids.length > 32 || new Set(ids).size !== ids.length || ids.some((id) => !Object.hasOwn(sketch.entities, id))) return [];
  const entities = ids.map((id) => sketch.entities[id]);
  let types: ContextualConstraintType[] = [];
  if (entities.every((entity) => entity.type === "line")) types = ["horizontal", "vertical", ...(ids.length === 2 ? ["parallel", "perpendicular"] as const : [])];
  if (ids.length === 2 && entities.every((entity) => entity.type === "point")) types = ["coincident"];
  if (ids.length === 2 && entities.every((entity) => ["line", "circle", "arc"].includes(entity.type)) && entities.filter((entity) => entity.type === "line").length < 2) types = ["tangent"];
  return types.map((type) => ({ type, label: labels[type] }));
}
export function sketchConstraintStatus(solved: ResolvedSketch): string {
  if (solved.errors.some((error) => error.severity === "error")) return `Needs repair: ${solved.errors.filter((error) => error.severity === "error").map((error) => `${error.constraintId ?? error.entityId ?? "Sketch"}: ${error.message}`).join(" ")}`;
  if (solved.status === "fullyConstrained") return "Fully constrained: this solve has no remaining local freedom.";
  return `Underconstrained: ${solved.degreesOfFreedom} remaining local degrees of freedom. You can keep drawing; add dimensions or relations to control the shape. This count describes this solve, not global uniqueness.`;
}
/** Persist solved free coordinates so worker continuity cannot make Undo inherit the edited shape. */
export function withSolvedSketchSeeds(sketch: Sketch, solved: ResolvedSketch, values: ReturnType<typeof evaluateParameters>["values"]): Sketch {
  const seed = (ref: ExpressionRef, value: number) => {
    if (!Number.isFinite(value)) throw new Error("Constraint preview produced invalid geometry. Repair the selected sketch.");
    if (Object.keys(ref.parameterRefs ?? {}).length || collectExpressionDependencies(ref.expression).length) return ref;
    const old = evaluateExpressionRef(ref, { parameters: values }).quantity?.value;
    if (old === undefined) throw new Error("Authored coordinate could not be evaluated. Repair its expression before applying solved geometry.");
    return Math.abs(old - value) <= 1e-8 ? ref : { expression: `${value.toFixed(12)}mm`, unit: "mm" };
  };
  const entities = { ...sketch.entities };
  for (const entity of Object.values(sketch.entities)) {
    if (entity.type === "point") {
      const point = solved.points[entity.id];
      if (!point) throw new Error(`Solved point ${entity.id} is missing. Repair sketch geometry.`);
      entities[entity.id] = { ...entity, x: seed(entity.x, point.x), y: seed(entity.y, point.y) };
    } else if (entity.type === "circle") {
      const circle = solved.circles.find((candidate) => candidate.id === entity.id);
      if (!circle) throw new Error(`Solved circle ${entity.id} is missing. Repair sketch geometry.`);
      entities[entity.id] = { ...entity, radius: seed(entity.radius, circle.radius) };
    }
  }
  return { ...sketch, entities };
}
export function buildContextualConstraint(document: CadDocument, sketchId: string, ids: readonly string[], type: ContextualConstraintType): ContextualConstraintPlan {
  const sketch = document.sketches[sketchId];
  if (!sketch) throw new Error("Sketch was removed. Open a current sketch.");
  if (Object.keys(sketch.entities).length > 512) throw new Error("Contextual previews support at most 512 sketch entities. Use Sketch tools for larger sketches.");
  if (!contextualConstraintOptions(sketch, ids).some((option) => option.type === type)) throw new Error("This relation does not match the selection. Choose lines, two points, or a supported tangent pair.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before adding a relation.");
  const authored = solveSketch(sketch, evaluation.values);
  if (authored.errors.some((error) => error.severity === "error")) throw new Error(sketchConstraintStatus(authored));
  const baseline = solveSketch({ ...sketch, solveMode: "driving" }, evaluation.values);
  if (baseline.errors.some((error) => error.severity === "error")) throw new Error(`Existing driving intent needs repair before adding a relation. ${sketchConstraintStatus(baseline)}`);
  let next: Sketch = { ...sketch, solveMode: "driving" };
  const referenceGroups = type === "horizontal" || type === "vertical" ? ids.map((id) => [id]) : [[...ids]];
  for (const refs of referenceGroups) {
    const exists = sketch.constraints.some((constraint) => constraint.type === type && (type === "coincident" ? constraint.pointIds : constraint.entityIds)?.length === refs.length && refs.every((id) => (type === "coincident" ? constraint.pointIds : constraint.entityIds)?.includes(id)));
    // Horizontal/vertical constraints may cover several lines in a legacy project.
    const covered = (type === "horizontal" || type === "vertical") && sketch.constraints.some((constraint) => constraint.type === type && constraint.entityIds.includes(refs[0]));
    if (!exists && !covered) next = addConstraint(next, type, type === "coincident" ? { pointIds: refs } : { entityIds: refs });
  }
  const addedIds = next.constraints.filter((constraint) => !sketch.constraints.some((old) => old.id === constraint.id)).map((constraint) => constraint.id);
  if (!addedIds.length) throw new Error("This relation is already present. The sketch is unchanged.");
  const solved = solveSketch(next, evaluation.values);
  if (solved.errors.some((error) => error.severity === "error")) throw new Error(`Relation conflicts with existing design intent. ${sketchConstraintStatus(solved)} Existing constraints and dimensions were preserved.`);
  next = withSolvedSketchSeeds(next, solved, evaluation.values);
  const profiles = detectProfiles(solved).profiles;
  if (profiles.length < Math.max(detectProfiles(baseline).profiles.length, detectProfiles(authored).profiles.length)) throw new Error("This relation would lose a closed region. Review the selected geometry; no existing intent was removed.");
  return { base: document, document: upsertSketch(document, next), sketchId, type, selectedIds: [...ids], addedIds, changes: [`Add ${addedIds.length} ${labels[type]} relation(s)`, "Preserve existing constraints, dimensions and bound expressions", ...(sketch.solveMode !== "driving" ? ["Activate driving solving so relations and dimensions control future rebuilds"] : [])], profileCount: profiles.length, solved };
}
