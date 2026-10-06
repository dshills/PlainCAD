import type { CadDocument, ExpressionRef } from "../cad/document/schema";
import { upsertParameter, upsertSketch } from "../cad/document/CadDocument";
import { validateDocument } from "../cad/document/validate";
import { bindDocumentExpressions } from "../cad/parameters/expressionBindings";
import { evaluateExpressionRef, evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solidDimensionParameters, solidDimensionImpact } from "../cad/inspection/solidDimensionEdit";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { buildContextualConstraint, withSolvedSketchSeeds, type ContextualConstraintType } from "../cad/sketch/contextualConstraints";
import { buildSketchTrimExtend } from "../cad/sketch/trimExtend";
import { buildSketchRefinement, type SketchRefinement } from "./sketchRefinement";

export type SketchBindingPolicy = "preserve" | "replace" | `parameter:${string}`;
export type AiSketchAction =
  | { kind: "rectangle"; width: string; height: string }
  | { kind: "dimension"; id: string; expression: string }
  | { kind: "parameter"; id: string; expression: string }
  | { kind: "constraint"; type: ContextualConstraintType; ids: string[] }
  | { kind: "trim"; id: string; x: number; y: number }
  | { kind: "extend"; id: string; x: number; y: number };
export interface AiSketchProposal { summary: string; warnings: string[]; actions: AiSketchAction[] }
export interface AiSketchContext {
  sketchId: string;
  selectedIds: string[];
  bindingPolicy: SketchBindingPolicy;
  geometry: Array<{ id: string; type: string; points: Array<{ id: string; x: number; y: number }>; radius: number | null }>;
  dimensions: Array<{ id: string; type: string; refs: string[]; expression: string; parameterIds: string[] }>;
  constraints: Array<{ type: string; refs: string[] }>;
  parameters: Array<{ id: string; name: string; expression: string; value: number; unit: string; editable: boolean }>;
}
const relations: ContextualConstraintType[] = ["horizontal", "vertical", "coincident", "parallel", "perpendicular", "tangent"];
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("AI sketch data has an unsupported format.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("AI sketch text exceeds its limits or is empty.");
  return value.trim();
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("AI sketch list exceeds its limits.");
  return value.map(parse);
}
function number(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error("AI sketch coordinates must be finite and bounded.");
  return value;
}
export function validateAiSketchProposal(value: unknown): AiSketchProposal {
  const root = record(value, ["summary", "warnings", "actions"]);
  const actions = list(root.actions, 8, (value): AiSketchAction => {
    const kind = (value as { kind?: unknown } | null)?.kind;
    if (kind === "rectangle") { const action = record(value, ["kind", "width", "height"]); return { kind, width: text(action.width, 100), height: text(action.height, 100) }; }
    if (kind === "dimension" || kind === "parameter") { const action = record(value, ["kind", "id", "expression"]); return { kind, id: text(action.id, 120), expression: text(action.expression) }; }
    if (kind === "constraint") {
      const action = record(value, ["kind", "type", "ids"]);
      if (!relations.includes(action.type as ContextualConstraintType)) throw new Error("AI proposed an unsupported relation.");
      return { kind, type: action.type as ContextualConstraintType, ids: list(action.ids, 32, (id) => text(id, 120)) };
    }
    if (kind === "trim" || kind === "extend") { const action = record(value, ["kind", "id", "x", "y"]); return { kind, id: text(action.id, 120), x: number(action.x), y: number(action.y) }; }
    throw new Error("AI proposed an unsupported sketch action. No geometry was changed.");
  });
  return { summary: text(root.summary, 2000), warnings: list(root.warnings, 8, (item) => text(item)), actions };
}
export function validateAiSketchContext(value: unknown): AiSketchContext {
  const root = record(value, ["sketchId", "selectedIds", "bindingPolicy", "geometry", "dimensions", "constraints", "parameters"]);
  const policy = text(root.bindingPolicy, 140);
  if (policy !== "preserve" && policy !== "replace" && !/^parameter:[A-Za-z0-9_-]{1,120}$/.test(policy)) throw new Error("Choose an explicit sketch binding policy.");
  const geometry = list(root.geometry, 128, (value) => { const item = record(value, ["id", "type", "points", "radius"]); const type = text(item.type, 20); if (!["point", "line", "arc", "circle"].includes(type)) throw new Error("Unsupported sketch geometry context."); return { id: text(item.id, 120), type, points: list(item.points, 3, (value) => { const point = record(value, ["id", "x", "y"]); return { id: text(point.id, 120), x: number(point.x), y: number(point.y) }; }), radius: item.radius === null ? null : number(item.radius) }; });
  const dimensions = list(root.dimensions, 64, (value) => { const item = record(value, ["id", "type", "refs", "expression", "parameterIds"]); return { id: text(item.id, 120), type: text(item.type, 40), refs: list(item.refs, 8, (id) => text(id, 120)), expression: text(item.expression), parameterIds: list(item.parameterIds, 24, (id) => text(id, 120)) }; });
  const constraints = list(root.constraints, 64, (value) => { const item = record(value, ["type", "refs"]); return { type: text(item.type, 40), refs: list(item.refs, 32, (id) => text(id, 120)) }; });
  const parameters = list(root.parameters, 24, (value) => { const item = record(value, ["id", "name", "expression", "value", "unit", "editable"]); if (typeof item.editable !== "boolean") throw new Error("Invalid parameter availability."); return { id: text(item.id, 120), name: text(item.name, 64), expression: text(item.expression), value: number(item.value), unit: text(item.unit, 20), editable: item.editable }; });
  return { sketchId: text(root.sketchId, 120), selectedIds: list(root.selectedIds, 32, (id) => text(id, 120)), bindingPolicy: policy as SketchBindingPolicy, geometry, dimensions, constraints, parameters };
}
export function aiSketchContext(document: CadDocument, sketchId: string, selectedIds: string[], bindingPolicy: SketchBindingPolicy): AiSketchContext {
  const sketch = document.sketches[sketchId];
  if (!sketch || Object.keys(sketch.entities).length > 128 || sketch.dimensions.length > 64 || sketch.constraints.length > 64) throw new Error("Provider sketch editing supports at most 128 entities, 64 dimensions and 64 constraints. Use local tools for larger sketches.");
  const evaluation = evaluateParameters(document.parameters), solved = solveSketch(sketch, evaluation.values);
  if (evaluation.errors.length || solved.errors.some((error) => error.severity === "error")) throw new Error("Repair current parameters and sketch constraints before sharing a sketch edit.");
  if (selectedIds.some((id) => !Object.hasOwn(sketch.entities, id))) throw new Error("Sketch selection changed.");
  const refs: ExpressionRef[] = sketch.dimensions.map((dimension) => dimension.expression);
  for (const entity of Object.values(sketch.entities)) if (entity.type === "point") refs.push(entity.x, entity.y); else if (entity.type === "circle") refs.push(entity.radius);
  const choices = [...new Map(refs.flatMap((ref) => solidDimensionParameters(document, ref)).map((choice) => [choice.parameter.id, choice])).values()];
  const context: AiSketchContext = {
    sketchId, selectedIds, bindingPolicy,
    geometry: Object.values(sketch.entities).map((entity) => {
      const ids = entity.type === "point" ? [entity.id] : entity.type === "line" ? [entity.startPointId, entity.endPointId] : entity.type === "circle" ? [entity.centerPointId] : [entity.startPointId, entity.endPointId, entity.centerPointId];
      const curve = [...solved.circles, ...solved.arcs].find((curve) => curve.id === entity.id);
      return { id: entity.id, type: entity.type, points: ids.map((id) => ({ id, x: solved.points[id].x, y: solved.points[id].y })), radius: curve?.radius ?? null };
    }),
    dimensions: sketch.dimensions.map((dimension) => ({ id: dimension.id, type: dimension.type, refs: [...dimension.entityIds, ...(dimension.pointIds ?? [])], expression: dimension.expression.expression, parameterIds: solidDimensionParameters(document, dimension.expression).map((choice) => choice.parameter.id) })),
    constraints: sketch.constraints.map((constraint) => ({ type: constraint.type, refs: [...constraint.entityIds, ...(constraint.pointIds ?? [])] })),
    parameters: choices.map(({ parameter, reason }) => ({ id: parameter.id, name: parameter.name, expression: parameter.expression, value: evaluation.values[parameter.name]?.value ?? 0, unit: parameter.unit, editable: !reason })),
  };
  const valid = validateAiSketchContext(context);
  if (new TextEncoder().encode(JSON.stringify(valid)).byteLength > 48000) throw new Error("Sketch context is too large. Use local sketch tools.");
  return valid;
}
export function buildAiSketchEdit(document: CadDocument, sketchId: string, selectedIds: string[], proposal: AiSketchProposal, policy: SketchBindingPolicy): SketchRefinement {
  proposal = validateAiSketchProposal(proposal);
  if (!proposal.actions.length) throw new Error(proposal.summary);
  const context = aiSketchContext(document, sketchId, selectedIds, policy), changes: string[] = [];
  const availableDimensionIds = context.dimensions.filter((dimension) => !selectedIds.length || dimension.refs.some((id) => selectedIds.includes(id))).map((dimension) => dimension.id);
  let next = document;
  for (const action of proposal.actions) {
    if (action.kind === "rectangle") {
      const width = evaluateExpressionRef({ expression: action.width }, { parameters: {} }).quantity;
      const height = evaluateExpressionRef({ expression: action.height }, { parameters: {} }).quantity;
      if (width?.dimension !== "length" || height?.dimension !== "length" || width.value <= 0 || height.value <= 0) throw new Error("Rectangle edits require positive explicit lengths.");
      const plan = buildSketchRefinement(next, sketchId, selectedIds, `make this rectangle ${width.value.toFixed(12)} x ${height.value.toFixed(12)} mm`);
      next = plan.document; changes.push(...plan.changes);
    } else if (action.kind === "constraint") {
      if (selectedIds.length && action.ids.some((id) => !selectedIds.includes(id))) throw new Error("AI relation targets geometry outside the current selection.");
      const plan = buildContextualConstraint(next, sketchId, action.ids, action.type); next = plan.document; changes.push(...plan.changes);
    } else if (action.kind === "trim" || action.kind === "extend") {
      if (selectedIds.length && !selectedIds.includes(action.id)) throw new Error("AI line edit targets geometry outside the current selection.");
      const plan = buildSketchTrimExtend(next, sketchId, action.id, action.kind, { x: action.x, y: action.y }); next = plan.document; changes.push(...plan.changes);
    } else if (action.kind === "parameter") {
      const choice = context.parameters.find((parameter) => parameter.id === action.id);
      if (policy !== `parameter:${action.id}` || !choice?.editable) throw new Error("Choose this editable shared parameter explicitly before asking AI to change it.");
      const parameter = Object.values(next.parameters).find((parameter) => parameter.id === action.id);
      if (!parameter) throw new Error("AI parameter was removed by an earlier action. Generate a fresh proposal.");
      if (parameter.expression === action.expression) throw new Error("AI parameter edit is unchanged.");
      next = upsertParameter(next, { ...parameter, expression: action.expression, parameterRefs: undefined });
      changes.push(`Shared parameter ${parameter.name} → ${action.expression}`, ...solidDimensionImpact(document, "parameter", parameter.id));
    } else {
      if (!availableDimensionIds.includes(action.id)) throw new Error("AI dimension is outside the current sketch selection.");
      const sketch = next.sketches[sketchId], dimension = sketch.dimensions.find((dimension) => dimension.id === action.id);
      if (!dimension) throw new Error("AI dimension was removed by an earlier action. Generate a fresh proposal.");
      if (solidDimensionParameters(next, dimension.expression).length && policy !== "replace") throw new Error("This dimension is parameter-bound. Choose a shared parameter or explicitly replace the dimension expression.");
      if (dimension.expression.expression === action.expression) throw new Error("AI dimension edit is unchanged.");
      next = upsertSketch(next, { ...sketch, solveMode: "driving", dimensions: sketch.dimensions.map((dimension) => dimension.id === action.id ? { ...dimension, expression: { ...dimension.expression, expression: action.expression, parameterRefs: undefined } } : dimension) });
      changes.push(`Dimension ${dimension.type} (${dimension.id}) → ${action.expression}${policy === "replace" ? " · explicit expression replacement" : ""}`);
    }
    next = bindDocumentExpressions(next, document);
  }
  const invalid = validateDocument(next), evaluation = evaluateParameters(next.parameters);
  if (invalid.length || evaluation.errors.length) throw new Error([...invalid, ...evaluation.errors].map((issue) => issue.message).join(" "));
  const solved = solveSketch(next.sketches[sketchId], evaluation.values);
  if (solved.errors.some((error) => error.severity === "error")) throw new Error(`AI edit conflicts with existing sketch intent: ${solved.errors.map((error) => error.message).join(" ")}`);
  next = upsertSketch(next, withSolvedSketchSeeds(next.sketches[sketchId], solved, evaluation.values));
  if (JSON.stringify(next) === JSON.stringify(document)) throw new Error("AI proposed no changed geometry or intent.");
  return { base: document, document: next, sketchId, changes: [...new Set(changes)], profileCount: detectProfiles(solved).profiles.length };
}
