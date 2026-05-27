import { CURRENT_SCHEMA_VERSION, CadDocument, Feature, Sketch } from "./schema";

type Migration = (input: CadDocument) => CadDocument;

const migrations = new Map<number, Migration>([[1, migrateV1ToV2]]);

export function migrateDocument(input: CadDocument): CadDocument {
  if (!Number.isInteger(input.schemaVersion)) {
    throw new Error("Project file is missing a schema version.");
  }
  if (input.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported project schema version ${input.schemaVersion}.`);
  }

  let document = input;
  if (document.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return sanitizeCurrentDocument(document);
  }
  while (document.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.get(document.schemaVersion);
    if (!migration) throw new Error(`Unsupported project schema version ${document.schemaVersion}.`);
    document = migration(document);
  }
  return sanitizeCurrentDocument(document);
}

function migrateV1ToV2(input: CadDocument): CadDocument {
  return withTimelineMetadata({ ...input, schemaVersion: 2 });
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
          value: record.value,
          unit: record.unit,
          ...(record.description !== undefined ? { description: record.description } : {}),
          ...(record.locked !== undefined ? { locked: record.locked } : {}),
        },
      ];
    }),
  );
  const sketches = Object.fromEntries(
    Object.entries(rawSketches).map(([key, sketch]) => [key, sanitizeSketch(sketch)]),
  );
  const features = Array.isArray(input.features) ? input.features.map(sanitizeFeature).filter((feature): feature is Feature => !!feature) : [];

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
    updatedAt: input.updatedAt,
    ...(input.timelineCursor !== undefined ? { timelineCursor: input.timelineCursor } : {}),
    parameters,
    sketches,
    features,
    ...(input.viewState
      ? {
          viewState: {
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
    plane: sketchRecord.plane,
    ...(sketchRecord.timelineStep !== undefined ? { timelineStep: sketchRecord.timelineStep } : {}),
    ...(sketchRecord.createdAt !== undefined ? { createdAt: sketchRecord.createdAt } : {}),
    entities: Object.fromEntries(
      Object.entries(isRecord(sketchRecord.entities) ? sketchRecord.entities : {}).map(([key, entity]) => [key, isRecord(entity) ? { ...entity } : entity]),
    ) as Sketch["entities"],
    constraints: Array.isArray(sketchRecord.constraints) ? sketchRecord.constraints.map((constraint: unknown) => (isRecord(constraint) ? { ...constraint } : constraint)) as Sketch["constraints"] : [],
    dimensions: Array.isArray(sketchRecord.dimensions)
      ? sketchRecord.dimensions.map((dimension: unknown) => {
          const dimensionRecord = isRecord(dimension) ? dimension : {};
          return { ...dimensionRecord, expression: isRecord(dimensionRecord.expression) ? { ...dimensionRecord.expression } : dimensionRecord.expression };
        }) as Sketch["dimensions"]
      : [],
  };
}

function sanitizeFeature(feature: Feature): Feature | undefined {
  if (!isRecord(feature)) throw new Error("Project file contains malformed feature.");
  const base = {
    id: feature.id,
    name: feature.name,
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
      direction: feature.direction,
    };
  }
  if (feature.type === "hole") {
    return {
      ...base,
      type: "hole",
      targetFeatureId: feature.targetFeatureId,
      sketchId: feature.sketchId,
      centerPointIds: Array.isArray(feature.centerPointIds) ? [...feature.centerPointIds] : [],
      diameter: sanitizeExpressionRef(feature.diameter),
      depth: feature.depth === "throughAll" ? "throughAll" : sanitizeExpressionRef(feature.depth),
    };
  }
  if (feature.type === "fillet") {
    return {
      ...base,
      type: "fillet",
      targetEdgeRefs: Array.isArray(feature.targetEdgeRefs) ? feature.targetEdgeRefs.map((ref) => ({ ...ref })) : [],
      radius: sanitizeExpressionRef(feature.radius),
    };
  }
  if (feature.type === "chamfer") {
    return {
      ...base,
      type: "chamfer",
      targetEdgeRefs: Array.isArray(feature.targetEdgeRefs) ? feature.targetEdgeRefs.map((ref) => ({ ...ref })) : [],
      distance: sanitizeExpressionRef(feature.distance),
    };
  }
  throw new Error(`Project file contains unsupported feature type ${String((feature as { type?: unknown }).type)}.`);
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
  ordered.forEach((item, index) => stepByKey.set(`${item.kind}:${item.id}`, index + 1));
  return {
    ...document,
    timelineCursor: ordered.length,
    sketches: Object.fromEntries(
      sketchEntries.map(([id, sketch]) => [id, { ...sketch, timelineStep: stepByKey.get(`sketch:${id}`) }]),
    ),
    features: features.map((feature) => ({ ...feature, timelineStep: stepByKey.get(`feature:${feature.id}`) })),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeExpressionRef(value: unknown): any {
  return isRecord(value)
    ? { expression: value.expression, resolvedValue: value.resolvedValue, unit: value.unit }
    : { expression: value == null ? undefined : String(value), unit: undefined };
}

function comparableOrder(value: unknown): string | number | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}
