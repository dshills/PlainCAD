import { expect, it } from "vitest";
import { aiSketchContext, buildAiSketchEdit, validateAiSketchProposal } from "../ai/sketchEditPlan";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, addLine, addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { serializeProject } from "../persistence/exportProject";

function fixture() {
  const sketch = addCornerRectangle(createXySketch("Editable"), "24mm", "16mm");
  return { sketch, document: upsertSketch(createEmptyDocument(), sketch) };
}
it("turns provider resize actions into solved geometry, keeping identifiers and durable round trips", () => {
  const { sketch, document } = fixture();
  const plan = buildAiSketchEdit(document, sketch.id, [], { summary: "Resize", warnings: [], actions: [{ kind: "rectangle", width: "3cm", height: "20mm" }] }, "preserve");
  const bounds = detectProfiles(solveSketch(plan.document.sketches[sketch.id], {})).profiles[0].bounds;
  expect(bounds.maxX - bounds.minX).toBeCloseTo(30, 5);
  expect(bounds.maxY - bounds.minY).toBeCloseTo(20, 5);
  expect(Object.keys(plan.document.sketches[sketch.id].entities)).toEqual(Object.keys(sketch.entities));
  expect(plan.base).toBe(document);
  expect(sketch.dimensions).toHaveLength(0);
  expect(JSON.parse(serializeProject(plan.document)).sketches[sketch.id]).toEqual(plan.document.sketches[sketch.id]);
});
it("uses the same relation planner and restricts actions to selected geometry", () => {
  const a = addPoint(createXySketch(), "0mm", "0mm"), b = addPoint(a.sketch, "20mm", "5mm");
  const line = addLine(b.sketch, a.pointId, b.pointId), document = upsertSketch(createEmptyDocument(), line.sketch);
  const proposal = { summary: "Level line", warnings: [], actions: [{ kind: "constraint" as const, type: "horizontal" as const, ids: [line.lineId] }] };
  const plan = buildAiSketchEdit(document, line.sketch.id, [line.lineId], proposal, "preserve");
  const solved = solveSketch(plan.document.sketches[line.sketch.id], {});
  expect(solved.lines[0].start.y).toBeCloseTo(solved.lines[0].end.y, 6);
  expect(() => buildAiSketchEdit(document, line.sketch.id, [a.pointId], proposal, "preserve")).toThrow(/outside/);
});
it("requires an explicit bound-expression replacement or shared-parameter choice and preserves other bindings", () => {
  const { sketch, document } = fixture(), lineId = Object.values(sketch.entities).find((entity) => entity.type === "line")!.id;
  const bounded = withCanvasDimension(sketch, { type: "length", refs: [lineId], expression: "width" });
  const parameter = { id: "width_parameter", name: "width", expression: "24mm", unit: "mm" as const, value: 24 };
  const base = upsertSketch({ ...document, parameters: { width: parameter } }, bounded);
  const proposal = { summary: "Wider", warnings: [], actions: [{ kind: "dimension" as const, id: bounded.dimensions[0].id, expression: "30mm" }] };
  expect(() => buildAiSketchEdit(base, sketch.id, [], proposal, "preserve")).toThrow(/parameter-bound/);
  const replaced = buildAiSketchEdit(base, sketch.id, [], proposal, "replace");
  expect(replaced.document.parameters.width.expression).toBe("24mm");
  expect(replaced.document.sketches[sketch.id].dimensions[0].expression.expression).toBe("30mm");
  const shared = { ...proposal, actions: [{ kind: "parameter" as const, id: parameter.id, expression: "36mm" }] };
  expect(() => buildAiSketchEdit(base, sketch.id, [], shared, "preserve")).toThrow(/explicitly/);
  const changed = buildAiSketchEdit(base, sketch.id, [], shared, "parameter:width_parameter");
  expect(changed.document.sketches[sketch.id].dimensions[0].expression.expression).toBe("width");
  const solved = solveSketch(changed.document.sketches[sketch.id], evaluateParameters(changed.document.parameters).values);
  const edge = solved.lines.find((edge) => edge.id === lineId)!;
  expect(Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y)).toBeCloseTo(36, 5);
  expect(changed.changes.some((change) => change.includes("sketch:"))).toBe(true);
  expect(() => buildAiSketchEdit({ ...base, parameters: { width: { ...parameter, locked: true } } }, sketch.id, [], shared, "parameter:width_parameter")).toThrow(/editable/);
});
it("sends bounded sketch context without features, meshes or unrelated parameters and refuses hostile/unsupported actions", () => {
  const { sketch, document } = fixture();
  const context = aiSketchContext({ ...document, parameters: { private: { id: "private_parameter", name: "private", expression: "17mm", value: 17, unit: "mm" } } }, sketch.id, [], "preserve");
  expect(context.parameters).toEqual([]);
  expect(Object.keys(context)).not.toContain("features");
  expect(Object.keys(context)).not.toContain("meshes");
  expect(() => validateAiSketchProposal({ summary: "Code", warnings: [], actions: [{ kind: "script", code: "alert(1)" }] })).toThrow(/unsupported/);
  expect(() => validateAiSketchProposal({ summary: "Extra", warnings: [], actions: [], document })).toThrow(/format/);
  expect(() => validateAiSketchProposal({ summary: "NaN", warnings: [], actions: [{ kind: "trim", id: "a", x: NaN, y: 0 }] })).toThrow(/finite/);
  expect(() => buildAiSketchEdit(document, sketch.id, [], { summary: "Which edge?", warnings: [], actions: [] }, "preserve")).toThrow("Which edge?");
  expect(() => buildAiSketchEdit(document, sketch.id, [], { summary: "Unlisted", warnings: [], actions: [{ kind: "dimension", id: "missing", expression: "10mm" }] }, "preserve")).toThrow(/outside/);
});
