import { CadDocument, ValidationIssue } from "./schema";

const PARAMETER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateDocument(document: CadDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!document.id) issues.push({ source: "document", message: "Document is missing an id." });
  if (!document.name) issues.push({ source: "document", message: "Document is missing a name." });
  if (!document.schemaVersion) issues.push({ source: "document", message: "Document is missing a schema version." });

  const ids = new Set<string>();
  const addId = (id: string, source: ValidationIssue["source"]) => {
    if (ids.has(id)) issues.push({ source, sourceId: id, message: `Duplicate id ${id}.` });
    ids.add(id);
  };
  addId(document.id, "document");

  for (const [name, parameter] of Object.entries(document.parameters)) {
    addId(parameter.id, "parameter");
    if (name !== parameter.name) {
      issues.push({ source: "parameter", sourceId: parameter.id, message: `Parameter key ${name} does not match its name.` });
    }
    if (!PARAMETER_NAME_PATTERN.test(parameter.name)) {
      issues.push({ source: "parameter", sourceId: parameter.id, message: `Invalid parameter name ${parameter.name}.` });
    }
  }

  for (const sketch of Object.values(document.sketches)) {
    addId(sketch.id, "sketch");
    for (const entity of Object.values(sketch.entities)) {
      addId(entity.id, "sketch");
      if (entity.type === "line") {
        if (!sketch.entities[entity.startPointId]) {
          issues.push({ source: "sketch", sourceId: entity.id, message: "Line references a missing start point." });
        }
        if (!sketch.entities[entity.endPointId]) {
          issues.push({ source: "sketch", sourceId: entity.id, message: "Line references a missing end point." });
        }
      }
      if (entity.type === "circle" && !sketch.entities[entity.centerPointId]) {
        issues.push({ source: "sketch", sourceId: entity.id, message: "Circle references a missing center point." });
      }
    }
  }

  for (const feature of document.features) {
    addId(feature.id, "feature");
    if (feature.type === "extrude" && !document.sketches[feature.sketchId]) {
      issues.push({ source: "feature", sourceId: feature.id, message: "Extrude references a missing sketch." });
    }
  }

  return issues;
}
