import type { ConstraintType, SketchDimension } from "../cad/document/schema";
/** A bounded recipe, never executable code or a provider-authored CadDocument. */
export const AI_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export interface AiParameter {
  name: string;
  value: number;
  unit: "mm" | "deg";
}
export interface AiPoint {
  x: string;
  y: string;
}
export type AiWireEdge =
  { type: "line" } | { type: "arc"; center: AiPoint; clockwise: boolean };
export type AiLoopProfile =
  | { type: "rectangle"; x: string; y: string; width: string; height: string }
  | { type: "circle"; x: string; y: string; radius: string }
  | { type: "polygon"; vertices: AiPoint[] }
  | { type: "wire"; vertices: AiPoint[]; edges: AiWireEdge[] };
export type AiProfile =
  | AiLoopProfile
  | { type: "points"; points: AiPoint[] }
  | { type: "compound"; outer: AiLoopProfile; holes: AiLoopProfile[] };
export interface AiSketchIntent {
  constraints: Array<{
    type: ConstraintType;
    entities: number[];
    points: number[];
  }>;
  dimensions: Array<{
    type: SketchDimension["type"];
    entities: number[];
    points: number[];
    value: string;
  }>;
}
const constraintTypes = [
  "fixed",
  "horizontal",
  "vertical",
  "coincident",
  "parallel",
  "perpendicular",
  "tangent",
  "equalLength",
  "equalRadius",
  "midpoint",
  "symmetric",
] as const;
const dimensionTypes = [
  "length",
  "radius",
  "diameter",
  "horizontalDistance",
  "verticalDistance",
  "distance",
  "angle",
] as const;
export type AiStep =
  | {
      type: "sketch";
      id: string;
      name: string;
      plane: "XY" | "XZ" | "YZ";
      offset: string;
      profile: AiProfile;
      intent?: AiSketchIntent;
    }
  | {
      type: "extrude";
      id: string;
      name: string;
      sketch: string;
      operation: "newBody" | "cut" | "join";
      distance: string;
      termination: "distance" | "throughAll";
      direction: "positive" | "negative" | "symmetric";
      targets: string[];
    }
  | {
      type: "revolve";
      id: string;
      name: string;
      sketch: string;
      operation: "newBody" | "cut" | "join";
      axis: "X" | "Y" | "Z";
      angle: string;
      targets: string[];
    }
  | {
      type: "hole";
      id: string;
      name: string;
      sketch: string;
      targets: string[];
      centers: number[];
      diameter: string;
      depth: string;
      termination: "distance" | "throughAll";
    }
  | {
      type: "fillet" | "chamfer";
      id: string;
      name: string;
      owner: string;
      role: "startCapPerimeter" | "endCapPerimeter";
      size: string;
    };
export interface AiPlan {
  name: string;
  summary: string;
  warnings: string[];
  parameters: AiParameter[];
  steps: AiStep[];
}
export interface AiProviderStatus {
  id: AiProvider;
  label: string;
  available: boolean;
  model: string;
}
export interface AiEditContext {
  componentName: string;
  feature?: { type: "extrude" | "revolve" | "hole"; name: string };
  parameters: Array<AiParameter & { id: string; expression: string }>;
}

