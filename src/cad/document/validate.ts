import { targetBodyIds } from "./bodyScopes";
import { MAX_NAMED_VIEWS, validCameraPose } from "../inspection/cameraViews";
import { CadDocument, ValidationIssue } from "./schema";
import { validateParameterBindings } from "../parameters/expressionBindings";
import { MODEL_RESOURCE_LIMITS } from "../resourceLimits";
import { validAuthoredUnit, validUnitSettings } from "../parameters/parameterUnits";

const PARAMETER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const REQUIRED_DOCUMENT_OBJECTS = ["parameters", "sketches"] as const;

export function validateDocument(document: CadDocument, mode: "modeling" | "storage" = "modeling"): ValidationIssue[] {
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
  issues.push(...validatePersistedFields(document));
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
    if (!PARAMETER_NAME_PATTERN.test(parameter.name) || parameter.name === "prototype" || Object.hasOwn(Object.prototype, parameter.name)) {
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
    // Well-typed broken references must survive open/recovery so the inspector can repair them.
    // Modeling still rejects them below; malformed fields and duplicate IDs always fail.
    if (mode === "storage") continue;
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
    if ((feature.type === "extrude" || feature.type === "revolve") && feature.operation !== "newBody" &&
      Array.isArray(feature.targetBodyIds) && new Set(feature.targetBodyIds).size !== feature.targetBodyIds.length) {
      issues.push({ source: "feature", sourceId: feature.id, message: "Target scope contains duplicate body IDs. Reselect unique target bodies." });
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
        feature.targetBodyIds.length === 0)
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: `${feature.operation} revolve requires at least one target body.`,
      });
    }
    if (feature.type === "hole" && Array.isArray(feature.centerPointIds) && new Set(feature.centerPointIds).size !== feature.centerPointIds.length)
      issues.push({ source: "feature", sourceId: feature.id, message: "Hole scope contains duplicate center point IDs. Reselect unique centers." });
    if (feature.type === "hole" && Array.isArray(feature.targetBodyIds) && new Set(feature.targetBodyIds).size !== feature.targetBodyIds.length)
      issues.push({ source: "feature", sourceId: feature.id, message: "Target scope contains duplicate body IDs. Reselect unique target bodies." });
    if (feature.type === "hole" && !document.sketches[feature.sketchId]) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Hole references a missing sketch.",
      });
    }
    if (
      feature.type === "hole" &&
      Array.isArray(targetBodyIds(feature)) && !targetBodyIds(feature).length
    ) {
      issues.push({
        source: "feature",
        sourceId: feature.id,
        message: "Hole requires at least one target body.",
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

  if (!issues.length) issues.push(...validateParameterBindings(document));
  return issues;
}

// Imports must reject malformed known fields before components or geometry read them.
function validatePersistedFields(document: CadDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const check = (
    valid: boolean,
    source: ValidationIssue["source"],
    message: string,
    sourceId?: string,
  ) => {
    if (!valid) issues.push({ source, sourceId, message });
  };
  const expression = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const ref = value as Record<string, unknown>;
    return (
      typeof ref.expression === "string" &&
      typeof ref.unit === "string" &&
      (ref.authoredUnit === undefined || validAuthoredUnit(ref.authoredUnit)) &&
      (ref.resolvedValue === undefined ||
        (typeof ref.resolvedValue === "number" &&
          Number.isFinite(ref.resolvedValue)))
    );
  };
  const strings = (value: unknown): boolean =>
    Array.isArray(value) && value.every((id) => typeof id === "string");
  const topology = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const ref = value as Record<string, unknown>;
    return (
      typeof ref.featureId === "string" &&
      typeof ref.transientId === "string" &&
      ["face", "edge", "vertex"].includes(String(ref.kind)) &&
      ["stableHint", "sourceEntityId"].every(
        (key) => ref[key] === undefined || typeof ref[key] === "string",
      ) &&
      (ref.role === undefined ||
        [
          "profileEdge",
          "startCapPerimeter",
          "endCapPerimeter",
          "planarFace",
        ].includes(String(ref.role))) &&
      (ref.adjacentRole === undefined ||
        ["sideFace", "startCap", "endCap"].includes(
          String(ref.adjacentRole),
        )) &&
      (ref.repairRequired === undefined ||
        typeof ref.repairRequired === "boolean")
    );
  };
  check(
    ["metric", "imperial"].includes(document.units),
    "document",
    "Invalid document units.",
  );
  check(
    ["mm", "cm", "m", "in", "ft"].includes(document.unitSettings.length) &&
      ["deg", "rad"].includes(document.unitSettings.angle) &&
      (document.unitSettings.mass === undefined ||
        ["g", "kg", "lb"].includes(document.unitSettings.mass)),
    "document",
    "Invalid document unit settings.",
  );
  check(document.displayUnits === undefined || validUnitSettings(document.displayUnits), "document", "Invalid display units.");
  check(
    typeof document.createdAt === "string" &&
      typeof document.updatedAt === "string",
    "document",
    "Document timestamps must be strings.",
  );
  check(
    document.timelineCursor === undefined ||
      (Number.isSafeInteger(document.timelineCursor) &&
        document.timelineCursor >= 0),
    "document",
    "Invalid timeline cursor.",
  );
  for (const value of [
    document.viewState?.cameraPosition,
    document.viewState?.cameraTarget,
  ])
    check(
      value === undefined ||
        (Array.isArray(value) &&
          value.length === 3 &&
          value.every((v) => typeof v === "number" && Number.isFinite(v))),
      "document",
      "Camera coordinates must be three finite numbers.",
    );
  const namedViews = document.viewState?.namedViews;
  if (namedViews !== undefined) {
    check(Array.isArray(namedViews) && namedViews.length <= MAX_NAMED_VIEWS, "document", "Named views must be an array with at most 20 entries.");
    if (Array.isArray(namedViews)) {
      const ids = new Set<string>();
      const names = new Set<string>();
      for (const view of namedViews) {
        check(Boolean(view) && typeof view.id === "string" && view.id.trim().length > 0 && !ids.has(view.id) &&
          typeof view.name === "string" && view.name.trim().length > 0 && view.name.length <= 80 && !names.has(view.name.trim().toLowerCase()) && validCameraPose(view), "document", "Named view requires a unique id and name, and a valid camera pose.");
        if (view && typeof view.id === "string") ids.add(view.id);
        if (view && typeof view.name === "string") names.add(view.name.trim().toLowerCase());
      }
    }
  }
  for (const parameter of Object.values(document.parameters)) {
    check(
      typeof parameter.name === "string" &&
        typeof parameter.expression === "string" &&
        (parameter.authoredUnit === undefined || validAuthoredUnit(parameter.authoredUnit)) &&
        (parameter.group === undefined || (typeof parameter.group === "string" && parameter.group.length <= 80)) &&
        typeof parameter.unit === "string" &&
        typeof parameter.value === "number" &&
        Number.isFinite(parameter.value) &&
        (parameter.description === undefined ||
          typeof parameter.description === "string") &&
        (parameter.locked === undefined ||
          typeof parameter.locked === "boolean"),
      "parameter",
      "Malformed parameter fields.",
      parameter.id,
    );
  }
  for (const item of [
    ...Object.values(document.sketches),
    ...document.features,
  ]) {
    const source = "entities" in item ? "sketch" : "feature";
    check(
      typeof item.name === "string",
      source,
      `${source} name must be a string.`,
      item.id,
    );
    check(
      item.timelineStep === undefined ||
        (Number.isSafeInteger(item.timelineStep) && item.timelineStep >= 0),
      source,
      "Invalid timeline step.",
      item.id,
    );
    check(
      item.createdAt === undefined || typeof item.createdAt === "string",
      source,
      "Timestamp must be a string.",
      item.id,
    );
  }
  for (const feature of document.features) {
    const checkFeature = (valid: boolean, message: string) =>
      check(valid, "feature", message, feature.id);
    checkFeature(
      feature.suppressed === undefined ||
        typeof feature.suppressed === "boolean",
      "Suppressed flag must be boolean.",
    );
    if ("sketchId" in feature)
      checkFeature(
        typeof feature.sketchId === "string",
        "Sketch reference must be an ID.",
      );
    if (feature.type === "extrude" || feature.type === "revolve") {
      checkFeature(
        typeof feature.profileId === "string" &&
          (feature.targetBodyIds === undefined ||
            (strings(feature.targetBodyIds) && feature.targetBodyIds.length <= MODEL_RESOURCE_LIMITS.maxBodies)),
        "Malformed profile or target body references.",
      );
    }
    if (feature.type === "extrude") {
      checkFeature(
        expression(feature.distance),
        "Extrude distance requires an expression and unit.",
      );
      if (
        feature.termination?.type === "distance" &&
        feature.termination.distance !== undefined
      )
        checkFeature(
          expression(feature.termination.distance),
          "Termination distance requires an expression and unit.",
        );
      if (feature.termination?.type === "toFace")
        checkFeature(
          topology(feature.termination.faceRef) &&
            feature.termination.faceRef.kind === "face",
          "Malformed to-face reference.",
        );
    }
    if (feature.type === "revolve") {
      const axis = feature.axis;
      checkFeature(
        !!axis &&
          (axis.type === "origin"
            ? ["X", "Y", "Z"].includes(axis.axis)
            : axis.type === "sketchLine" &&
              typeof axis.sketchId === "string" &&
              typeof axis.lineId === "string"),
        "Malformed revolve axis.",
      );
      checkFeature(
        expression(feature.angle),
        "Revolve angle requires an expression and unit.",
      );
    }
    if (feature.type === "hole") {
      checkFeature(Array.isArray(feature.centerPointIds) && feature.centerPointIds.length <= MODEL_RESOURCE_LIMITS.maxHoleCenters, `Hole exceeds the ${MODEL_RESOURCE_LIMITS.maxHoleCenters}-center resource limit.`);
      checkFeature(
        strings(feature.centerPointIds) &&
          (feature.targetBodyIds === undefined || (strings(feature.targetBodyIds) && feature.targetBodyIds.length <= MODEL_RESOURCE_LIMITS.maxBodies)) &&
          (feature.targetBodyId === undefined ||
            typeof feature.targetBodyId === "string") &&
          (feature.targetFeatureId === undefined ||
            typeof feature.targetFeatureId === "string"),
        "Malformed hole references.",
      );
      checkFeature(
        expression(feature.diameter) &&
          (feature.depth === "throughAll" || expression(feature.depth)),
        "Hole dimensions require expressions and units.",
      );
    }
    if (feature.type === "fillet" || feature.type === "chamfer") {
      checkFeature(
        Array.isArray(feature.targetEdgeRefs) &&
          feature.targetEdgeRefs.every(topology),
        "Malformed edge references.",
      );
      checkFeature(
        expression(
          feature.type === "fillet" ? feature.radius : feature.distance,
        ),
        "Edge treatment requires an expression and unit.",
      );
    }
  }
  return issues;
}
