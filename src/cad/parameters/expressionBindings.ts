import type {
  CadDocument,
  CadParameter,
  ExpressionRef,
  Feature,
  ValidationIssue,
} from "../document/schema";
import { tokenize } from "./expressionEvaluator";

type Expression = ExpressionRef | CadParameter;
export function parameterTokens(expression: string) {
  const tokens = tokenize(expression);
  return tokens.filter(
    (token, i) =>
      token.type === "identifier" &&
      tokens[i - 1]?.type !== "number" &&
      !(tokens[i + 1]?.type === "paren" && tokens[i + 1].value === "("),
  );
}
/** Visit only schema-owned expression fields, never arbitrary metadata. */
export function mapDocumentExpressions(
  document: CadDocument,
  visit: (
    expression: Expression,
    source: ValidationIssue["source"],
    id: string,
    field: string,
  ) => Expression,
): CadDocument {
  const parameters = Object.fromEntries(
    Object.entries(document.parameters).map(([name, p]) => [
      name,
      visit(p, "parameter", p.id, "expression") as CadParameter,
    ]),
  );
  const sketches = Object.fromEntries(
    Object.entries(document.sketches).map(([id, s]) => {
      const read = (v: ExpressionRef, field: string) =>
        visit(v, "sketch", id, field) as ExpressionRef;
      return [
        id,
        {
          ...s,
          plane:
            s.plane.type === "offset"
              ? { ...s.plane, offset: read(s.plane.offset, "offset") }
              : s.plane,
          entities: Object.fromEntries(
            Object.entries(s.entities).map(([key, e]) => [
              key,
              e.type === "point"
                ? { ...e, x: read(e.x, `${key}.x`), y: read(e.y, `${key}.y`) }
                : e.type === "circle"
                  ? { ...e, radius: read(e.radius, `${key}.radius`) }
                  : e,
            ]),
          ),
          dimensions: s.dimensions.map((d) => ({
            ...d,
            expression: read(d.expression, `dimension:${d.id}`),
          })),
        },
      ];
    }),
  );
  const features = document.features.map((f): Feature => {
    const read = (v: ExpressionRef, field: string) =>
      visit(v, "feature", f.id, field) as ExpressionRef;
    if (f.type === "extrude")
      return {
        ...f,
        distance: read(f.distance, "distance"),
        ...(f.termination?.type === "distance" && f.termination.distance
          ? {
              termination: {
                ...f.termination,
                distance: read(f.termination.distance, "termination.distance"),
              },
            }
          : {}),
      };
    if (f.type === "revolve") return { ...f, angle: read(f.angle, "angle") };
    if (f.type === "hole")
      return {
        ...f,
        diameter: read(f.diameter, "diameter"),
        depth: f.depth === "throughAll" ? f.depth : read(f.depth, "depth"),
      };
    if (f.type === "fillet") return { ...f, radius: read(f.radius, "radius") };
    if (f.type === "chamfer")
      return { ...f, distance: read(f.distance, "distance") };
    const exhaustive: never = f;
    return exhaustive;
  });
  return { ...document, parameters, sketches, features };
}
const key = (source: string, id: string, field: string) =>
  JSON.stringify([source, id, field]);
