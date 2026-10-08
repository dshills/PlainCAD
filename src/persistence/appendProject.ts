import type { CadDocument, FacePlaneReference, Feature, Sketch, SketchEntity, SketchPlaneReference, TopologyRef } from "../cad/document/schema";
import { stableFaceId } from "../cad/sketch/planes";
import { createId, stableBodyIdForFeature } from "../cad/document/ids";
import { documentTimeline, timelineItemId } from "../cad/document/timelineOrdering";
import { featureComponentId, sketchComponentId } from "../cad/document/components";
import { bindDocumentExpressions, mapDocumentExpressions, parameterTokens, refreshBoundNames, validateParameterBindings } from "../cad/parameters/expressionBindings";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { validateDocument } from "../cad/document/validate";
import { materializeSketchProjections, projectionConstraintId } from "../cad/sketch/sketchProjection";
import { solveSketch, type ResolvedSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles, type SketchProfile } from "../cad/sketch/profileDetection";
import { assertProjectJsonShape, parseProjectJson } from "./importSafety";
export interface AppendProjectOptions {
  componentId?: string;
}
export interface AppendProjectResult {
  document: CadDocument;
  componentIds: string[];
  parameterNames: string[];
}
/** Copies authored content at the shared origin; never adopts project identity, cameras, or metadata. */
export function appendProject(target: CadDocument, source: CadDocument, options: AppendProjectOptions = {}): AppendProjectResult {
  const sourceIssues = validateDocument(source, "storage");
  if (sourceIssues.length)
    throw new Error(`Source project: ${sourceIssues[0].message}`);
  if (options.componentId && !Object.hasOwn(source.components, options.componentId))
    throw new Error("The selected source component no longer exists.");
  const bound = bindDocumentExpressions(source);
  const bindingIssues = validateParameterBindings(bound, true);
  if (bindingIssues.length)
    throw new Error(`Repair source parameter references before insertion: ${bindingIssues[0].message}`);
  const componentIds = Object.keys(source.components).filter((id) => !options.componentId || id === options.componentId);
  const components = new Set(componentIds);
  const joints = (source.assemblyJoints ?? []).filter(joint => components.has(joint.childComponentId) || components.has(joint.parentComponentId));
  if (joints.some(joint => !components.has(joint.childComponentId) || !components.has(joint.parentComponentId))) throw new Error("Assembly joint references outside the selected component. Detach the joint or choose all source components.");
  const sketches = Object.values(bound.sketches).filter((s) => components.has(sketchComponentId(bound, s.id)));
  const features = bound.features.filter((f) => components.has(featureComponentId(bound, f)));
  if (!sketches.length && !features.length)
    throw new Error("The selected source scope contains no sketches or features.");
  mapDocumentExpressions({ ...bound, sketches: Object.fromEntries(sketches.map((s) => [s.id, s])), features }, (e) => {
    for (const token of parameterTokens(e.expression)) {
      if (!Object.hasOwn(e.parameterRefs ?? {}, token.value) && !Object.hasOwn(bound.parameters, token.value))
        throw new Error(`Unresolved source parameter ${token.value}. Repair it before insertion.`);
    }
    return e;
  });
  const selected: CadDocument = { ...bound, sketches: Object.fromEntries(sketches.map((s) => [s.id, s])), features };
  const ids = new Set<string>([...componentIds, ...joints.map(joint => joint.id), ...Object.values(bound.parameters).map((p) => p.id), ...sketches.flatMap((s) => [s.id, ...Object.keys(s.entities), ...s.constraints.map((c) => c.id), ...s.dimensions.map((d) => d.id), ...(s.projections ?? []).flatMap((p) => [p.id, projectionConstraintId(p.id)])]), ...features.map((f) => f.id)]);
  const occupied = occupiedDocumentIds(target);
  // One prefix preserves ordering within the solver and gives repeated insertions independent identities.
  const generatedConstraints = new Map(sketches.flatMap((s) => (s.projections ?? []).map((p) => [projectionConstraintId(p.id), p.id] as const)));
  const newId = (prefix: string, id: string) => generatedConstraints.has(id) ? projectionConstraintId(`${prefix}:${generatedConstraints.get(id)!}`) : `${prefix}:${id}`;
  let prefix = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = createId("insert");
    if (![...ids].some((id) => occupied.has(newId(candidate, id)))) {
      prefix = candidate;
      break;
    }
  }
  if (!prefix)
    throw new Error("Could not allocate independent insertion IDs. Try insertion again.");
  const remap = (id: string): string => {
    if (!ids.has(id))
      throw new Error(`Source reference ${id} is missing or outside the selected component. Choose all components or repair the source project.`);
    return newId(prefix, id);
  };
  const body = (id: string) => {
    const owner = features.find((f) => stableBodyIdForFeature(f.id) === id && (f.type === "extrude" || f.type === "revolve" || f.type === "fit") && f.operation === "newBody");
    if (!owner)
      throw new Error(`Source body ${id} is missing or outside the selected component. Choose all components or repair the source project.`);
    return stableBodyIdForFeature(remap(owner.id));
  };
  const stable = (value: string, featureId: string, entityId?: string) => {
    if (!value.startsWith(`extrude:${featureId}:`))
      throw new Error(`Unsupported source topology reference ${value}. Repair it before insertion.`);
    const tail = value.slice(`extrude:${featureId}:`.length);
    const roles = ["startCap", "endCap", "side", "profileEdge", "startCapPerimeter", "endCapPerimeter"];
    const role = roles.find((candidate) => tail === candidate || tail.startsWith(`${candidate}:`));
    if (!role)
      throw new Error(`Unsupported source topology role ${value}.`);
    const suffix = tail.slice(role.length);
    if (entityId !== undefined && suffix !== `:${entityId}`)
      throw new Error(`Source topology reference ${value} does not match its explicit entity ID. Repair it before insertion.`);
    const groupSuffix = suffix === ":all" && (role === "startCapPerimeter" || role === "endCapPerimeter");
    const mappedSuffix = entityId !== undefined ? `:${remap(entityId)}` : groupSuffix || !suffix ? suffix : `:${remap(suffix.slice(1))}`;
    return `extrude:${remap(featureId)}:${role}${mappedSuffix}`;
  };
  const face = (ref: FacePlaneReference): FacePlaneReference => ({ ...ref, featureId: remap(ref.featureId), stableFaceId: stable(ref.stableFaceId, ref.featureId) });
  const plane = (ref: SketchPlaneReference): SketchPlaneReference => ref.type === "face" ? face(ref) : ref.type === "offset" && typeof ref.base !== "string" ? { ...ref, base: face(ref.base) } : ref;
  const topology = (ref: TopologyRef): TopologyRef => ({ ...ref, featureId: remap(ref.featureId), transientId: stable(ref.transientId, ref.featureId, ref.sourceEntityId), ...(ref.stableHint ? { stableHint: stable(ref.stableHint, ref.featureId, ref.sourceEntityId) } : {}), ...(ref.sourceEntityId ? { sourceEntityId: remap(ref.sourceEntityId) } : {}) });
  const entity = (e: SketchEntity): SketchEntity => {
    const id = remap(e.id);
    switch (e.type) {
      case "point": return { ...e, id };
      case "line": return { ...e, id, startPointId: remap(e.startPointId), endPointId: remap(e.endPointId) };
      case "circle": return { ...e, id, centerPointId: remap(e.centerPointId) };
      case "arc": return { ...e, id, centerPointId: remap(e.centerPointId), startPointId: remap(e.startPointId), endPointId: remap(e.endPointId) };
    }
  };
  const mappedSketches = sketches.map((s): Sketch => ({ ...s, id: remap(s.id), componentId: remap(sketchComponentId(bound, s.id)), plane: plane(s.plane), ...(s.projections ? { projections: s.projections.map((p) => ({ ...p, id: remap(p.id), sourceFeatureId: remap(p.sourceFeatureId), members: p.members.map((m) => ({ sourceEntityId: remap(m.sourceEntityId), targetEntityId: remap(m.targetEntityId) })) })) } : {}), entities: Object.fromEntries(Object.values(s.entities).map((e) => { const mapped = entity(e); return [mapped.id, mapped]; })), constraints: s.constraints.map((c) => ({ ...c, id: remap(c.id), entityIds: c.entityIds.map(remap), ...(c.pointIds ? { pointIds: c.pointIds.map(remap) } : {}) })), dimensions: s.dimensions.map((d) => ({ ...d, id: remap(d.id), entityIds: d.entityIds.map(remap), ...(d.pointIds ? { pointIds: d.pointIds.map(remap) } : {}) })) }));
  const parameters = Object.fromEntries(Object.values(bound.parameters).map((p) => [p.name, { ...p, id: remap(p.id) }]));
  const values = evaluateParameters(bound.parameters);
  if (values.errors.length)
    throw new Error(`Repair source parameter expressions before insertion: ${values.errors[0].message}`);
  const profileMap = new Map<string, Map<string, string | undefined>>();
  const sourceSolved = new Map<string, ResolvedSketch>();
  const sourceProfiles = new Map<string, ReturnType<typeof detectProfiles>>();
  for (const item of documentTimeline(selected)) {
    if (item.kind !== "sketch")
      continue;
    const original = item.sketch;
    const materialized = materializeSketchProjections(bound, original, sourceSolved, sourceProfiles, values.values);
    const solved = solveSketch(materialized, values.values);
    sourceSolved.set(original.id, solved);
    const detected = detectProfiles(solved);
    sourceProfiles.set(original.id, detected);
    const before = detected.profiles;
    const sketchProfiles = new Map<string, string | undefined>();
    profileMap.set(original.id, sketchProfiles);
    const mapped = mappedSketches.find((s) => s.id === remap(original.id))!;
    const actualMapped = { ...mapped, entities: Object.fromEntries(Object.values(materialized.entities).map((e) => { const mappedEntity = entity(e); return [mappedEntity.id, mappedEntity]; })), constraints: materialized.constraints.map((c) => ({ ...c, id: remap(c.id), entityIds: c.entityIds.map(remap), ...(c.pointIds ? { pointIds: c.pointIds.map(remap) } : {}) })) };
    const after = detectProfiles(solveSketch(actualMapped, values.values)).profiles;
    for (const p of before) {
      const matches = after.filter((candidate) => profileGeometry(candidate) === profileGeometry(p));
      // Match the worker's first profiles.find result, even when legacy aliases collide.
      for (const id of [p.id, ...(p.alternateIds ?? [])]) {
        if (!sketchProfiles.has(id))
          sketchProfiles.set(id, matches.length === 1 ? matches[0].id : undefined);
      }
    }
  }
  const profile = (sketchId: string, id: string) => {
    const mapped = profileMap.get(sketchId)?.get(id);
    if (!mapped)
      throw new Error(`Source sketch profile ${id} cannot be matched after insertion. Repair the source sketch and rebuild it first.`);
    return mapped;
  };
  const mappedFeatures = features.map((f): Feature => {
    const base = { ...f, id: remap(f.id), componentId: remap(featureComponentId(bound, f)) };
    switch (f.type) {
      case "fit": return { ...f, id: base.id, componentId: base.componentId, sourceBodyId: body(f.sourceBodyId) };
      case "extrude": return { ...base, ...f, id: base.id, componentId: base.componentId, sketchId: remap(f.sketchId), profileId: profile(f.sketchId, f.profileId), ...(f.targetBodyIds ? { targetBodyIds: f.targetBodyIds.map(body) } : {}), ...(f.termination?.type === "toFace" ? { termination: { ...f.termination, faceRef: topology(f.termination.faceRef) } } : {}) };
      case "revolve": return { ...f, id: base.id, componentId: base.componentId, sketchId: remap(f.sketchId), profileId: profile(f.sketchId, f.profileId), axis: f.axis.type === "sketchLine" ? { ...f.axis, sketchId: remap(f.axis.sketchId), lineId: remap(f.axis.lineId) } : f.axis, ...(f.targetBodyIds ? { targetBodyIds: f.targetBodyIds.map(body) } : {}) };
      case "hole": return { ...f, id: base.id, componentId: base.componentId, sketchId: remap(f.sketchId), centerPointIds: f.centerPointIds.map(remap), ...(f.targetFeatureId ? { targetFeatureId: remap(f.targetFeatureId) } : {}), ...(f.targetBodyId ? { targetBodyId: body(f.targetBodyId) } : {}), ...(f.targetBodyIds ? { targetBodyIds: f.targetBodyIds.map(body) } : {}) };
      case "fillet": return { ...f, id: base.id, componentId: base.componentId, targetEdgeRefs: f.targetEdgeRefs.map(topology) };
      case "chamfer": return { ...f, id: base.id, componentId: base.componentId, targetEdgeRefs: f.targetEdgeRefs.map(topology) };
      case "pattern": return { ...f, id: base.id, componentId: base.componentId, sourceFeatureId: remap(f.sourceFeatureId), targetBodyIds: f.targetBodyIds.map(body) };
      default: {
        const exhaustive: never = f;
        return exhaustive;
      }
    }
  });
  const names = new Set(Object.values(target.components).map((c) => c.name));
  const mappedComponents = Object.fromEntries(componentIds.map((id) => {
    const original = source.components[id];
    const baseName = (id === source.rootComponentId ? source.name : original.name).slice(0, 120);
    let name = baseName, n = 2;
    while (names.has(name)) {
      const suffix = ` (${n++})`;
      name = `${baseName.slice(0, 120 - suffix.length)}${suffix}`;
    }
    names.add(name);
    return [remap(id), { id: remap(id), name, ...(original.placement ? { placement: { translation: [...original.placement.translation] as [number, number, number], rotation: [...original.placement.rotation] as [number, number, number] } } : {}) }];
  }));
  const jointFace = (id: string, componentId: string) => {
    const owners = features.filter(feature => feature.type === "extrude" && featureComponentId(bound, feature) === componentId && (
      id === stableFaceId(feature.id, "startCap") || id === stableFaceId(feature.id, "endCap") ||
      Object.keys(bound.sketches[feature.sketchId]?.entities ?? {}).some(entityId => id === stableFaceId(feature.id, "side", entityId))
    ));
    if (owners.length !== 1) throw new Error("Assembly mating face is missing, ambiguous or outside its component. Repair it before insertion.");
    return stable(id, owners[0].id);
  };
  const mappedJoints = joints.map(joint => ({ ...joint, id: remap(joint.id), parentComponentId: remap(joint.parentComponentId), childComponentId: remap(joint.childComponentId), sourceFaceId: jointFace(joint.sourceFaceId, joint.childComponentId), targetFaceId: jointFace(joint.targetFaceId, joint.parentComponentId) }));
  let imported: CadDocument = { ...selected, components: mappedComponents, assemblyJoints: mappedJoints, parameters, sketches: Object.fromEntries(mappedSketches.map((s) => [s.id, s])), features: mappedFeatures };
  const forbiddenNames = new Set(Object.keys(target.parameters));
  // Avoid capturing unresolved target symbols when a new parameter is introduced.
  mapDocumentExpressions(target, (e) => {
    try {
      for (const t of parameterTokens(e.expression))
        forbiddenNames.add(t.value);
    }
    catch { /* Existing invalid expressions remain unchanged. */ }
    return e;
  });
  const parameterNames: string[] = [];
  imported = mapDocumentExpressions(imported, (e) => ({ ...e, authoredUnit: e.authoredUnit ?? "", ...(e.parameterRefs ? { parameterRefs: Object.fromEntries(Object.entries(e.parameterRefs).map(([symbol, id]) => [symbol, remap(id)])) } : {}) }));
  imported.parameters = Object.fromEntries(Object.values(imported.parameters).map((p) => {
    let name = p.name, index = 2;
    while (forbiddenNames.has(name))
      name = `${p.name}_${index++}`;
    forbiddenNames.add(name);
    parameterNames.push(name);
    return [name, { ...p, name }];
  }));
  imported = refreshBoundNames(imported);
  const targetTimeline = documentTimeline(target), importedTimeline = documentTimeline(imported);
  const steps = new Map([...targetTimeline, ...importedTimeline].map((item, index) => [timelineItemId(item), index + 1]));
  const merged: CadDocument = { ...target, ...((target.assemblyJoints?.length || mappedJoints.length) ? { assemblyJoints: [...(target.assemblyJoints ?? []), ...mappedJoints] } : {}), timelineCursor: steps.size, updatedAt: new Date().toISOString(), components: { ...target.components, ...imported.components }, parameters: { ...target.parameters, ...imported.parameters }, sketches: Object.fromEntries([...Object.values(target.sketches), ...Object.values(imported.sketches)].map((s) => [s.id, { ...s, timelineStep: steps.get(s.id)! }])), features: [...target.features, ...imported.features].map((f) => ({ ...f, timelineStep: steps.get(f.id)! })) };
  // Check the combined portable file budget, as well as counts/depth, before changing history.
  const serialized = JSON.stringify(merged, null, 2);
  assertProjectJsonShape(parseProjectJson(serialized));
  const issues = validateDocument(merged, "storage");
  if (issues.length)
    throw new Error(`Inserted project is invalid: ${issues[0].message}`);
  return { document: merged, componentIds: componentIds.map(remap), parameterNames };
}
/** Reserve authored identities and dangling references so insertion cannot repair them by accident. */
function occupiedDocumentIds(document: CadDocument): Set<string> {
  const ids = new Set<string>([document.id, document.rootComponentId, ...(document.assemblyJoints ?? []).map(joint => joint.id), ...Object.keys(document.components), ...Object.values(document.parameters).map((p) => p.id), ...(document.viewState?.namedViews ?? []).map((v) => v.id)]);
  const addBody = (id: string) => { ids.add(id); if (id.startsWith("body:")) ids.add(id.slice(5)); };
  const addTopology = (ref: TopologyRef) => {
    ids.add(ref.featureId); ids.add(ref.transientId);
    if (ref.stableHint) ids.add(ref.stableHint);
    if (ref.sourceEntityId) ids.add(ref.sourceEntityId);
  };
  mapDocumentExpressions(document, (expression) => { Object.values(expression.parameterRefs ?? {}).forEach((id) => ids.add(id)); return expression; });
  for (const sketch of Object.values(document.sketches)) {
    ids.add(sketch.id);
    if (sketch.componentId) ids.add(sketch.componentId);
    const plane = sketch.plane.type === "face" ? sketch.plane : sketch.plane.type === "offset" && typeof sketch.plane.base !== "string" ? sketch.plane.base : undefined;
    if (plane) { ids.add(plane.featureId); ids.add(plane.stableFaceId); }
    for (const entity of Object.values(sketch.entities)) {
      ids.add(entity.id);
      if (entity.type === "line" || entity.type === "arc") { ids.add(entity.startPointId); ids.add(entity.endPointId); }
      if (entity.type === "circle" || entity.type === "arc") ids.add(entity.centerPointId);
    }
    for (const item of [...sketch.constraints, ...sketch.dimensions]) { ids.add(item.id); item.entityIds.forEach((id) => ids.add(id)); item.pointIds?.forEach((id) => ids.add(id)); }
    for (const projection of sketch.projections ?? []) {
      ids.add(projection.id); ids.add(projectionConstraintId(projection.id)); ids.add(projection.sourceFeatureId);
      projection.members.forEach((member) => { ids.add(member.sourceEntityId); ids.add(member.targetEntityId); });
    }
  }
  for (const feature of document.features) {
    ids.add(feature.id);
    if (feature.componentId) ids.add(feature.componentId);
    if ("sketchId" in feature) ids.add(feature.sketchId);
    if ("targetBodyIds" in feature) feature.targetBodyIds?.forEach(addBody);
    switch (feature.type) {
      case "extrude": if (feature.termination?.type === "toFace") addTopology(feature.termination.faceRef); break;
      case "revolve": if (feature.axis.type === "sketchLine") { ids.add(feature.axis.sketchId); ids.add(feature.axis.lineId); } break;
      case "hole": feature.centerPointIds.forEach((id) => ids.add(id)); if (feature.targetFeatureId) ids.add(feature.targetFeatureId); if (feature.targetBodyId) addBody(feature.targetBodyId); break;
      case "fillet": case "chamfer": feature.targetEdgeRefs.forEach(addTopology); break;
      case "fit": addBody(feature.sourceBodyId); break;
      case "pattern": ids.add(feature.sourceFeatureId); break;
      default: { const exhaustive: never = feature; return exhaustive; }
    }
  }
  return ids;
}

function profileGeometry(profile: SketchProfile) {
  // Profiles are matched by geometry, never by an opaque signature derived from old entity IDs.
  const coordinate = (value: number) => Math.round(value * 1e7) / 1e7;
  const segments = (loop: SketchProfile["outerLoop"]) => (loop.segments ?? []).map((s) => s.type === "line" ? [s.type, [s.start, s.end].map((p) => [coordinate(p.x), coordinate(p.y)]).sort((a, b) => a[0] - b[0] || a[1] - b[1])] : [s.type, [s.center.x, s.center.y, s.radius, s.start.x, s.start.y, s.end.x, s.end.y, s.sweep].map(coordinate)]).map((s) => JSON.stringify(s)).sort();
  return JSON.stringify({ bounds: Object.values(profile.bounds).map(coordinate), outer: [profile.outerLoop.type, segments(profile.outerLoop)], inner: profile.innerLoops.map((loop) => [loop.type, segments(loop)]).map((loop) => JSON.stringify(loop)).sort(), holes: profile.holes.map((h) => [h.x, h.y, h.radius].map(coordinate)).map((h) => JSON.stringify(h)).sort() });
}