export function validateAiEditContext(value: unknown): AiEditContext {
  const context = record(
    value,
    [
      "componentName",
      "parameters",
      ...(typeof value === "object" && value && "feature" in value
        ? ["feature"]
        : []),
    ],
    "edit context",
  );
  const parameters = list(context.parameters, AI_LIMITS.parameters, (value) => {
    const p = record(
      value,
      ["id", "name", "expression", "value", "unit"],
      "edit parameter",
    );
    if (
      typeof p.value !== "number" ||
      !Number.isFinite(p.value) ||
      Math.abs(p.value) > 100000
    )
      throw new Error(
        `AI edit parameter ${typeof p.name === "string" ? p.name : "value"} is outside modeling limits.`,
      );
    return {
      id: string(p.id, "parameter ID"),
      name: identifier(p.name),
      expression: string(p.expression, "parameter expression", 256),
      value: p.value,
      unit: enumeration(p.unit, ["mm", "deg"], "parameter unit"),
    };
  });
  if (
    new Set(parameters.map((p) => p.name)).size !== parameters.length ||
    new Set(parameters.map((p) => p.id)).size !== parameters.length
  )
    throw new Error("AI edit parameters must be unique.");
  return {
    componentName: string(context.componentName, "component name"),
    parameters,
    ...("feature" in context
      ? {
          feature: (() => {
            const f = record(
              context.feature,
              ["type", "name"],
              "selected feature",
            );
            return {
              type: enumeration(
                f.type,
                ["extrude", "revolve", "hole"],
                "feature type",
              ),
              name: string(f.name, "feature name"),
            };
          })(),
        }
      : {}),
  };
}
export const AI_LIMITS = {
  promptCharacters: 6000,
  requestBytes: 32000,
  responseBytes: 256000,
  parameters: 24,
  steps: 32,
  profileVertices: 32,
  sketchIntentEntries: 64,
  profileHoles: 8,
  sketchPoints: 64,
  holeCenters: 64,
  targets: 8,
  history: 6,
  transcriptMessages: 32,
  historyEntryCharacters: 32000,
} as const;

type JsonSchema = Record<string, unknown>;
const text: JsonSchema = { type: "string" };
const choice = (...values: string[]): JsonSchema => ({
  type: "string",
  enum: values,
});
const array = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const object = (
  properties: Record<string, JsonSchema>,
  optional: string[] = [],
): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: false,
});
const base = { id: text, name: text };
const operation = {
  sketch: text,
  operation: choice("newBody", "cut", "join"),
  targets: array(text),
};
const pointSchema = object({ x: text, y: text });
const loopProfileSchema: JsonSchema = {
  anyOf: [
    object({
      type: choice("rectangle"),
      x: text,
      y: text,
      width: text,
      height: text,
    }),
    object({
      type: choice("circle"),
      x: text,
      y: text,
      radius: text,
    }),
    object({ type: choice("polygon"), vertices: array(pointSchema) }),
    object({
      type: choice("wire"),
      vertices: array(pointSchema),
      edges: array({
        anyOf: [
          object({ type: choice("line") }),
          object({
            type: choice("arc"),
            center: pointSchema,
            clockwise: { type: "boolean" },
          }),
        ],
      }),
    }),
  ],
};
// This detailed recipe schema documents JSON-encoded steps in the prompt.
// Providers receive AI_TRANSPORT_SCHEMA, whose fields are all required.
export const AI_PLAN_SCHEMA = object({
  name: text,
  summary: text,
  warnings: array(text),
  parameters: array(
    object({
      name: text,
      value: { type: "number" },
      unit: choice("mm", "deg"),
    }),
  ),
  steps: array({
    anyOf: [
      object(
        {
          ...base,
          type: choice("sketch"),
          plane: choice("XY", "XZ", "YZ"),
          offset: text,
          intent: object({
            constraints: array(
              object({
                type: choice(...constraintTypes),
                entities: array({ type: "integer" }),
                points: array({ type: "integer" }),
              }),
            ),
            dimensions: array(
              object({
                type: choice(...dimensionTypes),
                entities: array({ type: "integer" }),
                points: array({ type: "integer" }),
                value: text,
              }),
            ),
          }),
          profile: {
            anyOf: [
              loopProfileSchema,
              object({ type: choice("points"), points: array(pointSchema) }),
              object({
                type: choice("compound"),
                outer: loopProfileSchema,
                holes: array(loopProfileSchema),
              }),
            ],
          },
        },
        ["intent"],
      ),
      object({
        ...base,
        type: choice("extrude"),
        ...operation,
        distance: text,
        termination: choice("distance", "throughAll"),
        direction: choice("positive", "negative", "symmetric"),
      }),
      object({
        ...base,
        type: choice("revolve"),
        ...operation,
        axis: choice("X", "Y", "Z"),
        angle: text,
      }),
      object({
        ...base,
        type: choice("hole"),
        sketch: text,
        targets: array(text),
        centers: array({
          type: "integer",
          description: `Zero-based center index from 0 to ${AI_LIMITS.holeCenters - 1}.`,
        }),
        diameter: text,
        depth: text,
        termination: choice("distance", "throughAll"),
      }),
      object({
        ...base,
        type: choice("fillet", "chamfer"),
        owner: text,
        role: choice("startCapPerimeter", "endCapPerimeter"),
        size: text,
      }),
    ],
  }),
});
/** Keep provider grammar shallow; each step is JSON data parsed and fully
 * validated locally. Nested wire/profile unions can exceed provider grammar limits. */
