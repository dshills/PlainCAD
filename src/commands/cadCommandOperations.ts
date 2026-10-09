import type { CadDocument, ExpressionRef, Feature, OriginPlane, Sketch, SketchDimension } from "../cad/document/schema";
import { deleteFeature, nowIso, touchDocument, upsertFeature, upsertParameter, upsertSketch } from "../cad/document/CadDocument";
import { addComponent, featureComponentId, renameComponent } from "../cad/document/components";
import { withComponentPlacement } from "../cad/document/componentPlacement";
import { createId } from "../cad/document/ids";
import { validateDocument } from "../cad/document/validate";
import { timelineDependencyErrors } from "../cad/document/timelineEditing";
import { bindDocumentExpressions, renameParameter } from "../cad/parameters/expressionBindings";
import { evaluateExpression, evaluateExpressionRef, evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { addArc, addCircle, addConstraint, addLine, addPoint, createSketchOnPlane, setConstruction } from "../cad/sketch/SketchModel";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { deleteSketchEntities } from "../cad/sketch/entityDeletion";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { createExtrudeEdgeRef, resolveSupportedEdgeRefs, type SupportedEdgeRole } from "../cad/features/topologyRefs";
import { stableBodyIdForFeature } from "../cad/features/featureGraph";
import { addSizedCanvasGeometry, type CanvasSizeInput } from "../cad/sketch/sizedCanvasGeometry";
import type { CanvasPoint, CanvasTool } from "../cad/sketch/canvasGeometry";
import { CAD_COMMAND_SCHEMAS, isCadCommandId } from "./cadCommands";
import { validateCommandArguments } from "./commandSchemas";
import type { JsonValue } from "./registry";
import type { TypedCadCommandCall } from "./cadCommandTypes";

export interface CadCommandCall { command: string; arguments?: JsonValue }
export interface CadCommandContext { aliases?: Record<string, string> }
export interface CadCommandResult {
  id?: string;
  entityIds?: string[];
  pointIds?: string[];
  profileIds?: string[];
  bodyId?: string;
  endpoint?: CanvasPoint;
}
export interface AppliedCadCommand { document: CadDocument; result: CadCommandResult; aliases: Record<string, string> }

/** Pure immutable intent execution. No store, renderer, worker or runtime proof is accepted. */
export function applyCadCommand(document: CadDocument, call: CadCommandCall | TypedCadCommandCall, context: CadCommandContext = {}): AppliedCadCommand {
  if (!isCadCommandId(call.command)) throw new Error(`Unsupported semantic CAD command: ${call.command}.`);
  validateCommandArguments(CAD_COMMAND_SCHEMAS[call.command], call.arguments);
  const args = call.arguments as Record<string, JsonValue>;
  const aliases = { ...context.aliases };
  const reference = (value: JsonValue | undefined, label: string): string => {
    if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
    if (!value.startsWith("$")) return value;
    const name = value.slice(1);
    if (!Object.hasOwn(aliases, name)) throw new Error(`Unknown plan reference ${value}. Create or bind it before use.`);
    return aliases[name];
  };
  const references = (value: JsonValue | undefined, label: string) => {
    if (!Array.isArray(value)) throw new Error(`${label} must be a list of references.`);
    const ids = value.map(item => reference(item, label));
    if (new Set(ids).size !== ids.length) throw new Error(`${label} must contain distinct references.`);
    return ids;
  };
  const string = (field: string, fallback?: string) => typeof args[field] === "string" ? args[field] as string : fallback;
  const expression = (value: string, angle = false): ExpressionRef => ({ expression: value, unit: angle ? "deg" : "mm", authoredUnit: angle ? document.unitSettings.angle : document.unitSettings.length });
  const lengthOperand = (value: string) => {
    const evaluated = evaluateExpression(value, { parameters: evaluateParameters(document.parameters).values });
    const authored = evaluateExpressionRef(expression(value), { parameters: evaluateParameters(document.parameters).values });
    return evaluated.quantity?.dimension === "scalar" && authored.quantity?.dimension === "length" ? `((${value}) * 1${document.unitSettings.length})` : `(${value})`;
  };
  const positive = (value: string, label: string, angle = false) => {
    const evaluated = evaluateExpressionRef(expression(value, angle), { parameters: evaluateParameters(document.parameters).values });
    if (evaluated.error || !evaluated.quantity || evaluated.quantity.dimension !== (angle ? "angle" : "length") || evaluated.quantity.value <= 1e-7 || Math.abs(evaluated.quantity.value) > (angle ? Math.PI * 2 + 1e-8 : 1e8))
      throw new Error(`${label} requires a positive ${angle ? "angle of at most one turn" : "length within modeling limits"}. ${evaluated.error ?? ""}`);
    return expression(value, angle);
  };
  let next = document;
  let result: CadCommandResult = {};
  let changedSketch: Sketch | undefined;
  const getSketch = () => {
    const id = reference(args.sketchId, "sketchId");
    if (!Object.hasOwn(document.sketches, id)) throw new Error("Sketch reference was lost. Select a current sketch.");
    return document.sketches[id];
  };
  const getComponent = () => {
    const id = args.componentId === undefined ? document.rootComponentId : reference(args.componentId, "componentId");
    if (!Object.hasOwn(document.components, id)) throw new Error("Component reference was lost.");
    return id;
  };
  const targets = (owner: string) => {
    const ids = references(args.targetBodyIds, "targetBodyIds");
    for (const id of ids) {
      const feature = document.features.find(item => stableBodyIdForFeature(item.id) === id);
      if (!feature || feature.suppressed || !((feature.type === "extrude" || feature.type === "revolve") && feature.operation === "newBody") || featureComponentId(document, feature) !== owner)
        throw new Error(`Target body ${id} must be an active new-body owner in this component. Native rebuild verifies that it remains available.`);
    }
    return ids;
  };
  const profile = (sketch: Sketch) => {
    const detection = detectProfiles(solveSketch(sketch, evaluateParameters(document.parameters).values));
    const requested = args.profileId === undefined ? undefined : reference(args.profileId, "profileId");
    const selected = requested ? detection.profiles.find(item => item.id === requested || item.alternateIds?.includes(requested)) : detection.profiles.length === 1 ? detection.profiles[0] : undefined;
    if (!selected) throw new Error(`Select one current closed profile. ${detection.errors[0] ?? (detection.profiles.length > 1 ? "Multiple profiles require an explicit profileId." : "Sketch has no usable closed profile.")}`);
    return selected.id;
  };
  const putFeature = (feature: Feature) => {
    next = upsertFeature(document, feature);
    result = { id: feature.id, ...((feature.type === "extrude" || feature.type === "revolve") && feature.operation === "newBody" ? { bodyId: stableBodyIdForFeature(feature.id) } : {}) };
  };

  if (call.command === "cad.parameter.add") {
    const name = string("name")!.trim();
    if (Object.hasOwn(document.parameters, name)) throw new Error(`Parameter ${name} already exists.`);
    const id = createId("param");
    next = upsertParameter(document, { id, name, expression: string("expression")!, authoredUnit: string("authoredUnit", document.unitSettings.length), value: 0, unit: "mm", ...(args.group !== undefined ? { group: string("group") } : {}) });
    result = { id };
  } else if (call.command === "cad.parameter.update") {
    const id = reference(args.parameterId, "parameterId");
    const existing = Object.values(document.parameters).find(item => item.id === id);
    if (!existing) throw new Error("Parameter reference was lost.");
    if (existing.locked) throw new Error("Unlock the parameter before changing it.");
    const name = string("name", existing.name)!.trim();
    const renamed = name === existing.name ? document : renameParameter(document, id, name);
    const patch = { ...renamed.parameters[name] };
    for (const field of ["expression", "authoredUnit", "group"] as const) if (args[field] !== undefined) patch[field] = string(field)!;
    next = upsertParameter(renamed, patch);
    result = { id };
  } else if (call.command === "cad.component.create") {
    const created = addComponent(document, string("name")!);
    next = created.document;
    result = { id: created.component.id };
  } else if (call.command === "cad.component.rename") {
    const id = getComponent();
    next = renameComponent(document, id, string("name")!);
    result = { id };
  } else if (call.command === "cad.component.place") {
    const id = getComponent();
    next = touchDocument(withComponentPlacement(document, id, { translation: args.translation as [number, number, number], rotation: args.rotation as [number, number, number] }));
    result = { id };
  } else if (call.command === "cad.sketch.create") {
    const plane = string("plane") as OriginPlane;
    if (args.offset !== undefined) {
      const offset = evaluateExpressionRef(expression(string("offset")!), { parameters: evaluateParameters(document.parameters).values });
      if (offset.error || offset.quantity?.dimension !== "length" || !Number.isFinite(offset.quantity.value) || Math.abs(offset.quantity.value) > 1e8) throw new Error("Sketch offset requires a finite length within modeling limits.");
    }
    const sketch = { ...createSketchOnPlane(string("name")!, args.offset === undefined ? plane : { type: "offset" as const, base: plane, offset: expression(string("offset")!) }), componentId: getComponent() };
    next = upsertSketch(document, sketch);
    result = { id: sketch.id };
  } else if (call.command.startsWith("cad.sketch.")) {
    let sketch = getSketch();
    const originalIds = new Set(Object.keys(sketch.entities));
    const addCoordinates = (value: JsonValue) => {
      const coordinate = value as { x: string; y: string };
      const added = addPoint(sketch, coordinate.x, coordinate.y);
      // Coordinate seeds have the same authored units as feature expressions.
      const entity = added.sketch.entities[added.pointId];
      sketch = { ...added.sketch, entities: { ...added.sketch.entities, [added.pointId]: entity.type === "point" ? { ...entity, x: expression(coordinate.x), y: expression(coordinate.y) } : entity } };
      return added.pointId;
    };
    const point = (field: string) => {
      const idField = `${field}PointId`;
      if ((args[field] === undefined) === (args[idField] === undefined)) throw new Error(`Provide exactly one of ${field} or ${idField}.`);
      if (args[idField] === undefined) return addCoordinates(args[field]);
      const id = reference(args[idField], idField);
      if (sketch.entities[id]?.type !== "point") throw new Error(`${idField} must reference a current point in this sketch.`);
      return id;
    };
    if (call.command === "cad.sketch.draw") {
      const points = (args.points as unknown as CanvasPoint[]).map(point => ({ ...point, ...(point.pointId === undefined ? {} : { pointId: reference(point.pointId, "point.pointId") }) }));
      const drawn = addSizedCanvasGeometry(sketch, solveSketch(sketch, evaluateParameters(document.parameters).values), string("tool") as CanvasTool, points, args.construction === true, args.clockwise === true, (args.sizes ?? {}) as CanvasSizeInput, evaluateParameters(document.parameters).values, document.unitSettings.length);
      if (drawn.sketch === sketch) {
        if (args.as !== undefined) throw new Error("This draw reuses existing geometry; no new alias can be bound.");
        return { document, result: { ...(drawn.endpoint ? { endpoint: drawn.endpoint } : {}) }, aliases };
      }
      sketch = drawn.sketch;
      if (drawn.endpoint) result.endpoint = drawn.endpoint;
      result.id = Object.values(sketch.entities).find(entity => !originalIds.has(entity.id) && entity.type !== "point")?.id ?? Object.values(sketch.entities).find(entity => !originalIds.has(entity.id))?.id;
    } else if (call.command === "cad.sketch.point") result.id = addCoordinates(args.point);
    else if (call.command === "cad.sketch.rectangle") {
      positive(string("width")!, "Width"); positive(string("height")!, "Height");
      const origin = (args.origin ?? { x: "0mm", y: "0mm" }) as { x: string; y: string };
      const width = string("width")!, height = string("height")!;
      const ids = [addCoordinates(origin), addCoordinates({ x: `${lengthOperand(origin.x)} + ${lengthOperand(width)}`, y: origin.y }), addCoordinates({ x: `${lengthOperand(origin.x)} + ${lengthOperand(width)}`, y: `${lengthOperand(origin.y)} + ${lengthOperand(height)}` }), addCoordinates({ x: origin.x, y: `${lengthOperand(origin.y)} + ${lengthOperand(height)}` })];
      for (let index = 0; index < 4; index++) {
        const added = addLine(sketch, ids[index], ids[(index + 1) % 4]);
        sketch = addConstraint(added.sketch, index % 2 === 0 ? "horizontal" : "vertical", { entityIds: [added.lineId] });
        result.id ??= added.lineId;
      }
    } else if (call.command === "cad.sketch.circle") {
      const center = addCoordinates(args.center);
      const added = addCircle(sketch, center, string("radius")!);
      const circle = added.sketch.entities[added.circleId];
      sketch = { ...added.sketch, entities: { ...added.sketch.entities, [added.circleId]: circle.type === "circle" ? { ...circle, radius: positive(string("radius")!, "Radius") } : circle } };
      result.id = added.circleId;
    } else if (call.command === "cad.sketch.line") {
      const start = point("start"), end = point("end");
      const added = addLine(sketch, start, end); sketch = added.sketch; result.id = added.lineId;
    } else if (call.command === "cad.sketch.arc") {
      const center = point("center"), start = point("start"), end = point("end");
      const coordinates = [center, start, end].map(id => {
        const entity = sketch.entities[id];
        if (entity.type !== "point") throw new Error("Arc point reference was lost.");
        return [entity.x, entity.y].map(ref => {
          const evaluated = evaluateExpressionRef(ref, { parameters: evaluateParameters(document.parameters).values });
          if (evaluated.error || evaluated.quantity?.dimension !== "length") throw new Error("Arc coordinates require valid lengths.");
          return evaluated.quantity.value;
        });
      });
      const radius = (index: number) => Math.hypot(coordinates[index][0] - coordinates[0][0], coordinates[index][1] - coordinates[0][1]);
      if (radius(1) < 1e-6 || Math.abs(radius(1) - radius(2)) > 1e-6) throw new Error("Arc endpoints must share a positive radius around its center.");
      const added = addArc(sketch, center, start, end, args.clockwise === true); sketch = added.sketch; result.id = added.arcId;
    } else if (call.command === "cad.sketch.construction") {
      for (const id of references(args.entityIds, "entityIds")) {
        if (!Object.hasOwn(sketch.entities, id)) throw new Error("Construction entity reference was lost.");
        sketch = setConstruction(sketch, id, args.construction as boolean);
      }
      result.id = sketch.id;
    } else if (call.command === "cad.sketch.dimension") {
      const dimensionId = args.dimensionId === undefined ? undefined : reference(args.dimensionId, "dimensionId");
      const type = string("type") as SketchDimension["type"];
      const refs = references(args.refs, "refs");
      if (dimensionId) {
        const existing = sketch.dimensions.find(item => item.id === dimensionId);
        if (!existing || existing.type !== type || JSON.stringify([...(existing.pointIds ?? []), ...existing.entityIds]) !== JSON.stringify(refs)) throw new Error("Dimension update must preserve its current type and references.");
      }
      sketch = withCanvasDimension(sketch, { id: dimensionId, type, refs, expression: string("expression")!, authoredUnit: string("authoredUnit", type === "angle" ? document.unitSettings.angle : document.unitSettings.length) });
      result.id = dimensionId ?? sketch.dimensions.at(-1)!.id;
    } else if (call.command === "cad.sketch.deleteEntities") {
      const ids = references(args.entityIds, "entityIds");
      if (ids.some(id => !Object.hasOwn(sketch.entities, id))) throw new Error("Delete entity reference was lost.");
      sketch = deleteSketchEntities(sketch, ids, document);
      result.id = sketch.id;
    }
    const created = Object.values(sketch.entities).filter(entity => !originalIds.has(entity.id));
    if (call.command !== "cad.sketch.draw" && args.construction !== undefined && created.length) for (const entity of created) sketch = setConstruction(sketch, entity.id, args.construction as boolean);
    result.entityIds = created.filter(entity => entity.type !== "point").map(entity => entity.id);
    result.pointIds = created.filter(entity => entity.type === "point").map(entity => entity.id);
    changedSketch = sketch;
    next = upsertSketch(document, sketch);
  } else if (call.command === "cad.feature.extrude" || call.command === "cad.feature.revolve") {
    const sketch = getSketch(), componentId = sketch.componentId ?? document.rootComponentId;
    const operation = (string("operation", "newBody")) as "newBody" | "join" | "cut";
    if (operation === "newBody" && args.targetBodyIds !== undefined) throw new Error("New-body features cannot specify boolean targets.");
    const base = { id: createId("feature"), createdAt: nowIso(), name: string("name", call.command.endsWith("extrude") ? "Extrude" : "Revolve")!, componentId, sketchId: sketch.id, profileId: profile(sketch), operation, ...(operation !== "newBody" ? { targetBodyIds: targets(componentId) } : {}) };
    if (call.command === "cad.feature.extrude") putFeature({ ...base, type: "extrude", direction: string("direction", "positive") as "positive" | "negative" | "symmetric", distance: positive(string("distance")!, "Distance") });
    else {
      if (args.axis !== undefined && args.axisLineId !== undefined) throw new Error("Choose an origin axis or sketch line, not both.");
      const lineId = args.axisLineId === undefined ? undefined : reference(args.axisLineId, "axisLineId");
      if (lineId && sketch.entities[lineId]?.type !== "line") throw new Error("Revolve axis must be a current sketch line.");
      putFeature({ ...base, type: "revolve", angle: positive(string("angle")!, "Angle", true), axis: lineId ? { type: "sketchLine", sketchId: sketch.id, lineId } : { type: "origin", axis: string("axis", "Y") as "X" | "Y" | "Z" } });
    }
  } else if (call.command === "cad.feature.hole") {
    const sketch = getSketch(), componentId = sketch.componentId ?? document.rootComponentId;
    const centerPointIds = references(args.centerPointIds, "centerPointIds");
    if (centerPointIds.some(id => sketch.entities[id]?.type !== "point")) throw new Error("Hole centers must be current points in its source sketch.");
    if ((args.depth === undefined) === (args.throughAll !== true)) throw new Error("Provide depth or throughAll: true, exclusively.");
    putFeature({ id: createId("feature"), type: "hole", createdAt: nowIso(), name: string("name", "Hole")!, componentId, sketchId: sketch.id, centerPointIds, targetBodyIds: targets(componentId), diameter: positive(string("diameter")!, "Diameter"), depth: args.throughAll === true ? "throughAll" : positive(string("depth")!, "Depth"), direction: string("direction", "positive") as "positive" | "negative" });
  } else if (call.command === "cad.feature.fillet" || call.command === "cad.feature.chamfer") {
    const edges = (args.edges as Array<{ featureId: string; role: SupportedEdgeRole; sourceEntityId?: string }>).map(edge => createExtrudeEdgeRef(reference(edge.featureId, "edge.featureId"), edge.role, edge.sourceEntityId === undefined ? undefined : reference(edge.sourceEntityId, "edge.sourceEntityId")));
    const resolved = resolveSupportedEdgeRefs(document, edges);
    if ("error" in resolved) throw new Error(resolved.error);
    const base = { id: createId("feature"), createdAt: nowIso(), name: string("name", call.command.endsWith("fillet") ? "Fillet" : "Chamfer")!, componentId: featureComponentId(document, resolved[0].feature), targetEdgeRefs: edges };
    putFeature(call.command.endsWith("fillet") ? { ...base, type: "fillet", radius: positive(string("radius")!, "Radius") } : { ...base, type: "chamfer", distance: positive(string("distance")!, "Distance") });
  } else if (call.command === "cad.feature.update") {
    const id = reference(args.featureId, "featureId");
    const feature = document.features.find(item => item.id === id);
    if (!feature) throw new Error("Feature reference was lost.");
    const allowed = new Set(["featureId", "name", "suppressed", ...(feature.type === "extrude" ? ["distance", "direction", "operation", "targetBodyIds"] : feature.type === "revolve" ? ["angle", "axis", "operation", "targetBodyIds"] : feature.type === "hole" ? ["diameter", "depth", "throughAll", "direction", "targetBodyIds"] : feature.type === "fillet" ? ["radius"] : feature.type === "chamfer" ? ["distance"] : [])]);
    for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`${key} is not a setting for ${feature.type}.`);
    let updated: Feature = { ...feature, ...(args.name === undefined ? {} : { name: string("name")! }), ...(args.suppressed === undefined ? {} : { suppressed: args.suppressed as boolean }) };
    if (updated.type === "extrude") {
      if (args.distance !== undefined) { const distance = positive(string("distance")!, "Distance"); updated = { ...updated, distance, ...(updated.termination ? { termination: { type: "distance", distance } } : {}) }; }
      if (args.direction !== undefined) updated = { ...updated, direction: string("direction") as "positive" | "negative" | "symmetric" };
    } else if (updated.type === "revolve") {
      if (args.angle !== undefined) updated = { ...updated, angle: positive(string("angle")!, "Angle", true) };
      if (args.axis !== undefined) updated = { ...updated, axis: { type: "origin", axis: string("axis") as "X" | "Y" | "Z" } };
    } else if (updated.type === "hole") {
      if (args.direction === "symmetric") throw new Error("Holes support positive or negative drilling directions.");
      if (args.direction !== undefined) updated = { ...updated, direction: string("direction") as "positive" | "negative" };
      if (args.diameter !== undefined) updated = { ...updated, diameter: positive(string("diameter")!, "Diameter") };
      if (args.depth !== undefined && args.throughAll === true) throw new Error("Provide depth or throughAll: true, exclusively.");
      if (args.throughAll === false && args.depth === undefined && updated.depth === "throughAll") throw new Error("A finite hole requires depth.");
      if (args.depth !== undefined) updated = { ...updated, depth: positive(string("depth")!, "Depth") };
      if (args.throughAll === true) updated = { ...updated, depth: "throughAll" };
    } else if (updated.type === "fillet" && args.radius !== undefined) updated = { ...updated, radius: positive(string("radius")!, "Radius") };
    else if (updated.type === "chamfer" && args.distance !== undefined) updated = { ...updated, distance: positive(string("distance")!, "Distance") };
    if ((updated.type === "extrude" || updated.type === "revolve") && args.operation !== undefined) updated = { ...updated, operation: string("operation") as "newBody" | "join" | "cut" };
    if ((updated.type === "extrude" || updated.type === "revolve") && updated.operation === "newBody") {
      if (args.targetBodyIds !== undefined) throw new Error("New-body features cannot specify boolean targets.");
      const { targetBodyIds: _old, ...rest } = updated; updated = rest;
    } else if ((updated.type === "extrude" || updated.type === "revolve" || updated.type === "hole") && args.targetBodyIds !== undefined) updated = { ...updated, targetBodyIds: targets(featureComponentId(document, updated)) };
    if ((updated.type === "extrude" || updated.type === "revolve") && updated.operation !== "newBody" && !updated.targetBodyIds?.length) throw new Error("Boolean features require explicit targetBodyIds.");
    putFeature(updated);
  } else if (call.command === "cad.feature.delete") {
    const id = reference(args.featureId, "featureId");
    if (!document.features.some(item => item.id === id)) throw new Error("Feature reference was lost.");
    next = deleteFeature(document, id); result = { id };
  }

  next = bindDocumentExpressions(next, document);
  const issues = validateDocument(next, "storage");
  const dependency = timelineDependencyErrors(next)[0];
  if (issues.length || dependency) throw new Error(issues[0]?.message ?? dependency);
  const parameters = evaluateParameters(next.parameters);
  if (parameters.errors.length) throw new Error(parameters.errors[0].message);
  if (changedSketch) {
    const solved = solveSketch(next.sketches[changedSketch.id], parameters.values);
    const error = solved.errors.find(item => item.severity === "error");
    if (error) throw new Error(`Sketch ${changedSketch.name}: ${error.message}`);
    result.profileIds = detectProfiles(solved).profiles.map(item => item.id);
  }
  if (args.as !== undefined) {
    const alias = string("as")!;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) || alias === "prototype" || Object.hasOwn(Object.prototype, alias)) throw new Error("Alias must be a safe identifier.");
    const entries: [string, string][] = [ ...(result.id ? [[alias, result.id] as [string, string]] : []), ...(result.bodyId ? [[`${alias}.body`, result.bodyId] as [string, string]] : []), ...(["pointIds", "entityIds", "profileIds"] as const).flatMap(field => (result[field] ?? []).map((id, index): [string, string] => [`${alias}.${field.replace("Ids", "")}${index}`, id])) ];
    if (entries.some(([key]) => Object.hasOwn(aliases, key))) throw new Error(`Alias ${alias} is already bound in this plan.`);
    for (const [key, id] of entries) aliases[key] = id;
  }
  return { document: next, result, aliases };
}
