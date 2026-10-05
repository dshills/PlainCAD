/** A bounded recipe, never executable code or a provider-authored CadDocument. */
export const AI_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export interface AiParameter {
  name: string;
  value: number;
  unit: "mm" | "deg";
}
export type AiProfile =
  | { type: "rectangle"; x: string; y: string; width: string; height: string }
  | { type: "circle"; x: string; y: string; radius: string };
export type AiStep =
  | {
      type: "sketch";
      id: string;
      name: string;
      plane: "XY" | "XZ" | "YZ";
      offset: string;
      profile: AiProfile;
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
export const AI_LIMITS = {
  promptCharacters: 6000,
  requestBytes: 32000,
  responseBytes: 256000,
  parameters: 24,
  steps: 32,
  history: 6,
  historyEntryCharacters: 12000,
} as const;

type JsonSchema = Record<string, unknown>;
const text: JsonSchema = { type: "string" };
const choice = (...values: string[]): JsonSchema => ({
  type: "string",
  enum: values,
});
const array = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const base = { id: text, name: text };
const operation = {
  sketch: text,
  operation: choice("newBody", "cut", "join"),
  targets: array(text),
};
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
      object({
        ...base,
        type: choice("sketch"),
        plane: choice("XY", "XZ", "YZ"),
        offset: text,
        profile: {
          anyOf: [
            object({
              type: choice("rectangle"),
              x: text,
              y: text,
              width: text,
              height: text,
            }),
            object({ type: choice("circle"), x: text, y: text, radius: text }),
          ],
        },
      }),
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
        type: choice("fillet", "chamfer"),
        owner: text,
        role: choice("startCapPerimeter", "endCapPerimeter"),
        size: text,
      }),
    ],
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
      ["sketch", "extrude", "revolve", "fillet", "chamfer"],
      "operation",
    );
    const keys =
      type === "sketch"
        ? ["plane", "offset", "profile"]
        : type === "extrude"
          ? [
              "sketch",
              "operation",
              "targets",
              "distance",
              "termination",
              "direction",
            ]
          : type === "revolve"
            ? ["sketch", "operation", "targets", "axis", "angle"]
            : ["owner", "role", "size"];
    const s = record(item, ["id", "name", "type", ...keys], "step");
    const common = { id: identifier(s.id), name: string(s.name, "step name") };
    if (type === "sketch") {
      const shape = enumeration(
        (s.profile as { type?: unknown } | null)?.type,
        ["rectangle", "circle"],
        "profile",
      );
      const p = record(
        s.profile,
        [
          "type",
          "x",
          "y",
          ...(shape === "rectangle" ? ["width", "height"] : ["radius"]),
        ],
        "profile",
      );
      const coords = { x: expression(p.x), y: expression(p.y) };
      return {
        ...common,
        type,
        plane: enumeration(s.plane, ["XY", "XZ", "YZ"], "plane"),
        offset: expression(s.offset),
        profile:
          shape === "rectangle"
            ? {
                ...coords,
                type: shape,
                width: expression(p.width),
                height: expression(p.height),
              }
            : { ...coords, type: shape, radius: expression(p.radius) },
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
      targets: list(s.targets, 8, identifier),
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
