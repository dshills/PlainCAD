import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as documentIds from "../cad/document/ids";
import type { Sketch } from "../cad/document/schema";
import { appendProject } from "../persistence/appendProject";
import { createBoxTemplate, createMountingPlateTemplate } from "../templates/templates";
import { createEmptyDocument, upsertParameter, upsertSketch } from "../cad/document/CadDocument";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/projectCodec";
import { validateDocument } from "../cad/document/validate";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { exportMeshesToStl } from "../cad/kernel/stlExport";
import { documentTimeline, timelineItemId } from "../cad/document/timelineOrdering";
import { createExtrudeEdgeRef, resolveSupportedEdgeRef } from "../cad/features/topologyRefs";
import { useCadStore } from "../state/useCadStore";
import { applyInsertProject, beginInsertProject, cancelInsertProject, readReusableProject, useReusablePart } from "../ui/commands/reusablePartCommand";
import { useFileJobs } from "../persistence/fileJobs";
import { runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import { PROJECT_IMPORT_LIMITS } from "../persistence/importSafety";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { planSketchProjection, materializeSketchProjections, projectionConstraintId } from "../cad/sketch/sketchProjection";
import { createSketchOnPlane } from "../cad/sketch/SketchModel";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import * as profileDetection from "../cad/sketch/profileDetection";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { useInspectionState } from "../state/inspectionState";
function fileFor(text: string, read?: () => Promise<string>) {
  const file = new File([text], "part.pcaddoc");
  Object.defineProperty(file, "text", { value: read ?? (async () => text) });
  return file;
}
beforeEach(() => { cancelInsertProject(); useFileJobs.getState().cancel(); useInspectionState.setState({ picking: false }); useCadStore.getState().setDocument(createEmptyDocument()); });
afterEach(() => { cancelInsertProject(); useFileJobs.getState().cancel(); vi.restoreAllMocks(); useCadStore.setState(useCadStore.getInitialState(), true); });
describe("editable project insertion", () => {
  it("preserves target identity, cameras, metadata and timeline while independently renaming source parameters", () => {
    const target = { ...createBoxTemplate(), metadata: { preserved: true }, viewState: { cameraPosition: [1, 2, 3] as [
          number,
          number,
          number
        ] } };
    const source = { ...createBoxTemplate(), metadata: { secret: true }, timelineCursor: 0 };
    const before = serializeProject(target), originalSource = serializeProject(source);
    const result = appendProject(target, source);
    expect(serializeProject(target)).toBe(before);
    expect(serializeProject(source)).toBe(originalSource);
    expect(result.document.id).toBe(target.id);
    expect(result.document.rootComponentId).toBe(target.rootComponentId);
    expect(result.document.metadata).toEqual({ preserved: true });
    expect(result.document.viewState).toBe(target.viewState);
    expect(result.parameterNames).toEqual(["width_2", "height_2", "depth_2"]);
    expect(documentTimeline(result.document).map(timelineItemId).slice(0, 2)).toEqual(documentTimeline(target).map(timelineItemId));
    expect(result.document.features[1]).toMatchObject({ type: "extrude", distance: { expression: "depth_2", parameterRefs: { depth_2: result.document.parameters.depth_2.id } } });
    expect(validateDocument(result.document, "storage")).toEqual([]);
    const roundtrip = importProjectText(serializeProject(result.document));
    const rebuilt = rebuildDocument(roundtrip);
    expect(rebuilt.success).toBe(true);
    expect(rebuilt.meshes).toHaveLength(2);
    expect(rebuilt.meshes[1].bounds).toEqual(rebuilt.meshes[0].bounds);
    expect(exportMeshesToStl(rebuilt.meshes).byteLength).toBeGreaterThan(84);
    const edited = upsertParameter(roundtrip, { ...roundtrip.parameters.width_2, expression: "120mm" });
    const next = rebuildDocument(edited);
    expect(next.meshes[0].bounds.max[0]).toBe(40);
    expect(next.meshes[1].bounds.max[0]).toBe(60);
  });
  it("remaps an explicit entity named all while preserving the whole-perimeter sentinel", () => {
    const source = createBoxTemplate(), owner = source.features[0], sketch = Object.values(source.sketches)[0];
    const line = Object.values(sketch.entities).find((e) => e.type === "line")!;
    delete sketch.entities[line.id];
    sketch.entities.all = { ...line, id: "all" };
    sketch.constraints = sketch.constraints.map((c) => ({ ...c, entityIds: c.entityIds.map((id) => id === line.id ? "all" : id) }));
    sketch.dimensions = sketch.dimensions.map((d) => ({ ...d, entityIds: d.entityIds.map((id) => id === line.id ? "all" : id) }));
    source.features.push({ id: "treatment", name: "Explicit all entity", type: "fillet", radius: { expression: "1mm", unit: "mm" }, targetEdgeRefs: [createExtrudeEdgeRef(owner.id, "profileEdge", "all"), createExtrudeEdgeRef(owner.id, "endCapPerimeter")], timelineStep: 3 });
    source.sketches.side = { ...sketch, id: "side", name: "Side of all", entities: {}, constraints: [], dimensions: [], plane: { type: "face", featureId: owner.id, stableFaceId: `extrude:${owner.id}:side:all` }, timelineStep: 4 };
    const imported = appendProject(createEmptyDocument(), source).document;
    const treatment = imported.features[1];
    if (treatment.type !== "fillet") throw new Error("Expected imported treatment");
    const explicit = treatment.targetEdgeRefs[0], perimeter = treatment.targetEdgeRefs[1];
    expect(explicit.sourceEntityId).toMatch(/^insert_.*:all$/);
    expect(explicit.stableHint).toBe(`extrude:${imported.features[0].id}:profileEdge:${explicit.sourceEntityId}`);
    expect("error" in resolveSupportedEdgeRef(imported, explicit)).toBe(false);
    expect(perimeter.sourceEntityId).toBeUndefined();
    expect(perimeter.stableHint).toBe(`extrude:${imported.features[0].id}:endCapPerimeter:all`);
    expect("error" in resolveSupportedEdgeRef(imported, perimeter)).toBe(false);
    expect(Object.values(imported.sketches).find((s) => s.name === "Side of all")!.plane).toEqual({ type: "face", featureId: imported.features[0].id, stableFaceId: `extrude:${imported.features[0].id}:side:${explicit.sourceEntityId}` });
  });
  it("scopes ambiguous legacy circle profile aliases to their source sketches", () => {
    const source = createEmptyDocument("Alias collision");
    const circleSketch = (id: string, circleId: string, centerId: string, x: number, radius: number, step: number): Sketch => ({
      id, name: id, plane: { type: "origin", plane: "XY" }, componentId: source.rootComponentId, timelineStep: step, solveMode: "driving",
      entities: {
        [centerId]: { id: centerId, type: "point", x: { expression: `${x}mm`, unit: "mm" }, y: { expression: "0mm", unit: "mm" } },
        [circleId]: { id: circleId, type: "circle", centerPointId: centerId, radius: { expression: `${radius}mm`, unit: "mm" } },
      }, constraints: [], dimensions: [],
    });
    const first = circleSketch("A", "B:profile:C", "centerA", 0, 5, 1);
    const second = circleSketch("A:profile:B", "C", "centerB", 30, 10, 3);
    source.sketches = { [first.id]: first, [second.id]: second };
    const alias = "A:profile:B:profile:C";
    source.features = [first, second].map((sketch, index) => ({ id: `solid${index}`, name: `Circle ${index}`, type: "extrude", sketchId: sketch.id, profileId: alias, operation: "newBody", distance: { expression: "5mm", unit: "mm" }, direction: "positive", componentId: source.rootComponentId, timelineStep: index * 2 + 2 }));
    expect(validateDocument(source, "storage")).toEqual([]);
    expect(rebuildDocument(source).success).toBe(true);
    const copied = appendProject(createEmptyDocument(), source).document;
    for (const feature of copied.features) {
      if (feature.type !== "extrude") throw new Error("Expected imported extrusion");
      const ownProfiles = detectProfiles(solveSketch(copied.sketches[feature.sketchId], {})).profiles;
      expect(ownProfiles.some((profile) => profile.id === feature.profileId)).toBe(true);
    }
    expect(copied.features[0].id).not.toBe(copied.features[1].id);
    const rebuilt = rebuildDocument(copied);
    expect(rebuilt.success).toBe(true); expect(rebuilt.meshes).toHaveLength(2);
    expect(rebuilt.meshes[0].bounds.max[0]).toBeCloseTo(5, 7);
    expect(rebuilt.meshes[1].bounds.max[0]).toBeCloseTo(40, 7);
  });
  it.each([false, true])("preserves first-match aliases in one sketch and rejects unmatched first candidate=%s", (missingFirst) => {
    const source = createEmptyDocument("Same sketch alias");
    const sketch: Sketch = {
      id: "circles", name: "Two circles", plane: { type: "origin", plane: "XY" }, timelineStep: 1, solveMode: "driving",
      entities: {
        firstCenter: { id: "firstCenter", type: "point", x: { expression: "0mm", unit: "mm" }, y: { expression: "0mm", unit: "mm" } },
        firstCurve: { id: "firstCurve", type: "circle", centerPointId: "firstCenter", radius: { expression: "10mm", unit: "mm" } },
      }, constraints: [], dimensions: [],
    };
    const first = detectProfiles(solveSketch(sketch, {})).profiles[0];
    const collidingCircleId = first.signature;
    sketch.entities.secondCenter = { id: "secondCenter", type: "point", x: { expression: "40mm", unit: "mm" }, y: { expression: "0mm", unit: "mm" } };
    sketch.entities[collidingCircleId] = { id: collidingCircleId, type: "circle", centerPointId: "secondCenter", radius: { expression: "5mm", unit: "mm" } };
    const profiles = detectProfiles(solveSketch(sketch, {})).profiles;
    expect(profiles.filter((profile) => profile.id === first.id || profile.alternateIds?.includes(first.id))).toHaveLength(2);
    source.sketches[sketch.id] = sketch;
    source.features = [{ id: "solid", name: "First matching circle", type: "extrude", sketchId: sketch.id, profileId: first.id, operation: "newBody", distance: { expression: "5mm", unit: "mm" }, direction: "positive", timelineStep: 2 }];
    const before = rebuildDocument(source); expect(before.success).toBe(true);
    const target = createEmptyDocument();
    if (missingFirst) {
      const originalDetect = profileDetection.detectProfiles;
      vi.spyOn(profileDetection, "detectProfiles").mockReturnValueOnce({ profiles, errors: [] }).mockImplementationOnce((solved) => {
        const remapped = originalDetect(solved);
        return { ...remapped, profiles: remapped.profiles.filter((profile) => profile.bounds.minX > 30) };
      });
      const unchanged = serializeProject(target);
      expect(() => appendProject(target, source)).toThrow(/cannot be matched after insertion/);
      expect(serializeProject(target)).toBe(unchanged);
      return;
    }
    const copied = appendProject(target, source).document;
    const after = rebuildDocument(copied); expect(after.success).toBe(true);
    expect(after.meshes[0].bounds).toEqual(before.meshes[0].bounds);
    expect(after.meshes[0].positions).toEqual(before.meshes[0].positions);
  });
  it("copies a complex holed profile through hashed profile ID remapping", () => {
    const source = createMountingPlateTemplate();
    const first = rebuildDocument(source);
    expect(first.success).toBe(true);
    const owner = source.features[0];
    if (owner.type !== "extrude")
      throw new Error("Expected extrusion");
    owner.profileId = first.profiles![owner.sketchId][0].id;
    const appended = appendProject(createEmptyDocument(), source).document;
    const rebuilt = rebuildDocument(appended);
    expect(rebuilt.success).toBe(true);
    expect(rebuilt.meshes[0].positions).toEqual(first.meshes[0].positions);
    expect(rebuilt.meshes[0].indices).toEqual(first.meshes[0].indices);
  });
  it("repeated insertions remap every entity/constraint/dimension/feature and leave no duplicate IDs", () => {
    const source = createBoxTemplate(), first = appendProject(source, source), second = appendProject(first.document, source);
    expect(validateDocument(second.document, "storage")).toEqual([]);
    expect(second.parameterNames).toContain("width_3");
    expect(second.componentIds[0]).not.toBe(first.componentIds[0]);
    expect(rebuildDocument(second.document).meshes).toHaveLength(3);
  });
  it.each(["parameter", "legacyHole", "axis"] as const)("retries prefixes that would capture a dangling %s reference", (kind) => {
    const target = createBoxTemplate(), source = createBoxTemplate();
    const conflict = "insert_conflict", owner = source.features[0], sourceSketch = Object.values(source.sketches)[0];
    const oldSketch = Object.values(target.sketches)[0], center = Object.values(oldSketch.entities).find((e) => e.type === "point")!;
    if (kind === "parameter") target.parameters.broken = { id: "broken", name: "broken", expression: "lost", value: 0, unit: "mm", parameterRefs: { lost: `${conflict}:${owner.id}` } };
    if (kind === "legacyHole") target.features.push({ id: "legacy", name: "Unresolved hole", type: "hole", sketchId: oldSketch.id, centerPointIds: [center.id], diameter: { expression: "1mm", unit: "mm" }, depth: "throughAll", targetBodyIds: [], targetFeatureId: `${conflict}:${owner.id}`, targetBodyId: `body:${conflict}:${owner.id}`, timelineStep: 3 });
    if (kind === "axis") target.features.push({ id: "axis", name: "Unresolved axis", type: "revolve", sketchId: oldSketch.id, profileId: `${oldSketch.id}:profile:rectangle`, axis: { type: "sketchLine", sketchId: `${conflict}:${sourceSketch.id}`, lineId: `${conflict}:${Object.values(sourceSketch.entities).find((e) => e.type === "line")!.id}` }, angle: { expression: "360deg", unit: "deg" }, operation: "newBody", timelineStep: 3 });
    const before = serializeProject(target);
    const allocate = vi.spyOn(documentIds, "createId").mockReturnValueOnce(conflict).mockReturnValue("insert_safe");
    const inserted = appendProject(target, source);
    expect(allocate).toHaveBeenCalledTimes(2);
    expect(inserted.componentIds[0]).toMatch(/^insert_safe:/);
    expect(serializeProject(target)).toBe(before);
    expect(inserted.document.features.slice(0, target.features.length)).toEqual(target.features);
  });
  it("bounds allocator retries and leaves the destination unchanged when independent IDs cannot be allocated", () => {
    const target = createBoxTemplate(), source = createBoxTemplate();
    target.parameters.broken = { id: "broken", name: "broken", expression: "lost", value: 0, unit: "mm", parameterRefs: { lost: `insert_collision:${source.features[0].id}` } };
    const before = serializeProject(target);
    const allocate = vi.spyOn(documentIds, "createId").mockReturnValue("insert_collision");
    expect(() => appendProject(target, source)).toThrow(/Could not allocate independent insertion IDs/);
    expect(allocate).toHaveBeenCalledTimes(8); expect(serializeProject(target)).toBe(before);
  });
  it.each(["transientId", "stableHint"] as const)("rejects %s that conflicts with the explicit source entity instead of repairing it by guess", (field) => {
    const source = createBoxTemplate(), target = createEmptyDocument(), owner = source.features[0], sketch = Object.values(source.sketches)[0];
    const lines = Object.values(sketch.entities).filter((e) => e.type === "line");
    const ref = createExtrudeEdgeRef(owner.id, "profileEdge", lines[0].id);
    ref[field] = createExtrudeEdgeRef(owner.id, "profileEdge", lines[1].id).transientId;
    source.features.push({ id: "fillet", name: "Broken identity", type: "fillet", radius: { expression: "1mm", unit: "mm" }, targetEdgeRefs: [ref], timelineStep: 3 });
    const before = serializeProject(target);
    expect(() => appendProject(target, source)).toThrow(/does not match its explicit entity ID/);
    expect(serializeProject(target)).toBe(before);
  });
  it("retains legacy strict and explicit authored-unit semantics in a different-unit destination", () => {
    const source = createBoxTemplate();
    source.parameters.width = { ...source.parameters.width, expression: "80", authoredUnit: "mm" };
    const target = { ...createEmptyDocument(), units: "imperial" as const, unitSettings: { length: "in" as const, angle: "rad" as const } };
    const appended = appendProject(target, source).document;
    expect(appended.parameters.height.authoredUnit).toBe("");
    expect(rebuildDocument(appended).meshes[0].bounds.max[0]).toBe(40);
  });
  it("remaps supported face and edge references", () => {
    const source = createBoxTemplate(), owner = source.features[0], sketch = Object.values(source.sketches)[0];
    const line = Object.values(sketch.entities).find((e) => e.type === "line")!;
    const copy = { ...sketch, id: "face-sketch", name: "On face", entities: {}, constraints: [], dimensions: [], timelineStep: 3, plane: { type: "face" as const, featureId: owner.id, stableFaceId: `extrude:${owner.id}:endCap` } };
    source.sketches[copy.id] = copy;
    source.features.push({ id: "fillet", name: "Fillet", type: "fillet", radius: { expression: "1mm", unit: "mm" }, targetEdgeRefs: [createExtrudeEdgeRef(owner.id, "profileEdge", line.id)], timelineStep: 4 });
    const result = appendProject(createEmptyDocument(), source).document;
    const newOwner = result.features[0], mappedFace = Object.values(result.sketches).find((s) => s.name === "On face")!;
    expect(mappedFace.plane).toEqual({ type: "face", featureId: newOwner.id, stableFaceId: `extrude:${newOwner.id}:endCap` });
    const fillet = result.features[1];
    if (fillet.type !== "fillet")
      throw new Error("Expected fillet");
    expect(fillet.targetEdgeRefs[0].featureId).toBe(newOwner.id);
    expect(fillet.targetEdgeRefs[0].stableHint).toContain(newOwner.id);
    expect(fillet.targetEdgeRefs[0].sourceEntityId).not.toBe(line.id);
  });
  it.each([true, false])("copies linked projection ownership and follows source with persisted owned constraint=%s", (persistedFixed) => {
    const base = createBoxTemplate(), owner = base.features[0];
    if (owner.type !== "extrude")
      throw new Error("Expected extrusion");
    const target = createSketchOnPlane("Cover", { type: "offset", base: "XY", offset: { expression: "25mm", unit: "mm" } });
    const document = upsertSketch(base, target), nativeChoices = rebuildDocument(document);
    nativeChoices.availableEdges = [{ featureId: owner.id, bodyId: `body:${owner.id}`, role: "endCapPerimeter" }];
    const planned = planSketchProjection(document, target.id, owner.id, "endCapPerimeter", false, nativeChoices);
    if (!persistedFixed)
      planned.document.sketches[target.id].constraints = [];
    const appended = appendProject(createBoxTemplate(), planned.document).document;
    const imported = Object.values(appended.sketches).find((s) => s.name === "Cover")!;
    const projection = imported.projections![0];
    expect(projection.id).not.toBe(planned.projection.id);
    expect(projection.sourceFeatureId).not.toBe(owner.id);
    expect(imported.constraints.some((c) => c.id === projectionConstraintId(projection.id))).toBe(persistedFixed);
    expect(validateDocument(appended, "storage")).toEqual([]);
    const edited = upsertParameter(appended, { ...appended.parameters.width_2, expression: "100mm" });
    const params = evaluateParameters(edited.parameters).values;
    const copiedOwner = edited.features.find((f) => f.id === projection.sourceFeatureId)!;
    if (copiedOwner.type !== "extrude")
      throw new Error("Expected copied extrusion");
    const source = solveSketch(edited.sketches[copiedOwner.sketchId], params);
    const materialized = materializeSketchProjections(edited, imported, new Map([[copiedOwner.sketchId, source]]), new Map([[copiedOwner.sketchId, detectProfiles(source)]]), params);
    expect(Math.max(...Object.values(solveSketch(materialized, params).points).map((p) => p.x))).toBeCloseTo(50, 7);
    expect(materialized.constraints.filter((c) => c.id === projectionConstraintId(projection.id))).toHaveLength(1);
  });
  it("remaps associative pattern sources, body scopes and scalar/length expression bindings", () => {
    const source = createBoxTemplate(), owner = source.features[0], sketch = Object.values(source.sketches)[0];
    const center = Object.values(sketch.entities).find((e) => e.type === "point")!;
    source.parameters.copies = { id: "copies", name: "copies", expression: "3", authoredUnit: "", value: 3, unit: "" };
    source.features.push({ id: "hole", name: "Hole", type: "hole", sketchId: sketch.id, centerPointIds: [center.id], diameter: { expression: "2mm", unit: "mm" }, depth: "throughAll", targetBodyIds: [`body:${owner.id}`], targetBodyId: `body:${owner.id}`, targetFeatureId: owner.id, timelineStep: 3 });
    source.features.push({ id: "pattern", name: "Repeat hole", type: "pattern", sourceFeatureId: "hole", targetBodyIds: [`body:${owner.id}`], pattern: { type: "linear", direction: "X", count: { expression: "copies", unit: "" }, spacing: { expression: "width / 4", unit: "mm" } }, timelineStep: 4 });
    const appended = appendProject(createBoxTemplate(), source).document;
    const hole = appended.features[2], pattern = appended.features[3];
    if (hole.type !== "hole" || pattern.type !== "pattern")
      throw new Error("Expected copied operations");
    expect(pattern.sourceFeatureId).toBe(hole.id);
    expect(pattern.targetBodyIds).toEqual([`body:${appended.features[1].id}`]);
    expect(hole.targetBodyId).toBe(pattern.targetBodyIds[0]);
    expect(hole.targetFeatureId).toBe(appended.features[1].id);
    if (pattern.pattern.type !== "linear")
      throw new Error("Expected linear settings");
    expect(pattern.pattern.spacing.expression).toBe("width_2 / 4");
    expect(pattern.pattern.count.parameterRefs).toEqual({ copies: appended.parameters.copies.id });
    expect(serializeProject(importProjectText(serializeProject(appended)))).toBe(serializeProject(appended));
  });
  it("refuses unresolved bindings, unresolved symbols and missing profiles instead of capturing destination objects", () => {
    const source = createBoxTemplate();
    source.parameters.depth.parameterRefs = { missing: "lost" };
    source.parameters.depth.expression = "missing";
    expect(() => appendProject(createEmptyDocument(), source)).toThrow(/parameter references/);
    const symbols = createBoxTemplate();
    symbols.features[0] = { ...symbols.features[0], distance: { expression: "external", unit: "mm" } } as typeof symbols.features[0];
    expect(() => appendProject(createEmptyDocument(), symbols)).toThrow(/Unresolved source parameter external/);
    const profile = createBoxTemplate();
    if (profile.features[0].type === "extrude")
      profile.features[0].profileId = "lost-profile";
    expect(() => appendProject(createEmptyDocument(), profile)).toThrow(/cannot be matched/);
  });
  it("avoids introducing parameter names used by unresolved destination expressions", () => {
    const target = createEmptyDocument();
    target.parameters.other = { id: "other", name: "other", expression: "width", value: 0, unit: "mm" };
    const result = appendProject(target, createBoxTemplate());
    expect(result.parameterNames).toContain("width_2");
    expect(result.document.parameters.other.expression).toBe("width");
  });
  it("allows explicit single-component insertion and refuses references outside that scope", () => {
    const source = createBoxTemplate(), original = Object.values(source.sketches)[0];
    source.components.second = { id: "second", name: "Second" };
    const face = { ...original, id: "second-sketch", componentId: "second", name: "Dependent", entities: {}, constraints: [], dimensions: [], plane: { type: "face" as const, featureId: source.features[0].id, stableFaceId: `extrude:${source.features[0].id}:endCap` } };
    source.sketches[face.id] = face;
    expect(() => appendProject(createEmptyDocument(), source, { componentId: "second" })).toThrow(/outside the selected component/);
    const inserted = appendProject(createEmptyDocument(), source, { componentId: source.rootComponentId });
    expect(inserted.componentIds).toHaveLength(1);
    expect(Object.values(inserted.document.sketches)).toHaveLength(1);
  });
  it("enforces combined component, parameter, and portable byte limits before applying", () => {
    const target = createEmptyDocument();
    for (let i = 1; i < MODEL_RESOURCE_LIMITS.maxComponents; i++)
      target.components[`c${i}`] = { id: `c${i}`, name: `Component ${i}` };
    expect(() => appendProject(target, createBoxTemplate())).toThrow(/too many components/);
    const parameters = createEmptyDocument();
    for (let i = 0; i < PROJECT_IMPORT_LIMITS.maxParameters; i++)
      parameters.parameters[`p${i}`] = { id: `p${i}`, name: `p${i}`, expression: "1mm", value: 1, unit: "mm" };
    expect(() => appendProject(parameters, createBoxTemplate())).toThrow(/too many parameters/);
    expect(() => appendProject({ ...createEmptyDocument(), metadata: { oversized: "x".repeat(PROJECT_IMPORT_LIMITS.maxBytes) } }, createBoxTemplate())).toThrow(/too large/);
  });
  it("sets the next authored timeline step and requires a nonempty existing source scope", () => {
    expect(appendProject(createEmptyDocument(), createBoxTemplate()).document.timelineCursor).toBe(2);
    expect(() => appendProject(createEmptyDocument(), createEmptyDocument())).toThrow(/contains no sketches/);
    expect(() => appendProject(createEmptyDocument(), createBoxTemplate(), { componentId: "missing" })).toThrow(/no longer exists/);
  });
});
describe("insertion task ownership", () => {
  it("uses one undoable document edit and preserves project session; undo/redo restore imported geometry", async () => {
    const target = createBoxTemplate();
    useCadStore.getState().setDocument(target);
    const session = useCadStore.getState().documentSession;
    await runCommand("file.insertProject");
    await readReusableProject(fileFor(serializeProject(createMountingPlateTemplate())));
    applyInsertProject({});
    expect(useReusablePart.getState().frame).toBeUndefined();
    expect(useCadStore.getState().documentSession).toBe(session);
    expect(useCadStore.getState().history.past).toHaveLength(1);
    expect(rebuildDocument(useCadStore.getState().history.present).meshes).toHaveLength(2);
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present.id).toBe(target.id);
    expect(rebuildDocument(useCadStore.getState().history.present).meshes).toHaveLength(1);
    useCadStore.getState().redo();
    expect(rebuildDocument(useCadStore.getState().history.present).meshes).toHaveLength(2);
  });
  it("rejects stale validation and stale apply without changing current project", async () => {
    beginInsertProject();
    let release!: (text: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const reading = readReusableProject(fileFor("", () => pending));
    useCadStore.getState().setDocument(createBoxTemplate());
    release(serializeProject(createBoxTemplate()));
    await reading;
    expect(useReusablePart.getState().frame?.error).toContain("Project changed");
    expect(useCadStore.getState().history.past).toHaveLength(0);
    cancelInsertProject();
    beginInsertProject();
    await readReusableProject(fileFor(serializeProject(createBoxTemplate())));
    useCadStore.getState().updateDocument((d) => ({ ...d, name: "Changed" }));
    applyInsertProject({});
    expect(useReusablePart.getState().frame?.error).toContain("Project changed");
    expect(useCadStore.getState().history.present.features).toHaveLength(1);
  });
  it("cancels async parsing and rejects unsafe file keys without importing anything", async () => {
    beginInsertProject();
    await readReusableProject(fileFor('{"__proto__":{}}'));
    expect(useReusablePart.getState().frame?.error).toContain("unsafe key");
    expect(useCadStore.getState().history.past).toHaveLength(0);
    cancelInsertProject();
    beginInsertProject();
    let release!: (text: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const reading = readReusableProject(fileFor("", () => pending));
    cancelInsertProject();
    release(serializeProject(createBoxTemplate()));
    await reading;
    expect(useReusablePart.getState().frame).toBeUndefined();
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
  it("blocks other tasks while insertion is open and blocks insertion during model measurement", () => {
    beginInsertProject();
    const enabled = selectCommandEnablement(useCadStore.getState());
    expect(enabled.insertProject).toBe(false);
    expect(enabled.newComponent).toBe(false);
    expect(enabled.createSketch).toBe(false);
    cancelInsertProject();
    useInspectionState.getState().setPicking(useCadStore.getState().documentSession, true);
    expect(selectCommandEnablement(useCadStore.getState()).insertProject).toBe(false);
    beginInsertProject();
    expect(useReusablePart.getState().frame).toBeUndefined();
  });
});
