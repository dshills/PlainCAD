import { Sketch, SketchEntity, ExpressionRef } from "../document/schema";
import {
  collectExpressionDependencies,
  evaluateExpressionRef,
} from "../parameters/expressionEvaluator";
import { Quantity } from "../parameters/units";
import { solveSketch as solveLegacySketch } from "./legacySketchSolver";
import {
  ANGULAR_TOLERANCE,
  MIN_ENTITY_SIZE,
  SOLVE_TOLERANCE,
  SOLVER_LIMITS,
} from "./tolerances";

export interface ResolvedPoint {
  id: string;
  x: number;
  y: number;
  construction?: boolean;
}
export interface ResolvedLine {
  id: string;
  start: ResolvedPoint;
  end: ResolvedPoint;
  construction?: boolean;
}
export interface ResolvedCircle {
  id: string;
  center: ResolvedPoint;
  radius: number;
  construction?: boolean;
}
export interface ResolvedArc extends ResolvedCircle {
  start: ResolvedPoint;
  end: ResolvedPoint;
  startAngle: number;
  sweep: number;
}
export interface SketchSolveError {
  sketchId: string;
  constraintId?: string;
  entityId?: string;
  message: string;
  severity: "warning" | "error";
}
export interface ResolvedSketch {
  id: string;
  points: Record<string, ResolvedPoint>;
  lines: ResolvedLine[];
  circles: ResolvedCircle[];
  arcs: ResolvedArc[];
  errors: SketchSolveError[];
  status:
    | "underconstrained"
    | "fullyConstrained"
    | "overconstrained"
    | "conflicting"
    | "nonConverged";
  degreesOfFreedom: number;
  redundantConstraintIds: string[];
  iterations: number;
  seedUsed: boolean;
  authoredGeometry?: string;
}
export interface SolveOptions {
  seed?: ResolvedSketch;
  reset?: boolean;
  maxIterations?: number;
  maxElapsedMs?: number;
}
interface Row {
  id: string;
  message: string;
  variables: number[];
  value(x: number[]): number;
}