export const AI_TRANSPORT_SCHEMA = object({
  name: text,
  summary: text,
  warnings: array(text),
  parameters: (AI_PLAN_SCHEMA.properties as Record<string, JsonSchema>)
    .parameters,
  steps: array({
    type: "string",
    description:
      "One JSON-encoded modeling step object, never executable code.",
  }),
});

function record(
  value: unknown,
  keys: string[],
  label: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(
      `AI ${label} has an unsupported format. Generate a new proposal.`,
    );
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`AI ${label} must contain 1–${max} characters.`);
  return value.trim();
}
function identifier(value: unknown): string {
  const name = string(value, "identifier", 64);
  if (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
    name === "prototype" ||
    Object.hasOwn(Object.prototype, name)
  )
    throw new Error(
      "AI identifiers must be safe names containing letters, digits and underscores.",
    );
  return name;
}
function enumeration<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (!values.includes(value as T))
    throw new Error(`AI ${label} is unsupported.`);
  return value as T;
}
function list<T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`AI list exceeds its limit of ${max} entries.`);
  return value.map(parse);
}
const expression = (value: unknown) => string(value, "expression", 256);
function aiPoint(value: unknown): AiPoint {
  const p = record(value, ["x", "y"], "point");
  return { x: expression(p.x), y: expression(p.y) };
}
function aiProfile(value: unknown, compoundAllowed = true): AiProfile {
  const type = enumeration(
    (value as { type?: unknown } | null)?.type,
    [
      "rectangle",
      "circle",
      "polygon",
      "wire",
      "points",
      ...(compoundAllowed ? ["compound" as const] : []),
    ],
    "profile",
  );
  if (type === "compound") {
    const p = record(value, ["type", "outer", "holes"], "compound profile");
    const loop = (value: unknown): AiLoopProfile => {
      const parsed = aiProfile(value, false);
      if (parsed.type === "points" || parsed.type === "compound")
        throw new Error("AI compound boundaries must be closed loops.");
      return parsed;
    };
    const outer = loop(p.outer),
      holes = list(p.holes, AI_LIMITS.profileHoles, loop);
    if (!holes.length)
      throw new Error(
        "AI compound profiles require at least one inner opening.",
      );
    if (outer.type === "circle" && holes.some((h) => h.type !== "circle"))
      throw new Error(
        "AI circular outer loops currently support circular inner openings only.",
      );
    const points = (p: AiLoopProfile) =>
      p.type === "rectangle"
        ? 5
        : p.type === "circle"
          ? 1
          : p.vertices.length +
            (p.type === "wire"
              ? p.edges.filter((e) => e.type === "arc").length
              : 0);
    if (
      [outer, ...holes].reduce((sum, p) => sum + points(p), 0) >
      AI_LIMITS.sketchPoints
    )
      throw new Error("AI compound profile exceeds the sketch point budget.");
    return { type, outer, holes };
  }
  if (type === "polygon" || type === "wire" || type === "points") {
    const p = record(
      value,
      [
        "type",
        ...(type === "points"
          ? ["points"]
          : type === "wire"
            ? ["vertices", "edges"]
            : ["vertices"]),
      ],
      "profile",
    );
    if (type === "points") {
      const points = list(p.points, AI_LIMITS.holeCenters, aiPoint);
      if (!points.length)
        throw new Error("AI hole sketch needs at least one point.");
      return { type, points };
    }
    const vertices = list(p.vertices, AI_LIMITS.profileVertices, aiPoint);
    if (vertices.length < (type === "polygon" ? 3 : 2))
      throw new Error("AI closed profile needs more vertices.");
    if (type === "polygon") return { type, vertices };
    const edges = list(
      p.edges,
      AI_LIMITS.profileVertices,
      (value): AiWireEdge => {
        const type = enumeration(
          (value as { type?: unknown } | null)?.type,
          ["line", "arc"],
          "wire edge",
        );
        const e = record(
          value,
          type === "line" ? ["type"] : ["type", "center", "clockwise"],
          "wire edge",
        );
        if (type === "line") return { type };
        if (typeof e.clockwise !== "boolean")
          throw new Error("AI arc winding must be boolean.");
        return { type, center: aiPoint(e.center), clockwise: e.clockwise };
      },
    );
    if (edges.length !== vertices.length)
      throw new Error(
        "AI wire requires one outgoing edge per vertex, including the closing edge.",
      );
    if (vertices.length === 2 && edges.every((edge) => edge.type === "line"))
      throw new Error(
        "AI two-vertex wire needs an arc; two lines enclose no area.",
      );
    return { type, vertices, edges };
  }
  const p = record(
    value,
    [
      "type",
      "x",
      "y",
      ...(type === "rectangle" ? ["width", "height"] : ["radius"]),
    ],
    "profile",
  );
  const coords = { x: expression(p.x), y: expression(p.y) };
  return type === "rectangle"
    ? {
        type,
        ...coords,
        width: expression(p.width),
        height: expression(p.height),
      }
    : { type, ...coords, radius: expression(p.radius) };
}

