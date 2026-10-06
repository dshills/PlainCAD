import type { CadDocument, ExpressionRef, Feature, Sketch } from "../cad/document/schema";
import { createId } from "../cad/document/ids";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { bindDocumentExpressions } from "../cad/parameters/expressionBindings";
import { collectExpressionDependencies, evaluateExpressionRef, evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { createSketchOnPlane } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { guidedFaceContains, guidedFaceTriangles, guidedFaceBoundary, guidedFaceClearance, guidedFaceStraightCapEdges, type FaceBoundary } from "../cad/sketch/guidedHoleGeometry";
import type { SketchPlaneChoice } from "../cad/sketch/planePicking";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { validateDocument } from "../cad/document/validate";
import { createExtrudeEdgeRef, type SupportedEdgeRole } from "../cad/features/topologyRefs";

export interface AiFeatureEdge { id: string; label: string; ownerId: string; role: SupportedEdgeRole; sourceEntityId?: string }
export interface AiFeatureAddContext {
  componentName: string;
  face: { id: string; label: string; bodyId: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } };
  edges: AiFeatureEdge[];
  parameters: Array<{ id: string; name: string; expression: string; value: number; unit: string }>;
}
export type AiFeatureAddAction =
  | { kind: "holes"; centers: Array<{ x: string; y: string }>; diameter: string; depth: string }
  | { kind: "pocket"; profile: { type: "rectangle"; x: string; y: string; width: string; height: string } | { type: "circle"; x: string; y: string; radius: string }; depth: string }
  | { kind: "fillet"; edgeIds: string[]; size: string }
  | { kind: "chamfer"; edgeIds: string[]; size: string };
export interface AiFeatureAddProposal { summary: string; warnings: string[]; actions: AiFeatureAddAction[] }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key) && !optional.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("Feature proposal contains unsupported data.");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("Feature proposal has missing or oversized text.");
  return value;
}
function list<T>(value: unknown, max: number, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Feature proposal exceeds its item limit.");
  return value.map(read);
}
export function validateAiFeatureAddProposal(value: unknown): AiFeatureAddProposal {
  const root = object(value, ["summary", "warnings", "actions"]);
  return { summary: text(root.summary, 2000), warnings: list(root.warnings, 8, (item) => text(item)), actions: list(root.actions, 4, (input): AiFeatureAddAction => {
    const kind = (input as Record<string, unknown>)?.kind;
    if (kind === "holes") {
      const action = object(input, ["kind", "centers", "diameter", "depth"]);
      const centers = list(action.centers, 16, (input) => { const point = object(input, ["x", "y"]); return { x: text(point.x), y: text(point.y) }; });
      if (!centers.length) throw new Error("Choose at least one hole center.");
      return { kind, centers, diameter: text(action.diameter), depth: text(action.depth) };
    }
    if (kind === "pocket") {
      const action = object(input, ["kind", "profile", "depth"]);
      const type = (action.profile as Record<string, unknown>)?.type;
      const p = object(action.profile, type === "rectangle" ? ["type", "x", "y", "width", "height"] : ["type", "x", "y", "radius"]);
      if (type !== "rectangle" && type !== "circle") throw new Error("Pocket supports a rectangle or circle.");
      return { kind, depth: text(action.depth), profile: type === "rectangle" ? { type, x: text(p.x), y: text(p.y), width: text(p.width), height: text(p.height) } : { type, x: text(p.x), y: text(p.y), radius: text(p.radius) } };
    }
    if (kind === "fillet" || kind === "chamfer") {
      const action = object(input, ["kind", "edgeIds", "size"]);
      const edgeIds = list(action.edgeIds, 8, (item) => text(item, 256));
      if (!edgeIds.length || new Set(edgeIds).size !== edgeIds.length) throw new Error("Choose unique supported edges.");
      return { kind, edgeIds, size: text(action.size) };
    }
    throw new Error("AI proposed an unsupported feature. No geometry was changed.");
  }) };
}
export function validateAiFeatureAddContext(value: unknown): AiFeatureAddContext {
  const root = object(value, ["componentName", "face", "edges", "parameters"]);
  const face = object(root.face, ["id", "label", "bodyId", "bounds"]), bounds = object(face.bounds, ["minX", "minY", "maxX", "maxY"]);
  for (const value of Object.values(bounds)) if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error("Face bounds are unavailable.");
  if (!(Number(bounds.maxX) > Number(bounds.minX) && Number(bounds.maxY) > Number(bounds.minY))) throw new Error("Face bounds are empty.");
  return { componentName: text(root.componentName, 120), face: { id: text(face.id, 256), label: text(face.label, 512), bodyId: text(face.bodyId, 256), bounds: bounds as AiFeatureAddContext["face"]["bounds"] },
    edges: list(root.edges, 32, (input) => { const item = object(input, ["id", "label", "ownerId", "role"], ["sourceEntityId"]); if (!["startCapPerimeter", "endCapPerimeter"].includes(String(item.role))) throw new Error("Unsupported cap edge role."); return { id: text(item.id, 256), label: text(item.label), ownerId: text(item.ownerId, 120), role: item.role as SupportedEdgeRole, ...(item.sourceEntityId == null ? {} : { sourceEntityId: text(item.sourceEntityId, 120) }) }; }),
    parameters: list(root.parameters, 24, (input) => { const item = object(input, ["id", "name", "expression", "value", "unit"]); if (typeof item.value !== "number" || !Number.isFinite(item.value)) throw new Error("Parameter value is unavailable."); return { id: text(item.id, 120), name: text(item.name, 120), expression: text(item.expression), value: item.value, unit: text(item.unit, 20) }; }) };
}
export function aiFeatureAddContext(document: CadDocument, componentId: string, choice: SketchPlaneChoice, result: RebuildResult, edges: AiFeatureEdge[]) {
  if (!choice.bodyId || typeof choice.reference === "string") throw new Error("Choose a supported native face.");
  const mesh = result.meshes.find((item) => item.bodyId === choice.bodyId);
  if (!mesh) throw new Error("The selected body is unavailable.");
  const parameters = Object.values(document.parameters);
  if (parameters.length > 24) throw new Error("Feature conversation supports projects with at most 24 parameters. Use the manual feature tools.");
  const points = guidedFaceTriangles(choice, mesh).flat();
  if (!points.length) throw new Error("The native face placement is unavailable.");
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const point of points) { bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y); bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y); }
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length) throw new Error("Repair project parameters before sharing feature context.");
  const context = { componentName: document.components[componentId]?.name ?? "Part", face: { id: choice.id, label: choice.label, bodyId: choice.bodyId, bounds },
    edges: edges.slice(0, 32).map((edge) => ({ ...edge, sourceEntityId: edge.sourceEntityId ?? null })), parameters: parameters.map(({ id, name, expression, unit }) => ({ id, name, expression, value: evaluation.values[name].value, unit })) };
  return validateAiFeatureAddContext(context);
}