export function solveSketch(
  sketch: Sketch,
  parameters: Record<string, Quantity>,
  options: SolveOptions = {},
): ResolvedSketch {
  if (sketch.solveMode === "validate") {
    const legacy = solveLegacySketch(sketch, parameters);
    const flags = (id: string) => sketch.entities[id]?.construction;
    return {
      ...legacy,
      lines: legacy.lines.map((l) => ({ ...l, construction: flags(l.id) })),
      circles: legacy.circles.map((c) => ({ ...c, construction: flags(c.id) })),
      arcs: [],
      status: legacy.errors.length ? "conflicting" : "underconstrained",
      degreesOfFreedom:
        Object.keys(legacy.points).length * 2 + legacy.circles.length,
      redundantConstraintIds: [],
      iterations: 0,
      seedUsed: false,
    };
  }
  const started = performance.now();
  const errors: SketchSolveError[] = [];
  const rows: Row[] = [];
  const x: number[] = [];
  const pointVars = new Map<string, [number, number]>();
  const radiusVars = new Map<string, number>();
  const addError = (id: string, message: string, entity = false) =>
    errors.push({
      sketchId: sketch.id,
      ...(entity ? { entityId: id } : { constraintId: id }),
      message,
      severity: "error",
    });
  const read = (
    id: string,
    expression: ExpressionRef,
    dimension: "length" | "angle",
  ): number => {
    const result = evaluateExpressionRef(expression, { parameters });
    if (
      result.error ||
      !result.quantity ||
      result.quantity.dimension !== dimension ||
      !Number.isFinite(result.quantity.value)
    ) {
      addError(
        id,
        result.error ?? `Expression must resolve to ${dimension} values.`,
        true,
      );
      return 0;
    }
    return result.quantity.value;
  };
  const entities = Object.values(sketch.entities).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const e of entities) {
    if (e.type === "point") {
      pointVars.set(e.id, [x.length, x.length + 1]);
      x.push(
        read(e.id, e.x, "length"),
        read(e.id, e.y, "length"),
      );
    } else if (e.type === "circle") {
      radiusVars.set(e.id, x.length);
      x.push(read(e.id, e.radius, "length"));
    }
  }
  if (errors.length) {
    // Failed expressions cannot supply placeholder coordinates to renderers or profile detection.
    return {
      id: sketch.id,
      points: {},
      lines: [],
      circles: [],
      arcs: [],
      errors,
      status: "conflicting",
      degreesOfFreedom: x.length,
      redundantConstraintIds: [],
      iterations: 0,
      seedUsed: false,
    };
  }
  if (
    x.length > SOLVER_LIMITS.variables ||
    sketch.constraints.length + sketch.dimensions.length >
      SOLVER_LIMITS.equations
  ) {
    addError(
      sketch.id,
      `Sketch exceeds the interactive solver budget (${SOLVER_LIMITS.variables} variables, ${SOLVER_LIMITS.equations} equations). Split it into smaller sketches.`,
    );
    return {
      id: sketch.id,
      points: {},
      lines: [],
      circles: [],
      arcs: [],
      errors,
      status: "nonConverged",
      degreesOfFreedom: x.length,
      redundantConstraintIds: [],
      iterations: 0,
      seedUsed: false,
    };
  }
  const authored = [...x];
  const authoredGeometry = JSON.stringify(entities);
  const point = (id: string, values: number[]) => {
    const indexes = pointVars.get(id);
    if (!indexes) throw new Error(`Unresolved point "${id}".`);
    return { x: values[indexes[0]], y: values[indexes[1]] };
  };
  const entity = (id: string): SketchEntity => {
    const e = sketch.entities[id];
    if (!e) throw new Error(`Unresolved entity "${id}".`);
    return e;
  };
  const line = (id: string, values: number[]) => {
    const e = entity(id);
    if (e.type !== "line") throw new Error("Constraint requires a line.");
    return { a: point(e.startPointId, values), b: point(e.endPointId, values) };
  };
  const round = (id: string, values: number[]) => {
    const e = entity(id);
    if (e.type !== "circle" && e.type !== "arc")
      throw new Error("Constraint requires a circle or arc.");
    const c = point(e.centerPointId, values);
    return {
      c,
      r:
        e.type === "circle"
          ? values[radiusVars.get(id)!]
          : distance(c, point(e.startPointId, values)),
    };
  };
  const indexesFor = (ids: string[], points: string[]) => {
    const indexes = new Set<number>();
    const addPoint = (id: string) => {
      const vars = pointVars.get(id);
      if (!vars) throw new Error(`Unresolved point "${id}".`);
      vars.forEach((i) => indexes.add(i));
    };
    points.forEach(addPoint);
    ids.forEach((id) => {
      const e = entity(id);
      if (e.type === "point") addPoint(id);
      if (e.type === "line" || e.type === "arc") {
        addPoint(e.startPointId);
        addPoint(e.endPointId);
      }
      if (e.type === "circle" || e.type === "arc") addPoint(e.centerPointId);
      if (e.type === "circle") indexes.add(radiusVars.get(id)!);
    });
    return [...indexes].sort((a, b) => a - b);
  };
  const addRows = (
    id: string,
    label: string,
    ids: string[],
    pts: string[],
    values: Array<(v: number[]) => number>,
  ) => {
    try {
      if (rows.length + values.length > SOLVER_LIMITS.equations)
        throw new Error(
          "Sketch exceeds the interactive solver equation budget. Split it into smaller sketches.",
        );
      const variables = indexesFor(ids, pts);
      values.forEach((value) => {
        if (!Number.isFinite(value(x)))
          throw new Error("Invalid or degenerate constraint geometry.");
      });
      rows.push(
        ...values.map((value) => ({
          id,
          message: `Cannot satisfy ${label}.`,
          variables,
          value,
        })),
      );
    } catch (error) {
      addError(id, error instanceof Error ? error.message : String(error));
    }
  };
  // Coincidence has a canonical seed anchored at the first authored/fixed point, never a guess at topology.
  const parent = new Map([...pointVars.keys()].map((id) => [id, id]));
  const root = (id: string): string => {
    let p = id;
    while (parent.get(p) && parent.get(p) !== p) p = parent.get(p)!;
    return p;
  };
  for (const c of sketch.constraints.filter((c) => c.type === "coincident")) {
    const ids = c.pointIds ?? [];
    for (const id of ids.slice(1))
      if (parent.has(ids[0]) && parent.has(id))
        parent.set(root(id), root(ids[0]));
  }
  const fixedPoints = new Set(
    sketch.constraints
      .filter((c) => c.type === "fixed")
      .flatMap((c) => c.pointIds ?? []),
  );
  for (const id of pointVars.keys()) {
    const group = [...pointVars.keys()].filter((p) => root(p) === root(id));
    const anchor = group.find((p) => fixedPoints.has(p)) ?? group[0];
    const target = pointVars.get(anchor)!;
    const indexes = pointVars.get(id)!;
    if (
      fixedPoints.has(id) &&
      distance(point(id, authored), point(anchor, authored)) > SOLVE_TOLERANCE
    )
      addError(
        id,
        "Coincident constraint conflicts with fixed point coordinates.",
        true,
      );
    x[indexes[0]] = x[target[0]];
    x[indexes[1]] = x[target[1]];
  }
  let seedUsed = false;
  if (
    errors.length === 0 &&
    options.seed &&
    options.seed.authoredGeometry === authoredGeometry &&
    !options.reset &&
    !options.seed.errors.length
  ) {
    // Keep parameter-driven expressions current; only constant coordinate seeds can be reused.
    for (const e of entities)
      if (e.type === "point" && options.seed.points[e.id]) {
        const prev = options.seed.points[e.id];
        const vars = pointVars.get(e.id)!;
        if (
          ![
            ...collectExpressionDependencies(e.x.expression),
            ...collectExpressionDependencies(e.y.expression),
          ].some((name) =>
            Object.prototype.hasOwnProperty.call(parameters, name),
          ) &&
          !fixedPoints.has(e.id)
        ) {
          x[vars[0]] = prev.x;
          x[vars[1]] = prev.y;
          seedUsed = true;
        }
      }
    for (const e of entities)
      if (
        e.type === "circle" &&
        !collectExpressionDependencies(e.radius.expression).some((name) =>
          Object.prototype.hasOwnProperty.call(parameters, name),
        )
      ) {
        const previous = options.seed.circles.find((c) => c.id === e.id);
        if (previous) {
          x[radiusVars.get(e.id)!] = previous.radius;
          seedUsed = true;
        }
      }
  }
  for (const e of entities.filter((e) => e.type === "arc")) {
    if (e.type !== "arc") continue;
    addRows(
      e.id,
      "arc endpoint radii",
      [e.id],
      [],
      [
        (v) =>
          distance(point(e.centerPointId, v), point(e.startPointId, v)) -
          distance(point(e.centerPointId, v), point(e.endPointId, v)),
      ],
    );
  }
  for (const c of sketch.constraints) {
    const ids = c.entityIds,
      pts = c.pointIds ?? [];
    const label = `${c.type} constraint`;
    try {
      if (c.type === "fixed") {
        const indexes = indexesFor(ids, pts);
        if (!indexes.length)
          throw new Error("Fixed constraint requires points or entities.");
        addRows(
          c.id,
          label,
          ids,
          pts,
          indexes.map((i) => (v) => v[i] - authored[i]),
        );
      } else if (c.type === "coincident") {
        if (pts.length < 2)
          throw new Error(
            "Coincident constraint requires at least two points.",
          );
        addRows(
          c.id,
          label,
          ids,
          pts,
          pts
            .slice(1)
            .flatMap((id) => [
              (v: number[]) => point(id, v).x - point(pts[0], v).x,
              (v: number[]) => point(id, v).y - point(pts[0], v).y,
            ]),
        );
      } else if (c.type === "horizontal" || c.type === "vertical") {
        if (!ids.length)
          throw new Error(`${c.type} constraint requires at least one line.`);
        addRows(
          c.id,
          label,
          ids,
          pts,
          ids.map((id) => (v) => {
            const l = line(id, v);
            return c.type === "horizontal" ? l.b.y - l.a.y : l.b.x - l.a.x;
          }),
        );
      } else if (
        c.type === "parallel" ||
        c.type === "perpendicular" ||
        c.type === "equalLength" ||
        c.type === "equalRadius"
      ) {
        if (
          ids.length < 2 ||
          ((c.type === "parallel" || c.type === "perpendicular") &&
            ids.length !== 2)
        )
          throw new Error(
            `${c.type} constraint requires ${c.type === "equalLength" || c.type === "equalRadius" ? "at least" : "exactly"} two entities.`,
          );
        addRows(
          c.id,
          label,
          ids,
          pts,
          ids.slice(1).map((id) => (v: number[]) => {
            if (c.type === "equalRadius")
              return round(ids[0], v).r - round(id, v).r;
            const a = line(ids[0], v),
              b = line(id, v);
            if (c.type === "equalLength")
              return distance(a.a, a.b) - distance(b.a, b.b);
            const u = delta(a.a, a.b),
              w = delta(b.a, b.b),
              norm = Math.max(
                MIN_ENTITY_SIZE,
                Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y),
              );
            return (
              (10 *
                (c.type === "parallel"
                  ? u.x * w.y - u.y * w.x
                  : u.x * w.x + u.y * w.y)) /
              norm
            );
          }),
        );
      } else if (c.type === "midpoint") {
        if (ids.length !== 1 || pts.length !== 1)
          throw new Error(
            "Midpoint constraint requires one point and one resolved line.",
          );
        addRows(c.id, label, ids, pts, [
          (v) =>
            point(pts[0], v).x -
            (line(ids[0], v).a.x + line(ids[0], v).b.x) / 2,
          (v) =>
            point(pts[0], v).y -
            (line(ids[0], v).a.y + line(ids[0], v).b.y) / 2,
        ]);
      } else if (c.type === "symmetric") {
        if (pts.length !== 4)
          throw new Error(
            "Symmetric constraint requires two points and two axis points.",
          );
        const reflection = (v: number[]) => {
          const a = point(pts[0], v),
            b = point(pts[2], v),
            d = delta(b, point(pts[3], v));
          const norm = d.x * d.x + d.y * d.y;
          if (norm < MIN_ENTITY_SIZE ** 2)
            throw new Error("Symmetry axis is degenerate.");
          const t = ((a.x - b.x) * d.x + (a.y - b.y) * d.y) / norm;
          return { x: 2 * (b.x + t * d.x) - a.x, y: 2 * (b.y + t * d.y) - a.y };
        };
        addRows(c.id, label, ids, pts, [
          (v) => point(pts[1], v).x - reflection(v).x,
          (v) => point(pts[1], v).y - reflection(v).y,
        ]);
      } else if (c.type === "tangent") {
        if (ids.length !== 2)
          throw new Error("Tangent constraint requires exactly two entities.");
        const lineId = ids.find((id) => entity(id).type === "line");
        if (lineId) {
          const roundId = ids.find((id) => id !== lineId)!;
          addRows(c.id, label, ids, pts, [
            (v) => {
              const l = line(lineId, v),
                r = round(roundId, v);
              return segmentDistance(r.c, l.a, l.b) - r.r;
            },
          ]);
        } else {
          const a = round(ids[0], x),
            b = round(ids[1], x);
          const internal =
            Math.abs(distance(a.c, b.c) - Math.abs(a.r - b.r)) <
            Math.abs(distance(a.c, b.c) - a.r - b.r);
          addRows(c.id, label, ids, pts, [
            (v) => {
              const a = round(ids[0], v),
                b = round(ids[1], v);
              return (
                distance(a.c, b.c) -
                (internal ? Math.abs(a.r - b.r) : a.r + b.r)
              );
            },
          ]);
        }
      }
    } catch (error) {
      addError(c.id, error instanceof Error ? error.message : String(error));
    }
  }
  for (const d of sketch.dimensions) {
    const result = evaluateExpressionRef(d.expression, { parameters });
    const angle = d.type === "angle";
    if (
      result.error ||
      !result.quantity ||
      result.quantity.dimension !== (angle ? "angle" : "length")
    ) {
      addError(
        d.id,
        result.error ?? `${d.type} dimension has incompatible units.`,
      );
      continue;
    }
    const expected = result.quantity.value;
    if (
      !Number.isFinite(expected) ||
      expected < 0 ||
      ((d.type === "length" ||
        d.type === "radius" ||
        d.type === "diameter" ||
        d.type === "distance") &&
        expected < MIN_ENTITY_SIZE) ||
      (angle && expected > Math.PI)
    ) {
      addError(
        d.id,
        `${d.type} dimension must be positive (angles between 0 and 180 degrees).`,
      );
      continue;
    }
    const pts = d.pointIds ?? [],
      ids = d.entityIds;
    addRows(d.id, `${d.type} dimension`, ids, pts, [
      (v) => {
        if (d.type === "radius" || d.type === "diameter") {
          if (ids.length !== 1)
            throw new Error(
              "Radius/diameter dimension requires one circle or arc.",
            );
          return (
            round(ids[0], v).r * (d.type === "diameter" ? 2 : 1) - expected
          );
        }
        if (d.type === "length") {
          if (ids.length !== 1)
            throw new Error("Length dimension requires one line.");
          const l = line(ids[0], v);
          return distance(l.a, l.b) - expected;
        }
        if (angle) {
          if (ids.length !== 2 || ids[0] === ids[1])
            throw new Error("Angle dimension requires two distinct lines.");
          const a = line(ids[0], v),
            b = line(ids[1], v),
            u = delta(a.a, a.b),
            w = delta(b.a, b.b);
          return (
            10 *
            (Math.atan2(
              Math.abs(u.x * w.y - u.y * w.x),
              u.x * w.x + u.y * w.y,
            ) -
              expected)
          );
        }
        if (pts.length !== 2)
          throw new Error("Distance dimension requires exactly two points.");
        const a = point(pts[0], v),
          b = point(pts[1], v);
        if (d.type === "horizontalDistance")
          return Math.abs(b.x - a.x) - expected;
        if (d.type === "verticalDistance")
          return Math.abs(b.y - a.y) - expected;
        return distance(a, b) - expected;
      },
    ]);
  }
  const branchSeed = [...x];
  let iterations = 0,
    converged = false,
    limited = false;
  const valueOf = (row: Row, values: number[]) => {
    try {
      return row.value(values);
    } catch {
      return Number.NaN;
    }
  };
  const residual = (values: number[]) =>
    rows.map((row) => valueOf(row, values));
  const jacobian = (values: number[], r: number[]) =>
    rows.map((row, j) => {
      const gradient = new Float64Array(values.length);
      for (const i of row.variables) {
        const h = 1e-5 * Math.max(1, Math.abs(values[i]));
        const old = values[i];
        values[i] = old + h;
        gradient[i] = (valueOf(row, values) - r[j]) / h;
        values[i] = old;
      }
      return gradient;
    });
  const maxIterations = Math.min(
    options.maxIterations ?? SOLVER_LIMITS.iterations,
    SOLVER_LIMITS.iterations,
  );
  const maxTime = Math.min(
    options.maxElapsedMs ?? SOLVER_LIMITS.elapsedMs,
    SOLVER_LIMITS.elapsedMs,
  );
  if (errors.length === 0) {
    for (; iterations <= maxIterations; iterations++) {
      if (performance.now() - started > maxTime) {
        limited = true;
        break;
      }
      const r = residual(x);
      if (
        r.every((v) => Number.isFinite(v) && Math.abs(v) <= SOLVE_TOLERANCE)
      ) {
        converged = true;
        break;
      }
      if (iterations === maxIterations || x.length > SOLVER_LIMITS.variables) {
        limited = true;
        break;
      }
      const j = jacobian(x, r),
        n = x.length;
      const a = Array.from({ length: n }, () => new Float64Array(n + 1));
      for (let row = 0; row < j.length; row++)
        for (const u of rows[row].variables) {
          a[u][n] -= j[row][u] * r[row];
          for (const v of rows[row].variables) a[u][v] += j[row][u] * j[row][v];
        }
      for (let i = 0; i < n; i++) a[i][i] += 1e-8;
      const step = linearSolve(a);
      const score = r.reduce((s, v) => s + v * v, 0);
      let accepted = false;
      for (let scale = 1; scale >= 1 / 1024; scale /= 2) {
        const candidate = x.map((v, i) => v + scale * step[i]);
        const next = residual(candidate);
        if (
          next.every(Number.isFinite) &&
          next.reduce((s, v) => s + v * v, 0) < score
        ) {
          x.splice(0, x.length, ...candidate);
          accepted = true;
          break;
        }
      }
      if (!accepted) break;
    }
  }
  const remaining = residual(x);
  // Unsigned dimensions have mirrored solutions. Refuse a branch change instead
  // of allowing an edit to silently reverse the user's geometry.
  if (converged && errors.length === 0)
    for (const d of sketch.dimensions) {
      let before = 0,
        after = 0;
      if (d.type === "horizontalDistance" || d.type === "verticalDistance") {
        const ids = d.pointIds ?? [];
        if (ids.length === 2 && ids.every((id) => pointVars.has(id))) {
          const axis = d.type === "horizontalDistance" ? "x" : "y";
          before =
            point(ids[1], branchSeed)[axis] - point(ids[0], branchSeed)[axis];
          after = point(ids[1], x)[axis] - point(ids[0], x)[axis];
        }
      } else if (d.type === "angle" && d.entityIds.length === 2) {
        const cross = (v: number[]) => {
          const a = line(d.entityIds[0], v),
            b = line(d.entityIds[1], v),
            u = delta(a.a, a.b),
            w = delta(b.a, b.b);
          return u.x * w.y - u.y * w.x;
        };
        before = cross(branchSeed);
        after = cross(x);
      }
      if (Math.abs(before) > MIN_ENTITY_SIZE && before * after < 0)
        addError(
          d.id,
          "Solve would mirror the dimension's seeded geometry. Reset the solve or edit the point coordinates to choose the intended branch.",
        );
    }
  if (!converged && errors.length === 0) {
    remaining.forEach((r, i) => {
      if (Math.abs(r) > SOLVE_TOLERANCE || !Number.isFinite(r))
        addError(rows[i].id, rows[i].message);
    });
    if (limited)
      addError(
        sketch.id,
        "Sketch did not converge within the iteration/time budget. Simplify constraints or reset the solve.",
      );
  }
  const points: Record<string, ResolvedPoint> = {};
  for (const [id, indexes] of pointVars)
    points[id] = {
      id,
      x: x[indexes[0]],
      y: x[indexes[1]],
      construction: sketch.entities[id].construction,
    };
  const lines: ResolvedLine[] = [],
    circles: ResolvedCircle[] = [],
    arcs: ResolvedArc[] = [];
  for (const e of entities) {
    if (e.type === "line") {
      const start = points[e.startPointId],
        end = points[e.endPointId];
      if (!start || !end)
        addError(e.id, "Line references unresolved points.", true);
      else if (distance(start, end) < MIN_ENTITY_SIZE)
        addError(
          e.id,
          "Line is degenerate: endpoints are coincident or below minimum size.",
          true,
        );
      else lines.push({ id: e.id, start, end, construction: e.construction });
    }
    if (e.type === "circle" || e.type === "arc") {
      const center = points[e.centerPointId];
      if (!center) {
        addError(e.id, "Circle/arc references unresolved center point.", true);
        continue;
      }
      if (e.type === "circle") {
        const radius = x[radiusVars.get(e.id)!];
        if (radius < MIN_ENTITY_SIZE)
          addError(
            e.id,
            "Circle radius must be a positive length greater than zero.",
            true,
          );
        else
          circles.push({
            id: e.id,
            center,
            radius,
            construction: e.construction,
          });
      } else {
        const start = points[e.startPointId],
          end = points[e.endPointId];
        if (!start || !end) {
          addError(e.id, "Arc references unresolved endpoints.", true);
          continue;
        }
        const radius = distance(center, start),
          startAngle = Math.atan2(start.y - center.y, start.x - center.x),
          endAngle = Math.atan2(end.y - center.y, end.x - center.x);
        let sweep =
          (((endAngle - startAngle) % (2 * Math.PI)) + 2 * Math.PI) %
          (2 * Math.PI);
        if (e.clockwise && sweep > 0) sweep -= 2 * Math.PI;
        if (
          radius < MIN_ENTITY_SIZE ||
          Math.abs(sweep) < ANGULAR_TOLERANCE ||
          distance(start, end) < MIN_ENTITY_SIZE
        )
          addError(
            e.id,
            "Arc is degenerate: radius and sweep must be greater than zero.",
            true,
          );
        else
          arcs.push({
            id: e.id,
            center,
            start,
            end,
            radius,
            startAngle,
            sweep,
            construction: e.construction,
          });
      }
    }
  }
  if (converged)
    for (const constraint of sketch.constraints.filter(
      (c) => c.type === "tangent",
    )) {
      try {
        const ids = constraint.entityIds;
        if (ids.length !== 2) continue;
        const lineId = ids.find((id) => entity(id).type === "line");
        const contacts = new Map<string, { x: number; y: number }>();
        if (lineId) {
          const id = ids.find((id) => id !== lineId)!,
            r = round(id, x),
            l = line(lineId, x),
            d = delta(l.a, l.b),
            norm = d.x * d.x + d.y * d.y;
          const t = ((r.c.x - l.a.x) * d.x + (r.c.y - l.a.y) * d.y) / norm;
          if (t < -SOLVE_TOLERANCE || t > 1 + SOLVE_TOLERANCE)
            throw new Error(
              "Tangent contact falls outside the finite line segment.",
            );
          const contact = { x: l.a.x + t * d.x, y: l.a.y + t * d.y };
          if (Math.abs(distance(contact, r.c) - r.r) > SOLVE_TOLERANCE)
            throw new Error(
              "Line meets the circle endpoint without a tangent contact.",
            );
          contacts.set(id, contact);
        } else {
          const a = round(ids[0], x),
            b = round(ids[1], x),
            d = distance(a.c, b.c);
          if (d < MIN_ENTITY_SIZE)
            throw new Error("Tangent circles/arcs have coincident centers.");
          const internal =
              Math.abs(d - Math.abs(a.r - b.r)) < Math.abs(d - a.r - b.r),
            sign = internal && a.r < b.r ? -1 : 1;
          const contact = {
            x: a.c.x + (sign * a.r * (b.c.x - a.c.x)) / d,
            y: a.c.y + (sign * a.r * (b.c.y - a.c.y)) / d,
          };
          contacts.set(ids[0], contact);
          contacts.set(ids[1], contact);
        }
        for (const [id, contact] of contacts) {
          const arc = arcs.find((a) => a.id === id);
          if (!arc) continue;
          const angle = Math.atan2(
            contact.y - arc.center.y,
            contact.x - arc.center.x,
          );
          const progress =
            (((arc.sweep > 0
              ? angle - arc.startAngle
              : arc.startAngle - angle) %
              (2 * Math.PI)) +
              2 * Math.PI) %
            (2 * Math.PI);
          if (
            progress > Math.abs(arc.sweep) + ANGULAR_TOLERANCE &&
            2 * Math.PI - progress > ANGULAR_TOLERANCE
          )
            throw new Error(
              "Tangent contact falls outside the arc sweep. Edit the arc endpoints or constraint references.",
            );
        }
      } catch (error) {
        addError(
          constraint.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  // Rank of the final constraint Jacobian is the documented local DOF heuristic, not a global uniqueness proof.
  const redundantConstraintIds: string[] = [];
  let rank = 0;
  if (converged && x.length <= SOLVER_LIMITS.variables) {
    const basis: Float64Array[] = [];
    const fixedIndexes = new Set(
      sketch.constraints
        .filter((c) => c.type === "fixed")
        .flatMap((c) => {
          try {
            return indexesFor(c.entityIds, c.pointIds ?? []);
          } catch {
            return [];
          }
        }),
    );
    const j = jacobian(x, remaining);
    for (let i = 0; i < j.length; i++) {
      if (performance.now() - started > maxTime) {
        limited = true;
        addError(
          sketch.id,
          "Sketch rank analysis exceeded the solve time budget. Simplify constraints or reset the solve.",
        );
        break;
      }
      if (
        sketch.entities[rows[i].id]?.type === "arc" &&
        rows[i].variables.every((index) => fixedIndexes.has(index))
      )
        continue;
      const v = j[i];
      const original = Math.hypot(...v);
      for (const b of basis) {
        const dot = v.reduce((s, value, k) => s + value * b[k], 0);
        for (let k = 0; k < v.length; k++) v[k] -= dot * b[k];
      }
      const norm = Math.hypot(...v);
      if (norm <= 1e-6 * Math.max(1, original)) {
        // Shared arc endpoints may imply the same intrinsic equal-radius row.
        // Only duplicate user-authored constraints/dimensions are overconstraints.
        if (sketch.entities[rows[i].id]?.type !== "arc")
          redundantConstraintIds.push(rows[i].id);
        continue;
      }
      for (let k = 0; k < v.length; k++) v[k] /= norm;
      basis.push(v);
      rank++;
    }
    for (const id of new Set(redundantConstraintIds))
      addError(
        id,
        "Overconstrained sketch: redundant constraint or dimension. Remove the duplicate design intent.",
      );
  }
  const dof = Math.max(0, x.length - rank);
  return {
    id: sketch.id,
    points,
    lines,
    circles,
    arcs,
    errors,
    status: limited
      ? "nonConverged"
      : errors.length
        ? redundantConstraintIds.length
          ? "overconstrained"
          : "conflicting"
        : dof
          ? "underconstrained"
          : "fullyConstrained",
    degreesOfFreedom: dof,
    redundantConstraintIds: [...new Set(redundantConstraintIds)],
    iterations,
    seedUsed,
    authoredGeometry,
  };
}
function delta(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: b.x - a.x, y: b.y - a.y };
}
function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const d = delta(a, b),
    norm = d.x * d.x + d.y * d.y;
  if (norm < MIN_ENTITY_SIZE ** 2) return distance(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / norm),
  );
  return distance(p, { x: a.x + t * d.x, y: a.y + t * d.y });
}
function linearSolve(a: Float64Array[]): number[] {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const divisor = a[i][i];
    if (Math.abs(divisor) < 1e-18) continue;
    for (let k = i + 1; k < n; k++) {
      const factor = a[k][i] / divisor;
      for (let j = i; j <= n; j++) a[k][j] -= factor * a[i][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let v = a[i][n];
    for (let j = i + 1; j < n; j++) v -= a[i][j] * x[j];
    x[i] = Math.abs(a[i][i]) < 1e-18 ? 0 : v / a[i][i];
  }
  return x;
}
