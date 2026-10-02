import { CadDocument, ValidationIssue } from "./schema";

const PARAMETER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const REQUIRED_DOCUMENT_OBJECTS = ["parameters", "sketches"] as const;

export function validateDocument(document: CadDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof document.id !== "string" || document.id.trim() === "")
    issues.push({ source: "document", message: "Document is missing an id." });
  if (typeof document.name !== "string" || document.name.trim() === "")
    issues.push({ source: "document", message: "Document is missing a name." });
  if (!document.schemaVersion)
    issues.push({
      source: "document",
      message: "Document is missing a schema version.",
    });
  if (!document.units)
    issues.push({ source: "document", message: "Document is missing units." });
  if (
    !document.unitSettings ||
    typeof document.unitSettings !== "object" ||
    Array.isArray(document.unitSettings)
  )
    issues.push({
      source: "document",
      message: "Document is missing unit settings.",
    });
  for (const field of REQUIRED_DOCUMENT_OBJECTS) {
    if (
      !document[field] ||
      typeof document[field] !== "object" ||
      Array.isArray(document[field])
    ) {
      issues.push({
        source: "document",
        message: `Document is missing ${field}.`,
      });
    }
  }
  if (!Array.isArray(document.features))
    issues.push({
      source: "document",
      message: "Document is missing features.",
    });
  if (issues.length > 0) return issues;

  const ids = new Set<string>();
  const addId = (id: string, source: ValidationIssue["source"]) => {
    if (typeof id !== "string" || id.trim() === "") {
      issues.push({ source, message: `${source} is missing an id.` });
      return;
    }
    if (ids.has(id))
      issues.push({ source, sourceId: id, message: `Duplicate id ${id}.` });
    ids.add(id);
  };
  addId(document.id, "document");

  for (const [name, parameter] of Object.entries(document.parameters)) {
    addId(parameter.id, "parameter");
    if (name !== parameter.name) {
      issues.push({
        source: "parameter",
        sourceId: parameter.id,
        message: `Parameter key ${name} does not match its name.`,
      });
    }
    if (!PARAMETER_NAME_PATTERN.test(parameter.name)) {
      issues.push({
        source: "parameter",
        sourceId: parameter.id,
        message: `Invalid parameter name ${parameter.name}.`,
      });
    }
  }

  for (const [sketchKey, sketch] of Object.entries(document.sketches)) {
    if (sketchKey !== sketch.id)
      issues.push({
        source: "sketch",
        sourceId: sketch.id,
        message: "Sketch key does not match its id.",
      });
    addId(sketch.id, "sketch");
    const planeValid = (plane: unknown): boolean => {
      if (!plane || typeof plane !== "object") return false;
      const p = plane as Record<string, unknown>;
      if (p.type === "origin")
        return ["XY", "XZ", "YZ"].includes(String(p.plane));
      if (p.type === "face")
        return (
          typeof p.featureId === "string" &&
          typeof p.stableFaceId === "string" &&
          (p.lost === undefined || typeof p.lost === "boolean")
        );
      if (p.type === "offset") {
        const offset = p.offset as Record<string, unknown> | undefined;
        return (
          (typeof p.base === "string"
            ? ["XY", "XZ", "YZ"].includes(p.base)
            : !!p.base &&
              typeof p.base === "object" &&
              (p.base as Record<string, unknown>).type === "face" &&
              planeValid(p.base)) &&
          !!offset &&
          typeof offset.expression === "string" &&
          typeof offset.unit === "string"
        );
      }
      return false;
    };
    if (!planeValid(sketch.plane))
      issues.push({
        source: "sketch",
        sourceId: sketch.id,
        message: "Invalid sketch plane reference.",
      });
    if (
      sketch.solveRevision !== undefined &&
      (!Number.isSafeInteger(sketch.solveRevision) || sketch.solveRevision < 0)
    )
      issues.push({
        source: "sketch",
        sourceId: sketch.id,
        message: "Invalid sketch solve revision.",
      });
    if (
      sketch.solveMode !== undefined &&
      sketch.solveMode !== "driving" &&
      sketch.solveMode !== "validate"
    )
      issues.push({
        source: "sketch",
        sourceId: sketch.id,
        message: "Invalid sketch solve mode.",
      });
    for (const [entityKey, entity] of Object.entries(sketch.entities)) {
      if (
        !entity ||
        !["point", "line", "circle", "arc"].includes(entity.type)
      ) {
        issues.push({
          source: "sketch",
          sourceId: sketch.id,
          message: "Unsupported sketch entity type.",
        });
        continue;
      }
      if (
        entity.construction !== undefined &&
        typeof entity.construction !== "boolean"
      )
        issues.push({
          source: "sketch",
          sourceId: entity.id,
          message: "Construction flag must be boolean.",
        });
      if (entity.type === "point") {
        for (const value of [entity.x, entity.y])
          if (
            !value ||
            typeof value.expression !== "string" ||
            typeof value.unit !== "string"
          )
            issues.push({
              source: "sketch",
              sourceId: entity.id,
              message: "Point coordinates require expressions and units.",
            });
      }
      if (
        entity.type === "circle" &&
        (!entity.radius ||
          typeof entity.radius.expression !== "string" ||
          typeof entity.radius.unit !== "string")
      )
        issues.push({
          source: "sketch",
          sourceId: entity.id,
          message: "Circle radius requires an expression and unit.",
        });
      if (entity.type === "arc") {
        if (sketch.solveMode === "validate")
          issues.push({
            source: "sketch",
            sourceId: sketch.id,
            message: "Arcs require driving sketch solving.",
          });
        if (typeof entity.clockwise !== "boolean")
          issues.push({
            source: "sketch",
            sourceId: entity.id,
            message: "Arc direction must be boolean.",
          });
        for (const id of [
          entity.centerPointId,
          entity.startPointId,
          entity.endPointId,
        ])
          if (typeof id !== "string" || sketch.entities[id]?.type !== "point")
            issues.push({
              source: "sketch",
              sourceId: entity.id,
              message: "Arc references a missing point.",
            });
      }
      if (entityKey !== entity.id)
        issues.push({
          source: "sketch",
          sourceId: sketch.id,
          message: "Entity key does not match its id.",
        });
      addId(entity.id, "sketch");
      if (entity.type === "line") {
        if (
          typeof entity.startPointId !== "string" ||
          sketch.entities[entity.startPointId]?.type !== "point"
        ) {
          issues.push({
            source: "sketch",
            sourceId: entity.id,
            message: "Line references a missing start point.",
          });
        }
        if (
          typeof entity.endPointId !== "string" ||
          sketch.entities[entity.endPointId]?.type !== "point"
        ) {
          issues.push({
            source: "sketch",
            sourceId: entity.id,
            message: "Line references a missing end point.",
          });
        }
      }
      if (
        entity.type === "circle" &&
        (typeof entity.centerPointId !== "string" ||
          sketch.entities[entity.centerPointId]?.type !== "point")
      ) {
        issues.push({
          source: "sketch",
          sourceId: entity.id,
          message: "Circle references a missing center point.",
        });
      }
    }
  }

  for (const sketch of Object.values(document.sketches)) {
    if (
      !Array.isArray(sketch.constraints) ||
      !Array.isArray(sketch.dimensions)
    ) {
      issues.push({
        source: "sketch",
        sourceId: sketch.id,
        message: "Sketch constraints and dimensions must be arrays.",
      });
      continue;
    }
    for (const [constraints, types] of [
      [
        sketch.constraints,
        [
          "fixed",
          "coincident",
          "horizontal",
          "vertical",
          "parallel",
          "perpendicular",
          "tangent",
          "equalLength",
          "equalRadius",
          "midpoint",
          "symmetric",
        ],
      ],
      [
        sketch.dimensions,
        [
          "length",
          "radius",
          "diameter",
          "horizontalDistance",
          "verticalDistance",
          "distance",
          "angle",
        ],
      ],
    ] as const) {
      for (const constraint of constraints) {
        if (!constraint || typeof constraint !== "object") {
          issues.push({
            source: "sketch",
            sourceId: sketch.id,
            message: "Malformed sketch constraint or dimension.",
          });
          continue;
        }
        addId(constraint.id, "sketch");
        if (
          !Array.isArray(constraint.entityIds) ||
          constraint.entityIds.some((id) => typeof id !== "string") ||
          (constraint.pointIds !== undefined &&
            (!Array.isArray(constraint.pointIds) ||
              constraint.pointIds.some((id) => typeof id !== "string")))
        )
          issues.push({
            source: "sketch",
            sourceId: sketch.id,
            message: "Constraint references must be arrays of IDs.",
          });
        if (Array.isArray(constraint.entityIds))
          for (const id of constraint.entityIds)
            if (!sketch.entities[id])
              issues.push({
                source: "sketch",
                sourceId: sketch.id,
                message: `Constraint references unresolved entity "${id}".`,
              });
        if (Array.isArray(constraint.pointIds))
          for (const id of constraint.pointIds)
            if (sketch.entities[id]?.type !== "point")
              issues.push({
                source: "sketch",
                sourceId: sketch.id,
                message: `Constraint references unresolved point "${id}".`,
              });
        if (!(types as readonly string[]).includes(constraint.type))
          issues.push({
            source: "sketch",
            sourceId: sketch.id,
            message: "Unsupported constraint or dimension type.",
          });
        if (
          constraints === sketch.dimensions &&
          (!("expression" in constraint) ||
            !constraint.expression ||
            typeof constraint.expression.expression !== "string" ||
            typeof constraint.expression.unit !== "string")
        )
          issues.push({
            source: "sketch",
            sourceId: sketch.id,
            message: "Dimension requires an expression and unit.",
          });
      }
    }
  }
  for (const feature of document.features) {
    addId(feature.id, "feature");
    if (
      (feature.type === "extrude" || feature.type === "revolve") &&
      !["newBody", "join", "cut"].includes(feature.operation)
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: `Unsupported modeling operation "${String(feature.operation)}". Choose new body, join, or cut.`,
      });
      continue;
    }
    if (
      feature.type === "extrude" &&
      !["positive", "negative", "symmetric"].includes(feature.direction)
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message:
          "Extrude direction must be explicitly positive, negative, or symmetric.",
      });
      continue;
    }
    if (feature.type === "extrude" && !document.sketches[feature.sketchId]) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Extrude references a missing sketch.",
      });
    }
    if (
      feature.type === "extrude" &&
      feature.operation !== "newBody" &&
      (!Array.isArray(feature.targetBodyIds) ||
        feature.targetBodyIds.length === 0)
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: `${feature.operation} extrude requires at least one target body.`,
      });
    }
    if (
      feature.type === "extrude" &&
      feature.operation !== "newBody" &&
      Array.isArray(feature.targetBodyIds) &&
      feature.targetBodyIds.length > 1
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: `${feature.operation} extrude currently supports exactly one target body.`,
      });
    }
    if (feature.type === "revolve" && !document.sketches[feature.sketchId]) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Revolve references a missing sketch.",
      });
    }
    if (
      feature.type === "revolve" &&
      feature.operation !== "newBody" &&
      (!Array.isArray(feature.targetBodyIds) ||
        feature.targetBodyIds.length !== 1)
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: `${feature.operation} revolve currently supports exactly one target body.`,
      });
    }
    if (feature.type === "hole" && !document.sketches[feature.sketchId]) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Hole references a missing sketch.",
      });
    }
    if (
      feature.type === "hole" &&
      !feature.targetBodyId &&
      !feature.targetFeatureId
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Hole requires a target body.",
      });
    }
    if (
      (feature.type === "fillet" || feature.type === "chamfer") &&
      feature.targetEdgeRefs.some(
        (ref) => ref.kind !== "edge" || !ref.role || ref.repairRequired,
      )
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: `${feature.type} requires supported stable edge references.`,
      });
    }
  }

  return issues;
}
