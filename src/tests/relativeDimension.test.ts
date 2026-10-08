import { expect, it } from "vitest";
import { parseRelativeDimension, relativeDimensionValue } from "../ai/relativeDimension";
import { resolveAiIntent } from "../ai/contextualIntent";
import { buildAiPlan } from "../ai/buildPlan";
import { aiEditContext, buildAiParameterEdit } from "../ai/editPlan";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { aiPlatePlan } from "./fixtures/aiPlan";
import type { AiEditContext } from "../ai/plan";
const thickness = { id: "thickness", name: "ai_1_thickness", expression: "5mm", value: 5, unit: "mm" as const };
const width = { id: "width", name: "ai_1_width", expression: "20mm", value: 20, unit: "mm" as const };
const angle = { id: "angle", name: "angle", expression: "45deg", value: 45, unit: "deg" as const };
const context: AiEditContext = { componentName: "Part", parameters: [thickness, width, angle] };
it.each([
  ["halve thickness", 2.5], ["double the thickness", 10],
  ["make it half as thick", 2.5], ["Please make this twice as thick.", 10],
  ["Can you halve ai_1_thickness please", 2.5], ["Can you halve thickness?", 2.5],
  ["increase thickness by 2mm", 7], ["decrease thickness by 1 mm", 4],
  ["increase thickness by 50%", 7.5], ["decrease thickness by 25 %", 3.75],
] as const)("resolves '%s' from the current value without a provider plan", (prompt, value) => {
  const intent = resolveAiIntent("edit", prompt, context);
  expect(intent.target).toBe(thickness.name);
  expect(intent.clarification).toBeUndefined();
  expect(intent.localPlan?.parameters).toEqual([{ name: thickness.name, value, unit: "mm" }]);
  expect(intent.localPlan?.steps).toEqual([]);
});
it("uses length and angle units explicitly and percentages relative to the chosen parameter", () => {
  expect(resolveAiIntent("edit", "increase width by 2mm", context).localPlan?.parameters[0].value).toBe(22);
  expect(resolveAiIntent("edit", "decrease angle by 15deg", context).localPlan?.parameters[0]).toEqual({ name: "angle", value: 30, unit: "deg" });
  expect(resolveAiIntent("edit", "increase angle by 20%", context).localPlan?.parameters[0].value).toBe(54);
  expect(resolveAiIntent("edit", "increase angle by 2mm", context).clarification).toContain("deg or %");
  expect(resolveAiIntent("edit", "increase thickness by 2deg", context).clarification).toContain("mm or %");
});
it.each([
  ["halve it", 10], ["halve this", 10], ["halve that", 10],
  ["double it", 40], ["double this", 40], ["Please double that!", 40],
] as const)("resolves '%s' only to an explicitly chosen allowed dimension", (prompt, value) => {
  const intent = resolveAiIntent("edit", prompt, context, width.name);
  expect(intent.target).toBe(width.name);
  expect(intent.clarification).toBeUndefined();
  expect(intent.localPlan?.parameters).toEqual([{ name: width.name, value, unit: "mm" }]);
  expect(intent.context?.parameters).toEqual([width]);
});
it.each(["halve it", "halve this", "halve that", "double it", "double this", "double that"])("clarifies '%s' without an allowed explicit choice", (prompt) => {
  for (const target of [undefined, "missing"]) {
    const intent = resolveAiIntent("edit", prompt, context, target);
    expect(intent.clarification).toContain("Which dimension");
    expect(intent.localPlan).toBeUndefined();
    expect(intent.target).toBeUndefined();
  }
  // Even a single editable parameter or a parameter named 'it' is not an explicit choice.
  const single = { ...context, parameters: [{ ...width, name: "it" }] };
  expect(resolveAiIntent("edit", prompt, single).localPlan).toBeUndefined();
  expect(resolveAiIntent("create", prompt).clarification).toContain("This part");
});
it("does not broaden chosen-reference edits to negation, conditions or compounds", () => {
  for (const prompt of ["do not halve it", "halve this if it fits", "double that and increase width by 1mm", "halve it to 4mm"])
    expect(resolveAiIntent("edit", prompt, context, width.name).localPlan).toBeUndefined();
});
it.each([
  ["increase it by 2mm", 22], ["increase this by 10%", 22],
  ["decrease that by 10%", 18], ["decrease it by 2mm", 18],
] as const)("applies '%s' only to an allowed chosen dimension", (prompt, value) => {
  const intent = resolveAiIntent("edit", prompt, context, width.name);
  expect(intent.clarification).toBeUndefined();
  expect(intent.target).toBe(width.name);
  expect(intent.context?.parameters).toEqual([width]);
  expect(intent.localPlan?.parameters).toEqual([{ name: width.name, value, unit: "mm" }]);
  for (const target of [undefined, "missing"]) {
    const unchosen = resolveAiIntent("edit", prompt, context, target);
    expect(unchosen.clarification).toContain("Which dimension");
    expect(unchosen.localPlan).toBeUndefined();
    expect(unchosen.target).toBeUndefined();
  }
});
it("enforces units and bounded values for chosen offset references", () => {
  expect(resolveAiIntent("edit", "decrease this by 15deg", context, angle.name).localPlan?.parameters)
    .toEqual([{ name: angle.name, value: 30, unit: "deg" }]);
  expect(resolveAiIntent("edit", "increase it by 2mm", context, angle.name).clarification).toContain("deg or %");
  expect(resolveAiIntent("edit", "decrease that by 2deg", context, width.name).clarification).toContain("mm or %");
  for (const prompt of ["decrease it by 100%", "decrease this by 21mm", "increase that by -2mm", "increase it by 0mm", "increase it by 100001mm"]) {
    const intent = resolveAiIntent("edit", prompt, context, width.name);
    expect(intent.clarification).toBeTruthy();
    expect(intent.localPlan).toBeUndefined();
  }
  const single = { ...context, parameters: [{ ...width, name: "it" }] };
  expect(resolveAiIntent("edit", "increase it by 2mm", single).clarification).toContain("Which dimension");
  expect(resolveAiIntent("create", "increase that by 10%").clarification).toContain("This part");
  for (const prompt of ["do not increase it by 2mm", "increase this by 2mm if it fits", "decrease that by 10% and halve width"])
    expect(resolveAiIntent("edit", prompt, context, width.name).localPlan).toBeUndefined();
});
it.each([
  "do not halve thickness", "halve thickness if it fits", "halve thickness and double width",
  "double thickness or width", "first halve thickness then increase width by 1mm",
  "increase thickness by 2mm unless too large", "perhaps halve thickness", "halve thickness to 4mm",
  "make it half as thick, not double", "increase width by 2mm and angle by 2deg",
])("does not auto-interpret negated, conditional or compound text: %s", (prompt) => {
  expect(parseRelativeDimension(prompt)).toBeUndefined();
  expect(resolveAiIntent("edit", prompt, context).localPlan).toBeUndefined();
});
it.each(["decrease thickness by 5mm", "decrease thickness by 120%", "increase thickness by -2mm", "increase thickness by 0mm", "increase thickness by 100001mm"])("diagnoses invalid or unchanged dimensions: %s", (prompt) => {
  const intent = resolveAiIntent("edit", prompt, context);
  expect(intent.clarification).toBeTruthy();
  expect(intent.localPlan).toBeUndefined();
});
it("requires an edit scope, clarifies missing or ambiguous target aliases, and never redirects an explicit name", () => {
  expect(resolveAiIntent("create", "halve thickness").clarification).toContain("This part");
  expect(resolveAiIntent("edit", "increase unknown by 2mm", context).choices).toEqual(context.parameters);
  const ambiguous = { ...context, parameters: [...context.parameters, { ...thickness, id: "second", name: "ai_2_thickness" }] };
  expect(resolveAiIntent("edit", "halve thickness", ambiguous).clarification).toBeTruthy();
  expect(resolveAiIntent("edit", "halve thickness", ambiguous, "ai_2_thickness").localPlan?.parameters[0].name).toBe("ai_2_thickness");
  expect(resolveAiIntent("edit", "halve thickness", ambiguous, width.name).clarification).toContain("names thickness");
  expect(resolveAiIntent("edit", "double unknown", context, thickness.name).clarification).toContain("unavailable");
  expect(resolveAiIntent("edit", "halve thickness", { ...context, parameters: [width] }, width.name).clarification).toContain("matching editable length");
  expect(resolveAiIntent("edit", "double width", context, thickness.name).clarification).toContain("names width");
  expect(resolveAiIntent("edit", "make it half as thick", { componentName: "Turn", parameters: [angle] }, "angle").clarification).toContain("length");
});
it("halves a selected extrusion's resolved distance and retains absolute assignment semantics", () => {
  const feature: AiEditContext = { componentName: "Part", feature: { name: "Extrusion", type: "extrude" }, parameters: [{ ...thickness, name: "distance" }] };
  expect(resolveAiIntent("feature", "halve thickness", feature).localPlan?.parameters).toEqual([{ name: "distance", value: 2.5, unit: "mm" }]);
  expect(resolveAiIntent("feature", "make this thicker by 2mm", feature).localPlan).toBeUndefined();
  expect(resolveAiIntent("feature", "make this thicker to 3mm", feature).clarification).toContain("opposite direction");
  expect(resolveAiIntent("feature", "set distance to 3mm", feature).localPlan?.parameters[0].value).toBe(3);
});
it("uses evaluated unit-converted values rather than stale stored values and produces stable editable document IDs", () => {
  const generated = buildAiPlan(createEmptyDocument(), aiPlatePlan);
  const name = Object.keys(generated.document.parameters).find((key) => key.endsWith("_thickness"));
  if (!name) throw new Error("The generated plan must define a thickness parameter.");
  const document = { ...generated.document, parameters: { ...generated.document.parameters, [name]: { ...generated.document.parameters[name], expression: "0.5cm", value: 999, unit: "cm" } } };
  const actual = aiEditContext(document, generated.componentId);
  const intent = resolveAiIntent("edit", "halve thickness", actual);
  const plan = intent.localPlan;
  expect(plan).toBeDefined();
  if (!plan) throw new Error("The local relative edit must produce a plan.");
  expect(plan.parameters).toEqual([{ name, value: 2.5, unit: "mm" }]);
  const edit = buildAiParameterEdit(document, generated.componentId, plan);
  expect(edit.document.parameters[name].expression).toBe("2.5mm");
  expect(edit.document.id).toBe(document.id);
  expect(edit.document.parameters[name].id).toBe(document.parameters[name].id);
  expect(edit.document.features.map((feature) => feature.id)).toEqual(document.features.map((feature) => feature.id));
  expect(edit.bodyIds).toEqual(generated.bodyIds);
});
it("rejects non-finite current values and overflow, including percent calculations", () => {
  const scale = parseRelativeDimension("double thickness");
  expect(scale).toBeDefined();
  if (!scale) throw new Error("The scale directive must parse.");
  expect(() => relativeDimensionValue(scale, { ...thickness, value: NaN })).toThrow("current value");
  expect(() => relativeDimensionValue(scale, { ...thickness, value: 60000 })).toThrow("100000");
  const overflow = parseRelativeDimension(`increase thickness by ${"9".repeat(400)}%`);
  expect(overflow).toMatchObject({ kind: "offset", amount: Infinity });
  if (!overflow) throw new Error("The overflow directive must parse before value validation.");
  expect(() => relativeDimensionValue(overflow, thickness)).toThrow("finite amount");
});

it("keeps explicit absolute assignment valid when a dimension is named double", () => {
  const named = { ...context, parameters: [{ ...width, name: "double" }] };
  for (const prompt of ["set double to 3mm", "change double to 3mm", "resize the double to 3mm"])
    expect(resolveAiIntent("edit", prompt, named).localPlan?.parameters[0].value).toBe(3);
});
