import { CadDocument, ValidationIssue } from "./schema";

const PARAMETER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const REQUIRED_DOCUMENT_OBJECTS = ["parameters", "sketches"] as const;

export function validateDocument(document: CadDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof document.id !== "string" || document.id.trim() === "") issues.push({ source: "document", message: "Document is missing an id." });
  if (typeof document.name !== "string" || document.name.trim() === "") issues.push({ source: "document", message: "Document is missing a name." });
  if (!document.schemaVersion) issues.push({ source: "document", message: "Document is missing a schema version." });
  if (!document.units) issues.push({ source: "document", message: "Document is missing units." });
  if (!document.unitSettings || typeof document.unitSettings !== "object" || Array.isArray(document.unitSettings)) issues.push({ source: "document", message: "Document is missing unit settings." });
  for (const field of REQUIRED_DOCUMENT_OBJECTS) {
    if (!document[field] || typeof document[field] !== "object" || Array.isArray(document[field])) {
      issues.push({ source: "document", message: `Document is missing ${field}.` });
    }
  }
  if (!Array.isArray(document.features)) issues.push({ source: "document", message: "Document is missing features." });
  if (issues.length > 0) return issues;

  const ids = new Set<string>();
  const addId = (id: string, source: ValidationIssue["source"]) => {
    if (typeof id !== "string" || id.trim() === "") {
      issues.push({ source, message: `${source} is missing an id.` });
      return;
    }
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