export function bindDocumentExpressions(
  document: CadDocument,
  previous?: CadDocument,
): CadDocument {
  const old = new Map<string, Expression>();
  if (previous)
    mapDocumentExpressions(previous, (e, s, id, field) => {
      old.set(key(s, id, field), e);
      return e;
    });
  return mapDocumentExpressions(document, (e, s, id, field) => {
    const before = old.get(key(s, id, field));
    const retained =
      before && before.expression !== e.expression
        ? undefined
        : e.parameterRefs;
    let tokens: ReturnType<typeof parameterTokens>;
    try {
      tokens = parameterTokens(e.expression);
    } catch {
      return { ...e, parameterRefs: undefined };
    }
    const refs = Object.fromEntries(
      tokens.flatMap((token) => {
        const boundId =
          retained && Object.hasOwn(retained, token.value)
            ? retained[token.value]
            : undefined;
        const parameter = Object.hasOwn(document.parameters, token.value)
          ? document.parameters[token.value]
          : undefined;
        const id = boundId ?? parameter?.id;
        return id ? [[token.value, id]] : [];
      }),
    );
    return { ...e, parameterRefs: Object.keys(refs).length ? refs : undefined };
  });
}
export function refreshBoundNames(document: CadDocument): CadDocument {
  const names = new Map(
    Object.values(document.parameters).map((p) => [p.id, p.name]),
  );
  return mapDocumentExpressions(document, (e) => {
    if (!e.parameterRefs || !Object.keys(e.parameterRefs).length) return e;
    const tokens = parameterTokens(e.expression);
    let expression = "",
      cursor = 0;
    const refs: Record<string, string> = {};
    for (const token of tokens) {
      const id: string | undefined = Object.hasOwn(e.parameterRefs, token.value)
        ? e.parameterRefs[token.value]
        : undefined;
      if (!id) continue;
      const name = names.get(id) ?? token.value;
      if (Object.hasOwn(refs, name) && refs[name] !== id) return e;
      expression += e.expression.slice(cursor, token.start) + name;
      cursor = token.end;
      refs[name] = id;
    }
    return {
      ...e,
      expression: expression + e.expression.slice(cursor),
      parameterRefs: refs,
    };
  });
}
export function validateParameterBindings(
  document: CadDocument,
  requireTargets = false,
): ValidationIssue[] {
  const ids = new Set(Object.values(document.parameters).map((p) => p.id));
  const issues: ValidationIssue[] = [];
  mapDocumentExpressions(document, (e, source, sourceId, field) => {
    if (e.parameterRefs === undefined) return e;
    const fail = (message: string) =>
      issues.push({ source, sourceId, message: `${field}: ${message}` });
    if (
      !e.parameterRefs ||
      typeof e.parameterRefs !== "object" ||
      Array.isArray(e.parameterRefs)
    ) {
      fail("Parameter bindings must be an object.");
      return e;
    }
    try {
      const symbols = new Set(
        parameterTokens(e.expression).map((t) => t.value),
      );
      for (const [symbol, id] of Object.entries(e.parameterRefs)) {
        if (
          !symbols.has(symbol) ||
          typeof id !== "string" ||
          !id ||
          (requireTargets && !ids.has(id))
        )
          fail(`Invalid or missing parameter binding for ${symbol}.`);
      }
    } catch {
      fail("Bound expression has invalid tokens.");
    }
    return e;
  });
  return issues;
}
export function renameParameter(
  document: CadDocument,
  id: string,
  name: string,
): CadDocument {
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ||
    name === "prototype" ||
    Object.hasOwn(Object.prototype, name)
  )
    throw new Error("Parameter name must be a safe identifier.");
  const current = Object.values(document.parameters).find((p) => p.id === id);
  if (!current) throw new Error("Parameter no longer exists.");
  if (
    Object.hasOwn(document.parameters, name) &&
    document.parameters[name].id !== id
  )
    throw new Error(`Parameter ${name} already exists.`);
  mapDocumentExpressions(document, (e) => {
    let tokens: ReturnType<typeof parameterTokens>;
    try {
      tokens = parameterTokens(e.expression);
    } catch {
      throw new Error(
        "Fix invalid expression tokens before renaming a parameter.",
      );
    }
    if (
      name !== current.name &&
      tokens.some(
        (token) =>
          token.value === name &&
          ((!Object.hasOwn(e.parameterRefs ?? {}, name) &&
            !Object.hasOwn(document.parameters, name)) ||
            (Object.hasOwn(e.parameterRefs ?? {}, name) &&
              e.parameterRefs?.[name] !== current.id)),
      )
    )
      throw new Error(
        `Rename would capture an unresolved reference to ${name}. Repair that expression first.`,
      );
    return e;
  });
  const bound = bindDocumentExpressions(document);
  const parameters = { ...bound.parameters };
  const parameter = parameters[current.name];
  delete parameters[current.name];
  parameters[name] = { ...parameter, name };
  return refreshBoundNames({ ...bound, parameters });
}
