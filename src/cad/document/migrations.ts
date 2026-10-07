import { featureComponentId } from "./components";
import { targetBodyIds } from "./bodyScopes";
import { CURRENT_SCHEMA_VERSION, CadDocument, Feature, Sketch } from "./schema";
import { stableBodyIdForFeature } from "../features/featureGraph";

type Migration = (input: CadDocument) => CadDocument;

const migrations = new Map<number, Migration>([
  [1, migrateV1ToV2],
  [2, migrateV2ToV3],
  [3, migrateV3ToV4],
  [4, migrateV4ToV5],
  [5, migrateV5ToV6],
  [6, migrateV6ToV7],
  [7, (document) => ({ ...document, schemaVersion: 8 })],
  [8, (document) => ({ ...document, schemaVersion: 9 })],
  [9, (document) => ({ ...document, schemaVersion: 10, displayUnits: document.displayUnits ?? { ...document.unitSettings } })],
  [10, migrateV10ToV11],
  [11, migrateV11ToV12],
  [12, migrateV12ToV13],
  [13, (document) => ({ ...document, schemaVersion: 14 })],
]);

function migrateV12ToV13(document: CadDocument): CadDocument {
  return {
    ...document,
    schemaVersion: 13,
    features: document.features.map((feature) => {
      if (feature.type !== "hole") return feature;
      // Earlier schemas always drilled positive; unknown legacy fields cannot change that behavior.
      const { direction: _direction, ...legacy } = feature;
      return legacy;
    }),
  };
}

