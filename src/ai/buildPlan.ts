import { addComponent } from "../cad/document/components";
import {
  upsertFeature,
  upsertParameter,
  upsertSketch,
} from "../cad/document/CadDocument";
import { createId } from "../cad/document/ids";
import type { CadDocument, Feature, Sketch } from "../cad/document/schema";
import { validateDocument } from "../cad/document/validate";
import { stableBodyIdForFeature } from "../cad/features/featureGraph";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { bindDocumentExpressions } from "../cad/parameters/expressionBindings";
import {
  collectExpressionDependencies,
  evaluateExpression,
  evaluateParameters,
  tokenize,
} from "../cad/parameters/expressionEvaluator";
import {
  addCircleAt,
  addLine,
  addPoint,
  createSketchOnPlane,
} from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { assertProjectJsonShape } from "../persistence/importSafety";
import { validateAiPlan } from "./plan";

export function buildAiPlan(base: CadDocument, input: unknown) {
  const plan = validateAiPlan(input);
  if (!plan.steps.length) throw new Error(plan.summary);
  const added = addComponent(base, plan.name);
  let document = added.document;
  // Namespaces avoid overwriting existing project parameters when adding another part.
  let prefix = "ai_1_",
    index = 1;
  while (Object.keys(base.parameters).some((name) => name.startsWith(prefix)))
    prefix = `ai_${++index}_`;
  const names = new Map(plan.parameters.map((p) => [p.name, prefix + p.name]));
  for (const parameter of plan.parameters) {
    const name = names.get(parameter.name)!;
    document = upsertParameter(document, {
      id: createId("parameter"),
      name,
      expression: `${parameter.value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 })}${parameter.unit}`,
      unit: parameter.unit,
      value: parameter.value,
      group: plan.name,
    });
  }
  const evaluation = evaluateParameters(document.parameters);
  // Apply must leave the entire project natively rebuildable. A broken existing
  // parameter also fails the full native preview; identify that blocker explicitly.
  if (evaluation.errors.length)
    throw new Error(
      "Repair project parameters before generating native AI geometry: " +
        evaluation.errors
          .map((error) => `${error.parameterName}: ${error.message}`)
          .join(" "),
    );
  const expr = (
    source: string,
    dimension: "length" | "angle",
    positive = false,
  ) => {
    for (const name of collectExpressionDependencies(source))
      if (!names.has(name))
        throw new Error(`AI expression uses unknown parameter ${name}.`);
    let result = "",
      cursor = 0;
    const tokens = tokenize(source);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (
        token.type !== "identifier" ||
        tokens[i - 1]?.type === "number" ||
        tokens[i + 1]?.value === "(" ||
        !names.has(token.value)
      )
        continue;
      result += source.slice(cursor, token.start) + names.get(token.value);
      cursor = token.end;
    }
    result += source.slice(cursor);
    const measured = evaluateExpression(result, {
      parameters: evaluation.values,
    });
    if (
      measured.error ||
      measured.quantity?.dimension !== dimension ||
      !Number.isFinite(measured.quantity.value) ||
      Math.abs(measured.quantity.value) > 100000 ||
      (positive && !(measured.quantity.value > 0))
    )
      throw new Error(
        `AI expression "${source}" must be a ${positive ? "positive " : ""}${dimension} within modeling limits. ${measured.error ?? "Use explicit units."}`,
      );
    if (dimension === "angle" && measured.quantity.value > 2 * Math.PI + 1e-12)
      throw new Error(
        "AI revolve angle must be greater than 0 and at most 360deg.",
      );
    return { expression: result, unit: dimension === "length" ? "mm" : "deg" };
  };
  const sketches = new Map<string, { sketch: Sketch; profileId: string }>();
  const features = new Map<string, Feature>();
  const liveBodies = new Set<string>();
  const featureIds: string[] = [];
  for (const step of plan.steps) {
    if (step.type === "sketch") {
      const p = step.profile;
      const x = expr(p.x, "length").expression,
        y = expr(p.y, "length").expression;
      let sketch = createSketchOnPlane(step.name, {
        type: "offset",
        base: step.plane,
        offset: expr(step.offset, "length"),
      });
      sketch = { ...sketch, componentId: added.component.id };
      if (p.type === "circle")
        sketch = addCircleAt(
          sketch,
          x,
          y,
          expr(p.radius, "length", true).expression,
        );
      else {
        const width = expr(p.width, "length", true).expression,
          height = expr(p.height, "length", true).expression;
        const ids: string[] = [];
        for (const [cx, cy] of [
          [`(${x}) - (${width}) / 2`, `(${y}) - (${height}) / 2`],
          [`(${x}) + (${width}) / 2`, `(${y}) - (${height}) / 2`],
          [`(${x}) + (${width}) / 2`, `(${y}) + (${height}) / 2`],
          [`(${x}) - (${width}) / 2`, `(${y}) + (${height}) / 2`],
        ]) {
          const point = addPoint(sketch, cx, cy);
          sketch = point.sketch;
          ids.push(point.pointId);
        }
        for (let i = 0; i < 4; i++)
          sketch = addLine(sketch, ids[i], ids[(i + 1) % 4]).sketch;
      }
      const profiles = detectProfiles(solveSketch(sketch, evaluation.values));
      if (profiles.errors.length || profiles.profiles.length !== 1)
        throw new Error(
          `AI sketch ${step.name}: ${profiles.errors.join(" ") || "Exactly one closed profile is required."}`,
        );
      document = upsertSketch(document, sketch);
      sketches.set(step.id, { sketch, profileId: profiles.profiles[0].id });
      continue;
    }
    const common = {
      id: createId("feature"),
      name: step.name,
      componentId: added.component.id,
    };
    let feature: Feature;
    if (step.type === "fillet" || step.type === "chamfer") {
      const owner = features.get(step.owner);
      if (
        owner?.type !== "extrude" ||
        owner.operation !== "newBody" ||
        owner.termination?.type !== "distance" ||
        !liveBodies.has(step.owner)
      )
        throw new Error(
          `AI ${step.name} requires an earlier live distance-extrusion owner.`,
        );
      const refs = [createExtrudeEdgeRef(owner.id, step.role)],
        size = expr(step.size, "length", true);
      // Native reference resolution checks retained edges after booleans and
      // rejects trimmed/changed caps. Document metadata cannot prove retention.
      feature =
        step.type === "fillet"
          ? { ...common, type: step.type, targetEdgeRefs: refs, radius: size }
          : {
              ...common,
              type: step.type,
              targetEdgeRefs: refs,
              distance: size,
            };
    } else if (step.type === "extrude" || step.type === "revolve") {
      const source = sketches.get(step.sketch);
      if (!source)
        throw new Error(`AI ${step.name} requires an earlier sketch.`);
      const targets = step.targets.map((id) => {
        const owner = features.get(id);
        if (!owner || !liveBodies.has(id))
          throw new Error(
            `AI ${step.name} targets a missing or consumed body ${id}.`,
          );
        return stableBodyIdForFeature(owner.id);
      });
      const scope = {
        ...common,
        sketchId: source.sketch.id,
        profileId: source.profileId,
        operation: step.operation,
        targetBodyIds: targets.length ? targets : undefined,
      };
      feature =
        step.type === "extrude"
          ? {
              ...scope,
              type: step.type,
              direction: step.direction,
              // Through All ignores length geometrically, but the placeholder
              // is required by the recipe schema (normally 1mm) and remains valid
              // durable data rather than accepting unchecked text.
              distance: expr(step.distance, "length", true),
              termination: { type: step.termination },
            }
          : {
              ...scope,
              type: step.type,
              axis: { type: "origin", axis: step.axis },
              angle: expr(step.angle, "angle", true),
            };
      if (step.operation === "newBody") liveBodies.add(step.id);
      else if (step.operation === "join")
        step.targets.slice(1).forEach((id) => liveBodies.delete(id));
    } else throw new Error("Unsupported AI modeling step.");
    document = upsertFeature(document, feature);
    features.set(step.id, feature);
    featureIds.push(feature.id);
  }
  if (!featureIds.length || !liveBodies.size)
    throw new Error(
      "AI proposal must contain at least one solid modeling operation.",
    );
  document = bindDocumentExpressions(document, base);
  assertProjectJsonShape(document);
  const issues = validateDocument(document);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join(" "));
  return {
    document,
    componentId: added.component.id,
    featureIds,
    bodyIds: [...liveBodies].map((id) =>
      stableBodyIdForFeature(features.get(id)!.id),
    ),
  };
}
