export const PROJECT_IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxDepth: 64,
  maxParameters: 500,
  maxSketches: 100,
  maxSketchEntities: 10000,
  maxSketchEntitiesPerSketch: 750,
  maxConstraintsAndDimensions: 20000,
  maxFeatures: 1000,
  maxJsonNodes: 500000,
} as const;

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor", "toString", "valueOf"]);

export function parseProjectJson(text: string): unknown {
  if (text.length * 2 > PROJECT_IMPORT_LIMITS.maxBytes) {
    throw new Error("Project file is too large.");
  }
  try {
    return JSON.parse(text, (key, value) => {
      if (DANGEROUS_KEYS.has(key)) throw new Error(`Project file contains unsafe key ${key}.`);
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Project file contains unsafe key")) throw error;
    throw new Error("Project file is not valid JSON.");
  }
}

export function assertProjectJsonShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project file does not contain a document object.");
  }
  assertJsonDepth(value, PROJECT_IMPORT_LIMITS.maxDepth);
  assertEntityLimits(value as Record<string, unknown>);
}

function assertJsonDepth(value: unknown, maxDepth: number) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  let visited = 0;
  while (stack.length > 0) {
    const item = stack.pop()!;
    visited += 1;
    if (visited > PROJECT_IMPORT_LIMITS.maxJsonNodes) throw new Error("Project file has too many JSON nodes.");
    if (item.depth > maxDepth) throw new Error("Project file is nested too deeply.");
    if (!item.value || typeof item.value !== "object") continue;
    if (Array.isArray(item.value)) {
      for (const child of item.value) stack.push({ value: child, depth: item.depth + 1 });
      continue;
    }
    const record = item.value as Record<string, unknown>;
    for (const key in record) stack.push({ value: record[key], depth: item.depth + 1 });
  }
}

function assertEntityLimits(document: Record<string, unknown>) {
  const parameters = plainRecord(document.parameters) ? document.parameters : {};
  const sketches = plainRecord(document.sketches) ? document.sketches : {};
  const features = Array.isArray(document.features) ? document.features : [];
  if (Object.keys(parameters).length > PROJECT_IMPORT_LIMITS.maxParameters) throw new Error("Project file has too many parameters.");
  if (Object.keys(sketches).length > PROJECT_IMPORT_LIMITS.maxSketches) throw new Error("Project file has too many sketches.");
  if (features.length > PROJECT_IMPORT_LIMITS.maxFeatures) throw new Error("Project file has too many features.");

  let sketchEntityCount = 0;
  let constraintAndDimensionCount = 0;
  for (const sketch of Object.values(sketches)) {
    if (!plainRecord(sketch)) continue;
    const entities = plainRecord(sketch.entities) ? sketch.entities : {};
    const entityCount = Object.keys(entities).length;
    if (entityCount > PROJECT_IMPORT_LIMITS.maxSketchEntitiesPerSketch) throw new Error("Project file has too many entities in a sketch.");
    sketchEntityCount += entityCount;
    constraintAndDimensionCount += Array.isArray(sketch.constraints) ? sketch.constraints.length : 0;
    constraintAndDimensionCount += Array.isArray(sketch.dimensions) ? sketch.dimensions.length : 0;
  }
  if (sketchEntityCount > PROJECT_IMPORT_LIMITS.maxSketchEntities) throw new Error("Project file has too many sketch entities.");
  if (constraintAndDimensionCount > PROJECT_IMPORT_LIMITS.maxConstraintsAndDimensions) {
    throw new Error("Project file has too many sketch constraints and dimensions.");
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