/** A face opening wholly inside a pocket also intersects this interior, even
 * when every corner is on material. Expand uncertain native chords by their
 * tessellation allowance rather than treating a sampled curve as exact. */
function rectangleCrossesBoundary(boundary: FaceBoundary, minX: number, minY: number, maxX: number, maxY: number) {
  return boundary.some(({ points: [a, b], clearanceAllowance }) => {
    let start = 0, end = 1;
    for (const [origin, delta, minimum, maximum] of [
      [a.x, b.x - a.x, minX + 1e-7 - clearanceAllowance, maxX - 1e-7 + clearanceAllowance],
      [a.y, b.y - a.y, minY + 1e-7 - clearanceAllowance, maxY - 1e-7 + clearanceAllowance],
    ]) {
      if (Math.abs(delta) < 1e-12) {
        if (origin <= minimum || origin >= maximum) return false;
      } else {
        const t1 = (minimum - origin) / delta, t2 = (maximum - origin) / delta;
        start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2));
        if (start >= end) return false;
      }
    }
    return start < end;
  });
}

/** Appends ordinary editable features; existing parameter expressions and IDs survive. */
export function buildAiFeatureAddition(base: CadDocument, componentId: string, choice: SketchPlaneChoice, result: RebuildResult, context: AiFeatureAddContext, input: unknown) {
  const proposal = validateAiFeatureAddProposal(input);
  if (!proposal.actions.length) throw new Error(proposal.summary);
  if (typeof choice.reference === "string" || !choice.bodyId || choice.id !== context.face.id || choice.bodyId !== context.face.bodyId) throw new Error("Choose the explicit current target face again.");
  const reference = choice.reference;
  const parameters = evaluateParameters(base.parameters);
  if (parameters.errors.length) throw new Error("Repair project parameters before adding features.");
  const allowed = new Set(context.parameters.map((parameter) => parameter.name));
  const expr = (source: string, positive = false): ExpressionRef => {
    if (collectExpressionDependencies(source).some((name) => !allowed.has(name))) throw new Error("Feature expression refers to an unshared parameter.");
    const ref = { expression: source, unit: "mm", authoredUnit: base.unitSettings.length };
    const evaluated = evaluateExpressionRef(ref, { parameters: parameters.values });
    if (evaluated.error || evaluated.quantity?.dimension !== "length" || !Number.isFinite(evaluated.quantity.value) || Math.abs(evaluated.quantity.value) > 100000 || (positive && evaluated.quantity.value <= 0)) throw new Error(`Invalid feature length: ${source}. ${evaluated.error ?? "Use a finite positive size within modeling limits."}`);
    return ref;
  };
  const value = (ref: ExpressionRef) => evaluateExpressionRef(ref, { parameters: parameters.values }).quantity!.value;
  const mesh = result.meshes.find((item) => item.bodyId === choice.bodyId);
  if (!mesh) throw new Error("Target native body is unavailable.");
  const triangles = guidedFaceTriangles(choice, mesh);
  const owner = base.features.find((feature) => feature.id === reference.featureId);
  const profile = owner?.type === "extrude" ? result.profiles?.[owner.sketchId]?.find((item) => item.id === owner.profileId || item.alternateIds?.includes(owner.profileId)) : undefined;
  const boundary = guidedFaceBoundary(triangles, guidedFaceStraightCapEdges(choice, profile, owner?.type === "extrude" ? result.sketchPlanes?.[owner.sketchId] : undefined));
  let document = base;
  const features: Feature[] = [];
  for (const action of proposal.actions) {
    const common = { id: createId("feature"), componentId, createdAt: new Date().toISOString() };
    let feature: Feature;
    if (action.kind === "fillet" || action.kind === "chamfer") {
      const refs = action.edgeIds.map((id) => { const edge = context.edges.find((item) => item.id === id); if (!edge || edge.ownerId !== reference.featureId) throw new Error("AI must choose a listed supported edge of the selected body."); return createExtrudeEdgeRef(edge.ownerId, edge.role, edge.sourceEntityId); });
      const size = expr(action.size, true);
      feature = action.kind === "fillet" ? { ...common, type: "fillet", name: "AI fillet", targetEdgeRefs: refs, radius: size } : { ...common, type: "chamfer", name: "AI chamfer", targetEdgeRefs: refs, distance: size };
    } else {
      let sketch: Sketch = { ...createSketchOnPlane(action.kind === "holes" ? "AI hole centers" : "AI pocket outline", choice.reference), componentId };
      const point = (x: ExpressionRef, y: ExpressionRef) => { const id = createId("point"); sketch = { ...sketch, entities: { ...sketch.entities, [id]: { id, type: "point", x, y } } }; return id; };
      if (action.kind === "holes") {
        const diameter = expr(action.diameter, true), radius = value(diameter) / 2;
        const centers = action.centers.map((p) => ({ x: expr(p.x), y: expr(p.y) }));
        const numeric = centers.map((p) => ({ x: value(p.x), y: value(p.y) }));
        if (numeric.some((p, i) => !guidedFaceContains(triangles, p) || guidedFaceClearance(boundary, p) < radius - 1e-7 || numeric.slice(0, i).some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 2 * radius - 1e-7))) throw new Error("Hole circles must fit on the selected face, outside openings, without overlapping. Choose smaller holes or different centers.");
        const centerPointIds = centers.map((p) => point(p.x, p.y));
        feature = { ...common, name: "AI face holes", type: "hole", sketchId: sketch.id, centerPointIds, targetBodyIds: [choice.bodyId], direction: "negative", diameter, depth: action.depth === "throughAll" ? "throughAll" : expr(action.depth, true) };
      } else {
        const p = action.profile, x = expr(p.x), y = expr(p.y);
        if (p.type === "circle") {
          const radius = expr(p.radius, true), center = { x: value(x), y: value(y) };
          if (!guidedFaceContains(triangles, center) || guidedFaceClearance(boundary, center) < value(radius) - 1e-7) throw new Error("The circular pocket must fit on the selected face.");
          const centerPointId = point(x, y), id = createId("circle");
          sketch = { ...sketch, entities: { ...sketch.entities, [id]: { id, type: "circle", centerPointId, radius } } };
        } else {
          const width = expr(p.width, true), height = expr(p.height, true);
          const points = [[x, y], [expr(`(${x.expression})+(${width.expression})`), y], [expr(`(${x.expression})+(${width.expression})`), expr(`(${y.expression})+(${height.expression})`)], [x, expr(`(${y.expression})+(${height.expression})`)]].map(([px, py]) => point(px, py));
          if (points.some((id) => { const p = sketch.entities[id]; return p.type !== "point" || !guidedFaceContains(triangles, { x: value(p.x), y: value(p.y) }); })) throw new Error("Rectangle pocket corners must lie on the selected face.");
          if (rectangleCrossesBoundary(boundary, value(x), value(y), value(x) + value(width), value(y) + value(height))) throw new Error("The rectangle pocket crosses a face opening, concavity or uncertain curved boundary. Choose an outline fully on material.");
          for (let i = 0; i < 4; i++) { const id = createId("line"); sketch = { ...sketch, entities: { ...sketch.entities, [id]: { id, type: "line", startPointId: points[i], endPointId: points[(i + 1) % 4] } } }; }
        }
        const detected = detectProfiles(solveSketch(sketch, parameters.values));
        if (detected.errors.length || detected.profiles.length !== 1) throw new Error("AI pocket outline must produce one valid closed region.");
        feature = { ...common, name: "AI face pocket", type: "extrude", sketchId: sketch.id, profileId: detected.profiles[0].id, operation: "cut", targetBodyIds: [choice.bodyId], direction: "negative", distance: expr(action.depth, true) };
      }
      document = upsertSketch(document, sketch);
    }
    document = upsertFeature(document, feature);
    features.push(feature);
  }
  document = bindDocumentExpressions(document, base);
  const issues = validateDocument(document);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(" "));
  return { base, document, componentId, bodyId: choice.bodyId, features: features.map((feature) => document.features.find((item) => item.id === feature.id)!), proposal };
}