export function migrateDocument(input: CadDocument): CadDocument {
  if (!Number.isInteger(input.schemaVersion)) {
    throw new Error("Project file is missing a schema version.");
  }
  if (input.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version ${input.schemaVersion}.`,
    );
  }

  let document = input;
  if (document.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return sanitizeCurrentDocument(document);
  }
  while (document.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.get(document.schemaVersion);
    if (!migration)
      throw new Error(
        `Unsupported project schema version ${document.schemaVersion}.`,
      );
    document = migration(document);
  }
  return sanitizeCurrentDocument(document);
}

function migrateV1ToV2(input: CadDocument): CadDocument {
  return withTimelineMetadata({ ...input, schemaVersion: 2 });
}

function migrateV2ToV3(input: CadDocument): CadDocument {
  return {
    ...input,
    schemaVersion: 3,
    sketches: Object.fromEntries(
      Object.entries(input.sketches ?? {}).map(([id, sketch]) => [
        id,
        { ...sketch, plane: normalizePlaneReference((sketch as { plane?: unknown }).plane) },
      ]),
    ),
  };
}

function migrateV3ToV4(input: CadDocument): CadDocument {
  return {
    ...input,
    schemaVersion: 4,
    features: Array.isArray(input.features)
      ? input.features.map((feature) =>
          isRecord(feature) && feature.type === "extrude"
            ? {
                ...feature,
                termination: feature.termination ?? { type: "distance", distance: feature.distance ?? { expression: "0mm", unit: "mm" } },
                targetBodyIds: feature.targetBodyIds ?? [],
              }
            : feature,
        )
      : input.features,
  };
}

function migrateV4ToV5(input: CadDocument): CadDocument {
  return {
    ...input,
    schemaVersion: 5,
    features: Array.isArray(input.features)
      ? input.features.map((feature) =>
          isRecord(feature) && feature.type === "hole" && feature.targetFeatureId && !feature.targetBodyId
            ? { ...feature, targetBodyId: stableBodyIdForFeature(String(feature.targetFeatureId)) }
            : feature,
        )
      : input.features,
  };
}

function migrateV5ToV6(input: CadDocument): CadDocument {
  return { ...input, schemaVersion: 6 };
}

function migrateV6ToV7(input: CadDocument): CadDocument {
  return {
    ...input,
    schemaVersion: 7,
    sketches: Object.fromEntries(
      Object.entries(input.sketches ?? {}).map(([id, sketch]) => [
        id,
        isRecord(sketch) ? { ...sketch, solveMode: "validate" } : sketch,
      ]),
    ),
  };
}

function migrateV10ToV11(input: CadDocument): CadDocument {
  return {
    ...input,
    schemaVersion: 11,
    features: Array.isArray(input.features)
      ? input.features.map((feature) => {
          if (!isRecord(feature) || feature.type !== "hole") return feature;
          assertHoleTargetScope(feature);
          const normalized = { ...feature, targetBodyIds: targetBodyIds(feature) };
          delete normalized.targetBodyId;
          delete normalized.targetFeatureId;
          return normalized;
        })
      : input.features,
  };
}

function migrateV11ToV12(document: CadDocument): CadDocument {
  if (!isRecord(document.sketches)) throw new Error("Project file is missing sketches.");
  if (!Array.isArray(document.features)) throw new Error("Project file is missing features.");
  // Deterministic ownership preserves recovery equality and stable legacy IDs.
  const ids = new Set<string>();
  const stack: unknown[] = [document];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if ("id" in value && typeof value.id === "string") ids.add(value.id);
    for (const child of Object.values(value)) stack.push(child);
  }
  let rootComponentId = `component:${document.id}:root`;
  while (ids.has(rootComponentId)) rootComponentId += ":root";
  return {
    ...document, schemaVersion: 12, rootComponentId,
    components: { [rootComponentId]: { id: rootComponentId, name: "Root Component" } },
    sketches: Object.fromEntries(Object.entries(document.sketches).map(([id, sketch]) => [id, { ...sketch, componentId: rootComponentId }])),
    features: document.features.map(feature => ({ ...feature, componentId: rootComponentId })),
  };
}

function sanitizeCurrentDocument(input: CadDocument): CadDocument {
  const rawParameters = isRecord(input.parameters) ? input.parameters : {};
  const rawSketches = isRecord(input.sketches) ? input.sketches : {};
  const rawUnitSettings = isRecord(input.unitSettings) ? input.unitSettings : undefined;
  const parameters = Object.fromEntries(
    Object.entries(rawParameters).map(([key, parameter]) => {
      const record: Record<string, any> = isRecord(parameter) ? parameter : {};
      return [
        key,
        {
          id: record.id,
          name: record.name,
          expression: record.expression,
          ...(record.authoredUnit !== undefined ? { authoredUnit: record.authoredUnit } : {}),
          ...(record.group !== undefined ? { group: record.group } : {}),
          ...(record.parameterRefs !== undefined ? { parameterRefs: record.parameterRefs } : {}),
          value: record.value,
          unit: record.unit,
          ...(record.description !== undefined ? { description: record.description } : {}),
          ...(record.locked !== undefined ? { locked: record.locked } : {}),
        },
      ];
    }),
  );
  const sketches = Object.fromEntries(
    Object.entries(rawSketches).map(([key, sketch]) => [key, { ...sanitizeSketch(sketch), componentId: isRecord(sketch) && sketch.componentId !== undefined ? sketch.componentId : input.rootComponentId }]),
  );
  const featureDrafts = Array.isArray(input.features)
    ? input.features.map(sanitizeFeature).filter((feature): feature is Feature => !!feature) : [];
  const ownershipDocument = { ...input, sketches, features: featureDrafts };
  const features = featureDrafts.map(feature => ({
    ...feature,
    componentId: feature.componentId !== undefined ? feature.componentId : featureComponentId(ownershipDocument, feature),
  }));

  return {
    schemaVersion: input.schemaVersion,
    id: input.id,
    name: input.name,
    units: input.units,
    unitSettings: rawUnitSettings
      ? {
          length: rawUnitSettings.length,
          angle: rawUnitSettings.angle,
          ...(rawUnitSettings.mass !== undefined ? { mass: rawUnitSettings.mass } : {}),
        }
      : (undefined as any),
    createdAt: input.createdAt,
    ...(input.displayUnits !== undefined ? { displayUnits: isRecord(input.displayUnits) ? {
      length: input.displayUnits.length, angle: input.displayUnits.angle,
      ...(input.displayUnits.mass !== undefined ? { mass: input.displayUnits.mass } : {}),
    } : input.displayUnits } : {}),
    updatedAt: input.updatedAt,
    ...(input.timelineCursor !== undefined ? { timelineCursor: input.timelineCursor } : {}),
    rootComponentId: input.rootComponentId,
    components: isRecord(input.components) ? Object.fromEntries(Object.entries(input.components).map(([id, component]) => [id, isRecord(component) ? { id: component.id, name: component.name } : component])) : input.components,
    parameters,
    sketches,
    features,
    ...(input.viewState
      ? {
          viewState: {
            ...(input.viewState.namedViews !== undefined ? { namedViews: Array.isArray(input.viewState.namedViews) ? input.viewState.namedViews.map((view) => ({
              id: view?.id, name: view?.name, cameraPosition: view?.cameraPosition,
              cameraTarget: view?.cameraTarget, cameraUp: view?.cameraUp,
            })) : input.viewState.namedViews } : {}),
            ...(input.viewState.cameraPosition ? { cameraPosition: input.viewState.cameraPosition } : {}),
            ...(input.viewState.cameraTarget ? { cameraTarget: input.viewState.cameraTarget } : {}),
          },
        }
      : {}),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  };
}

function sanitizeSketch(sketch: Sketch): Sketch {
  const sketchRecord: Record<string, any> = isRecord(sketch) ? sketch : {};
  return {
    id: sketchRecord.id,
    name: sketchRecord.name,
    ...(sketchRecord.componentId !== undefined ? { componentId: sketchRecord.componentId } : {}),
    plane: normalizePlaneReference(sketchRecord.plane),
    ...(sketchRecord.solveRevision !== undefined
      ? { solveRevision: sketchRecord.solveRevision }
      : {}),
    ...(sketchRecord.solveMode !== undefined
      ? { solveMode: sketchRecord.solveMode }
      : {}),
    ...(sketchRecord.timelineStep !== undefined
      ? { timelineStep: sketchRecord.timelineStep }
      : {}),
    ...(sketchRecord.createdAt !== undefined
      ? { createdAt: sketchRecord.createdAt }
      : {}),
    entities: Object.fromEntries(
      Object.entries(
        isRecord(sketchRecord.entities) ? sketchRecord.entities : {},
      ).map(([key, entity]) => [key, sanitizeEntity(entity)]),
    ) as Sketch["entities"],
    constraints: Array.isArray(sketchRecord.constraints)
      ? (sketchRecord.constraints.map((constraint: unknown) =>
          isRecord(constraint)
            ? {
                id: constraint.id,
                type: constraint.type,
                entityIds: Array.isArray(constraint.entityIds)
                  ? [...constraint.entityIds]
                  : constraint.entityIds,
                ...(constraint.pointIds !== undefined
                  ? {
                      pointIds: Array.isArray(constraint.pointIds)
                        ? [...constraint.pointIds]
                        : constraint.pointIds,
                    }
                  : {}),
              }
            : constraint,
        ) as Sketch["constraints"])
      : [],
    dimensions: Array.isArray(sketchRecord.dimensions)
      ? (sketchRecord.dimensions.map((dimension: unknown) => {
          const dimensionRecord = isRecord(dimension) ? dimension : {};
          return {
            id: dimensionRecord.id,
            type: dimensionRecord.type,
            entityIds: Array.isArray(dimensionRecord.entityIds)
              ? [...dimensionRecord.entityIds]
              : dimensionRecord.entityIds,
            ...(dimensionRecord.pointIds !== undefined
              ? {
                  pointIds: Array.isArray(dimensionRecord.pointIds)
                    ? [...dimensionRecord.pointIds]
                    : dimensionRecord.pointIds,
                }
              : {}),
            expression: sanitizeExpressionRef(dimensionRecord.expression),
          };
        }) as Sketch["dimensions"])
      : [],
  };
}

function sanitizeEntity(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const base = {
    id: value.id,
    type: value.type,
    ...(value.construction !== undefined
      ? { construction: value.construction }
      : {}),
  };
  if (value.type === "point")
    return {
      ...base,
      x: sanitizeExpressionRef(value.x),
      y: sanitizeExpressionRef(value.y),
    };
  if (value.type === "line")
    return {
      ...base,
      startPointId: value.startPointId,
      endPointId: value.endPointId,
    };
  if (value.type === "circle")
    return {
      ...base,
      centerPointId: value.centerPointId,
      radius: sanitizeExpressionRef(value.radius),
    };
  if (value.type === "arc")
    return {
      ...base,
      centerPointId: value.centerPointId,
      startPointId: value.startPointId,
      endPointId: value.endPointId,
      clockwise: value.clockwise,
    };
  return base;
}

function sanitizeFeature(feature: Feature): Feature | undefined {
  if (!isRecord(feature)) throw new Error("Project file contains malformed feature.");
  const base = {
    id: feature.id,
    name: feature.name,
    ...(feature.componentId !== undefined ? { componentId: feature.componentId } : {}),
    suppressed: feature.suppressed,
    timelineStep: feature.timelineStep,
    createdAt: feature.createdAt,
  };
  if (feature.type === "extrude") {
    return {
      ...base,
      type: "extrude",
      sketchId: feature.sketchId,
      profileId: feature.profileId,
      operation: feature.operation,
      distance: sanitizeExpressionRef(feature.distance),
      ...(isRecord(feature.termination) ? { termination: sanitizeExtrudeTermination(feature.termination, feature.distance) } : {}),
      ...(Array.isArray(feature.targetBodyIds) ? { targetBodyIds: [...feature.targetBodyIds] } : {}),
      direction: feature.direction,
    };
  }
  if (feature.type === "pattern") {
    const pattern = feature.pattern;
    if (!isRecord(pattern) || (pattern.type !== "linear" && pattern.type !== "circular"))
      throw new Error("Malformed feature pattern settings.");
    if (!Array.isArray(feature.targetBodyIds) || feature.targetBodyIds.some(id => typeof id !== "string"))
      throw new Error("Malformed feature pattern target scope.");
    return {
      ...base, type: "pattern", sourceFeatureId: feature.sourceFeatureId,
      targetBodyIds: [...feature.targetBodyIds],
      pattern: pattern.type === "linear"
        ? { type: "linear", count: sanitizeExpressionRef(pattern.count), spacing: sanitizeExpressionRef(pattern.spacing), direction: pattern.direction }
        : { type: "circular", count: sanitizeExpressionRef(pattern.count), angle: sanitizeExpressionRef(pattern.angle), centerX: sanitizeExpressionRef(pattern.centerX), centerY: sanitizeExpressionRef(pattern.centerY) },
    };
  }
  if (feature.type === "hole") {
    assertHoleTargetScope(feature);
    return {
      ...base,
      type: "hole",
      ...(feature.direction !== undefined ? { direction: feature.direction } : {}),
      ...(feature.targetFeatureId !== undefined ? { targetFeatureId: feature.targetFeatureId } : {}),
      ...(feature.targetBodyId !== undefined ? { targetBodyId: feature.targetBodyId } : {}),
      ...(feature.targetBodyIds !== undefined ? { targetBodyIds: Array.isArray(feature.targetBodyIds) ? [...feature.targetBodyIds] : feature.targetBodyIds } : {}),
      sketchId: feature.sketchId,
      centerPointIds: Array.isArray(feature.centerPointIds) ? [...feature.centerPointIds] : [],
      diameter: sanitizeExpressionRef(feature.diameter),
      depth: feature.depth === "throughAll" ? "throughAll" : sanitizeExpressionRef(feature.depth),
    };
  }
  if (feature.type === "revolve") {
    return {
      ...base,
      type: "revolve",
      sketchId: feature.sketchId,
      profileId: feature.profileId,
      axis: sanitizeRevolveAxis(feature.axis),
      operation: feature.operation,
      angle: sanitizeExpressionRef(feature.angle),
      ...(Array.isArray(feature.targetBodyIds) ? { targetBodyIds: [...feature.targetBodyIds] } : {}),
    };
  }
  if (feature.type === "fillet") {
    return {
      ...base,
      type: "fillet",
      targetEdgeRefs: Array.isArray(feature.targetEdgeRefs) ? feature.targetEdgeRefs.map(sanitizeTopologyRef) : [],
      radius: sanitizeExpressionRef(feature.radius),
    };
  }
  if (feature.type === "chamfer") {
    return {
      ...base,
      type: "chamfer",
      targetEdgeRefs: Array.isArray(feature.targetEdgeRefs) ? feature.targetEdgeRefs.map(sanitizeTopologyRef) : [],
      distance: sanitizeExpressionRef(feature.distance),
    };
  }
  throw new Error(
    `Project file contains unsupported feature type ${String((feature as { type?: unknown }).type)}.`,
  );
}

// Preserve lost IDs, but reject malformed supplied scopes rather than dropping
// them and silently falling back to a legacy target or an empty selection.
function assertHoleTargetScope(feature: Extract<Feature, { type: "hole" }>) {
  if (feature.targetBodyIds !== undefined &&
      (!Array.isArray(feature.targetBodyIds) || feature.targetBodyIds.some(id => typeof id !== "string")))
    throw new Error("Malformed hole references.");
}

function sanitizeRevolveAxis(value: unknown): Extract<Feature, { type: "revolve" }>["axis"] {
  if (!isRecord(value)) throw new Error("Project file contains a malformed revolve axis.");
  if (value.type === "origin" && ["X", "Y", "Z"].includes(value.axis)) return { type: "origin", axis: value.axis };
  if (value.type === "sketchLine" && typeof value.sketchId === "string" && typeof value.lineId === "string") return { type: "sketchLine", sketchId: value.sketchId, lineId: value.lineId };
  throw new Error("Project file contains a malformed revolve axis.");
}

function sanitizeTopologyRef(value: unknown): any {
  if(!isRecord(value))return value;
  return Object.fromEntries(["featureId","kind","transientId","stableHint","role","sourceEntityId","adjacentRole","repairRequired"].filter((key)=>value[key]!==undefined).map((key)=>[key,value[key]]));
}

function sanitizeExtrudeTermination(termination: Record<string, any>, fallbackDistance: unknown): NonNullable<Extract<Feature, { type: "extrude" }>["termination"]> {
  if (termination.type === "throughAll") return { type: "throughAll" };
  if (termination.type === "toFace") {
    const faceRef = isRecord(termination.faceRef) ? termination.faceRef : {};
    if (
      typeof faceRef.featureId !== "string" ||
      !["face", "edge", "vertex"].includes(String(faceRef.kind)) ||
      typeof faceRef.transientId !== "string"
    ) {
      throw new Error("Project file contains a malformed to-face reference.");
    }
    return {
      type: "toFace",
      faceRef: {
        featureId: faceRef.featureId,
        kind: faceRef.kind as "face" | "edge" | "vertex",
        transientId: faceRef.transientId,
        ...(faceRef.stableHint !== undefined ? { stableHint: faceRef.stableHint } : {}),
        ...(faceRef.role !== undefined ? { role: faceRef.role } : {}),
        ...(faceRef.sourceEntityId !== undefined ? { sourceEntityId: faceRef.sourceEntityId } : {}),
        ...(faceRef.adjacentRole !== undefined ? { adjacentRole: faceRef.adjacentRole } : {}),
        ...(faceRef.repairRequired !== undefined ? { repairRequired: faceRef.repairRequired } : {}),
      },
    };
  }
  if (termination.type !== "distance") throw new Error("Project file contains an unsupported extrude termination.");
  return { type: "distance", distance: sanitizeExpressionRef(termination.distance ?? fallbackDistance) };
}

function withTimelineMetadata(document: CadDocument): CadDocument {
  const sketchEntries = Object.entries(document.sketches ?? {}).filter(([, sketch]) => isRecord(sketch));
  const features = Array.isArray(document.features) ? document.features.filter(isRecord) : [];
  const sketches = sketchEntries.map(([, sketch]) => sketch);
  const ordered = [
    ...sketches.map((sketch, index) => ({
      kind: "sketch" as const,
      id: sketch.id,
      timelineStep: sketch.timelineStep,
      order: comparableOrder(sketch.createdAt),
      fallbackIndex: index,
    })),
    ...features.map((feature, index) => ({
      kind: "feature" as const,
      id: feature.id,
      timelineStep: feature.timelineStep,
      order: comparableOrder(feature.createdAt),
      fallbackIndex: sketches.length + index,
    })),
  ].sort((a, b) => {
    if (a.timelineStep !== undefined && b.timelineStep !== undefined) {
      const byStep = a.timelineStep - b.timelineStep;
      if (byStep !== 0) return byStep;
    }
    if (a.timelineStep !== undefined && b.timelineStep === undefined) return -1;
    if (a.timelineStep === undefined && b.timelineStep !== undefined) return 1;
    if (a.order !== undefined && b.order !== undefined) {
      const byTime = typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order));
      if (byTime !== 0) return byTime;
    }
    if (a.order !== undefined && b.order === undefined) return -1;
    if (a.order === undefined && b.order !== undefined) return 1;
    return a.fallbackIndex - b.fallbackIndex;
  });

  const stepByKey = new Map<string, number>();
  ordered.forEach((item, index) =>
    stepByKey.set(`${item.kind}:${item.id}`, index + 1),
  );
  return {
    ...document,
    timelineCursor: ordered.length,
    sketches: Object.fromEntries(
      sketchEntries.map(([id, sketch]) => [
        id,
        { ...sketch, timelineStep: stepByKey.get(`sketch:${id}`) },
      ]),
    ),
    features: features.map((feature) => ({
      ...feature,
      timelineStep: stepByKey.get(`feature:${feature.id}`),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeExpressionRef(value: unknown): any {
  return isRecord(value)
    ? { expression: value.expression, resolvedValue: value.resolvedValue, unit: value.unit, ...(value.authoredUnit !== undefined ? { authoredUnit: value.authoredUnit } : {}), ...(value.parameterRefs !== undefined ? { parameterRefs: value.parameterRefs } : {}) }
    : { expression: value == null ? undefined : String(value), unit: undefined };
}

function comparableOrder(value: unknown): string | number | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function normalizePlaneReference(value: unknown): Sketch["plane"] {
  if (value === "XZ" || value === "YZ" || value === "XY") return { type: "origin", plane: value };
  if (isRecord(value) && value.type === "origin" && (value.plane === "XY" || value.plane === "XZ" || value.plane === "YZ")) {
    return { type: "origin", plane: value.plane };
  }
  if (
    isRecord(value) &&
    value.type === "offset" &&
    (value.base === "XY" ||
      value.base === "XZ" ||
      value.base === "YZ" ||
      (isRecord(value.base) && value.base.type === "face"))
  ) {
    // Preserve schema-owned expression metadata for final validateParameterBindings;
    // malformed units/bindings must be rejected rather than silently discarded.
    const offset = isRecord(value.offset)
      ? {
          expression: String(value.offset.expression ?? ""),
          ...(value.offset.authoredUnit !== undefined ? { authoredUnit: value.offset.authoredUnit } : {}),
          ...(value.offset.parameterRefs !== undefined ? { parameterRefs: value.offset.parameterRefs } : {}),
          ...(typeof value.offset.resolvedValue === "number" ? { resolvedValue: value.offset.resolvedValue } : {}),
          unit: String(value.offset.unit ?? ""),
        }
      : { expression: value.offset == null ? "" : String(value.offset), unit: "" };
    return {
      type: "offset",
      base:
        typeof value.base === "string"
          ? (value.base as "XY" | "XZ" | "YZ")
          : (normalizePlaneReference(value.base) as Extract<
              Sketch["plane"],
              { type: "face" }
            >),
      offset,
    };
  }
  if (isRecord(value) && value.type === "face") {
    return {
      type: "face",
      featureId: String(value.featureId ?? ""),
      stableFaceId: String(value.stableFaceId ?? ""),
      ...(value.lost !== undefined ? { lost: value.lost } : {}),
    };
  }
  return value === undefined
    ? { type: "origin", plane: "XY" }
    : ({ type: "origin", plane: "invalid" } as unknown as Sketch["plane"]);
}