function aiSketchIntent(value: unknown): AiSketchIntent {
  const intent = record(value, ["constraints", "dimensions"], "sketch intent");
  const indices = (value: unknown) => {
    const values = list(value, 4, (item) => {
      if (
        typeof item !== "number" ||
        !Number.isInteger(item) ||
        item < 0 ||
        item >= 128
      )
        throw new Error(
          "AI sketch intent indices must be integers from 0 to 127.",
        );
      return item;
    });
    if (new Set(values).size !== values.length)
      throw new Error("AI sketch intent references must be unique.");
    return values;
  };
  return {
    constraints: list(
      intent.constraints,
      AI_LIMITS.sketchIntentEntries,
      (item) => {
        const c = record(item, ["type", "entities", "points"], "constraint");
        return {
          type: enumeration(c.type, constraintTypes, "constraint type"),
          entities: indices(c.entities),
          points: indices(c.points),
        };
      },
    ),
    dimensions: list(
      intent.dimensions,
      AI_LIMITS.sketchIntentEntries,
      (item) => {
        const d = record(
          item,
          ["type", "entities", "points", "value"],
          "dimension",
        );
        return {
          type: enumeration(d.type, dimensionTypes, "dimension type"),
          entities: indices(d.entities),
          points: indices(d.points),
          value: expression(d.value),
        };
      },
    ),
  };
}
export function validateAiPlan(value: unknown): AiPlan {
  const root = record(
    value,
    ["name", "summary", "warnings", "parameters", "steps"],
    "proposal",
  );
  const parameters = list(
    root.parameters,
    AI_LIMITS.parameters,
    (item): AiParameter => {
      const p = record(item, ["name", "value", "unit"], "parameter");
      if (
        typeof p.value !== "number" ||
        !Number.isFinite(p.value) ||
        Math.abs(p.value) > 100000 ||
        (p.value !== 0 && Math.abs(p.value) < 0.000001)
      )
        throw new Error(
          "AI parameter values must be finite, within ±100000, and at least 0.000001 in magnitude when nonzero.",
        );
      return {
        name: identifier(p.name),
        value: p.value,
        unit: enumeration(p.unit, ["mm", "deg"], "parameter unit"),
      };
    },
  );
  if (new Set(parameters.map((p) => p.name)).size !== parameters.length)
    throw new Error("AI parameter names must be unique.");
  const steps = list(root.steps, AI_LIMITS.steps, (item): AiStep => {
    const type = enumeration(
      (item as { type?: unknown } | null)?.type,
      ["sketch", "extrude", "revolve", "hole", "fillet", "chamfer"],
      "operation",
    );
    const keys =
      type === "sketch"
        ? [
            "plane",
            "offset",
            "profile",
            ...(Object.hasOwn(item as object, "intent") ? ["intent"] : []),
          ]
        : type === "extrude"
          ? [
              "sketch",
              "operation",
              "targets",
              "distance",
              "termination",
              "direction",
            ]
          : type === "hole"
            ? [
                "sketch",
                "targets",
                "centers",
                "diameter",
                "depth",
                "termination",
              ]
            : type === "revolve"
              ? ["sketch", "operation", "targets", "axis", "angle"]
              : ["owner", "role", "size"];
    const s = record(item, ["id", "name", "type", ...keys], "step");
    const common = { id: identifier(s.id), name: string(s.name, "step name") };
    if (type === "sketch") {
      return {
        ...common,
        type,
        plane: enumeration(s.plane, ["XY", "XZ", "YZ"], "plane"),
        offset: expression(s.offset),
        profile: aiProfile(s.profile),
        ...("intent" in s ? { intent: aiSketchIntent(s.intent) } : {}),
      };
    }
    if (type === "hole") {
      const targets = list(s.targets, AI_LIMITS.targets, identifier);
      const centers = list(s.centers, AI_LIMITS.holeCenters, (value) => {
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 0 ||
          value >= AI_LIMITS.holeCenters
        )
          throw new Error(
            `AI hole center indices must be integers from 0 to ${AI_LIMITS.holeCenters - 1}.`,
          );
        return value;
      });
      if (
        !targets.length ||
        new Set(targets).size !== targets.length ||
        !centers.length ||
        new Set(centers).size !== centers.length
      )
        throw new Error(
          "AI holes require unique explicit targets and center indices.",
        );
      return {
        ...common,
        type,
        sketch: identifier(s.sketch),
        targets,
        centers,
        diameter: expression(s.diameter),
        depth: expression(s.depth),
        termination: enumeration(
          s.termination,
          ["distance", "throughAll"],
          "hole termination",
        ),
      };
    }
    if (type === "fillet" || type === "chamfer")
      return {
        ...common,
        type,
        owner: identifier(s.owner),
        role: enumeration(
          s.role,
          ["startCapPerimeter", "endCapPerimeter"],
          "edge role",
        ),
        size: expression(s.size),
      };
    const scope = {
      sketch: identifier(s.sketch),
      operation: enumeration(
        s.operation,
        ["newBody", "cut", "join"],
        "boolean operation",
      ),
      targets: list(s.targets, AI_LIMITS.targets, identifier),
    };
    if (
      new Set(scope.targets).size !== scope.targets.length ||
      (scope.operation === "newBody"
        ? scope.targets.length > 0
        : !scope.targets.length)
    )
      throw new Error(
        "AI modeling targets must be explicit, unique and empty only for New Body.",
      );
    if (type === "extrude") {
      const termination = enumeration(
        s.termination,
        ["distance", "throughAll"],
        "termination",
      );
      if (termination === "throughAll" && scope.operation === "newBody")
        throw new Error("AI Through All requires a Cut or Join target.");
      return {
        ...common,
        ...scope,
        type,
        distance: expression(s.distance),
        termination,
        direction: enumeration(
          s.direction,
          ["positive", "negative", "symmetric"],
          "direction",
        ),
      };
    }
    return {
      ...common,
      ...scope,
      type,
      axis: enumeration(s.axis, ["X", "Y", "Z"], "axis"),
      angle: expression(s.angle),
    };
  });
  if (new Set(steps.map((s) => s.id)).size !== steps.length)
    throw new Error("AI step identifiers must be unique.");
  return {
    name: string(root.name, "component name"),
    summary: string(root.summary, "summary", 2400),
    warnings: list(root.warnings, 8, (item) => string(item, "warning", 500)),
    parameters,
    steps,
  };
}
