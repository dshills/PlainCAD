import { expect, it, afterEach } from "vitest";
import {
  createEmptyDocument,
  upsertParameter,
} from "../cad/document/CadDocument";
import { buildAiPlan } from "../ai/buildPlan";
import { aiEditContext, buildAiParameterEdit } from "../ai/editPlan";
import { reviseAiParameters } from "../ai/revisePlan";
import { validateAiPlan } from "../ai/plan";
import { aiPlatePlan } from "./fixtures/aiPlan";
import {
  aiPolygonPlan,
  aiArcPlan,
  aiHolePatternPlan,
} from "./fixtures/aiExpandedPlans";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { serializeProject } from "../persistence/exportProject";
import { parseProjectJson } from "../persistence/importSafety";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { useCadStore } from "../state/useCadStore";
import { applyAiPlan, assertAiGeometry } from "../ui/commands/aiCommand";

afterEach(() => useCadStore.setState(useCadStore.getInitialState(), true));
it("compiles closed polygon/arc wires and indexed native Hole patterns into durable editable entities", () => {
  for (const plan of [aiPolygonPlan, aiArcPlan, aiHolePatternPlan]) {
    const staged = buildAiPlan(createEmptyDocument(), plan);
    expect(parseProjectJson(serializeProject(staged.document))).toMatchObject({
      features: JSON.parse(JSON.stringify(staged.document.features)),
    });
    expect(staged.bodyIds).toHaveLength(1);
  }
  const arc = buildAiPlan(createEmptyDocument(), aiArcPlan);
  expect(
    Object.values(Object.values(arc.document.sketches)[0].entities).filter(
      (e) => e.type === "arc",
    ),
  ).toHaveLength(1);
  const holes = buildAiPlan(createEmptyDocument(), aiHolePatternPlan);
  expect(holes.document.features[1]).toMatchObject({
    type: "hole",
    centerPointIds: expect.any(Array),
    targetBodyIds: holes.bodyIds,
    depth: "throughAll",
  });
  const hole = holes.document.features[1];
  if (hole.type !== "hole") throw new Error("Expected native Hole feature");
  expect(hole.centerPointIds).toHaveLength(4);
  const missing = structuredClone(aiHolePatternPlan);
  if (missing.steps[3].type === "hole") missing.steps[3].centers = [9];
  expect(() => buildAiPlan(createEmptyDocument(), missing)).toThrow(
    /center indices/,
  );
  const duplicate = structuredClone(aiHolePatternPlan);
  if (duplicate.steps[3].type === "hole") duplicate.steps[3].centers = [0, 0];
  expect(() => validateAiPlan(duplicate)).toThrow(/unique/);
  const wire = structuredClone(aiArcPlan);
  if (wire.steps[0].type === "sketch" && wire.steps[0].profile.type === "wire")
    wire.steps[0].profile.edges.pop();
  expect(() => validateAiPlan(wire)).toThrow(/outgoing edge/);
  const badArc = structuredClone(aiArcPlan);
  const arcStep = badArc.steps[0];
  if (
    arcStep.type !== "sketch" ||
    arcStep.profile.type !== "wire" ||
    arcStep.profile.edges[0].type !== "arc"
  )
    throw new Error("Expected arc fixture");
  arcStep.profile.edges[0].center.x = "1mm";
  expect(() => buildAiPlan(createEmptyDocument(), badArc)).toThrow(
    /equidistant/,
  );
  const pointsExtrude = {
    ...aiPolygonPlan,
    steps: [
      aiHolePatternPlan.steps[2],
      { ...aiPolygonPlan.steps[1], sketch: "centers" },
    ],
  };
  expect(() => buildAiPlan(createEmptyDocument(), pointsExtrude)).toThrow(
    /closed profile/,
  );
});
it("revises only bounded numeric proposal values, retaining recipe structure and rejecting invalid drafts", () => {
  const values = Object.fromEntries(
    aiPlatePlan.parameters.map((p) => [p.name, String(p.value)]),
  );
  const updated = reviseAiParameters(aiPlatePlan, {
    ...values,
    thickness: "8",
  });
  expect(updated.parameters.find((p) => p.name === "thickness")?.value).toBe(8);
  expect(updated.steps).toEqual(aiPlatePlan.steps);
  expect(
    aiPlatePlan.parameters.find((p) => p.name === "thickness")?.value,
  ).toBe(5);
  for (const thickness of [
    "",
    "NaN",
    "Infinity",
    "0x10",
    "1+2",
    "8mm",
    "100001",
  ])
    expect(() =>
      reviseAiParameters(aiPlatePlan, { ...values, thickness }),
    ).toThrow();
  expect(() =>
    reviseAiParameters(aiPlatePlan, { ...values, unknown: "1" }),
  ).toThrow(/unknown/);
});
it("limits AI edits to independent exclusive parameters and preserves durable IDs, bindings and other parts", () => {
  const created = buildAiPlan(createEmptyDocument(), aiPlatePlan);
  const base = created.document,
    original = JSON.stringify(base);
  const edit = {
    name: "Edit plate",
    summary: "Thicken the plate",
    warnings: [],
    steps: [],
    parameters: [{ name: "ai_1_thickness", value: 8, unit: "mm" }],
  };
  const context = aiEditContext(base, created.componentId);
  expect(context.parameters.map((p) => p.name)).toContain("ai_1_thickness");
  const staged = buildAiParameterEdit(base, created.componentId, edit);
  expect(JSON.stringify(base)).toBe(original);
  expect(staged.document.features).toEqual(base.features);
  expect(staged.document.sketches).toEqual(base.sketches);
  expect(staged.document.components).toEqual(base.components);
  expect(staged.document.parameters.ai_1_thickness.id).toBe(
    base.parameters.ai_1_thickness.id,
  );
  expect(staged.document.parameters.ai_1_thickness.expression).toBe("8mm");
  expect(staged.bodyIds).toEqual(created.bodyIds);
  expect(staged.changes).toEqual([
    { name: "ai_1_thickness", before: "5mm", after: "8mm" },
  ]);
  expect(() => buildAiParameterEdit(base, base.rootComponentId, edit)).toThrow(
    /cannot edit/,
  );
  expect(() =>
    buildAiParameterEdit(base, created.componentId, {
      ...edit,
      parameters: [{ ...edit.parameters[0], value: 5 }],
    }),
  ).toThrow(/no parameter changes/);
  const locked = upsertParameter(base, {
    ...base.parameters.ai_1_thickness,
    locked: true,
  });
  expect(() => buildAiParameterEdit(locked, created.componentId, edit)).toThrow(
    /cannot edit/,
  );
  const derived = upsertParameter(base, {
    ...base.parameters.ai_1_thickness,
    expression: "ai_1_width / 12",
  });
  expect(() =>
    buildAiParameterEdit(derived, created.componentId, edit),
  ).toThrow(/cannot edit/);
  // An indirect consumer in another component makes its independent driver shared.
  const other = buildAiPlan(base, aiPlatePlan);
  const shared = upsertParameter(other.document, {
    ...other.document.parameters.ai_2_thickness,
    expression: "ai_1_thickness",
  });
  expect(() => buildAiParameterEdit(shared, created.componentId, edit)).toThrow(
    /cannot edit/,
  );
  expect(() =>
    buildAiParameterEdit(base, created.componentId, aiPlatePlan),
  ).toThrow(/parameter changes only/);
});
it("creates an editable isolated component, namespaces parameters, preserves the base and round-trips durable intent", () => {
  const base = upsertParameter(createEmptyDocument(), {
    id: "existing",
    name: "ai_1_width",
    value: 7,
    expression: "7mm",
    unit: "mm",
  });
  const original = JSON.stringify(base),
    staged = buildAiPlan(base, aiPlatePlan);
  expect(JSON.stringify(base)).toBe(original);
  expect(staged.document.parameters.ai_1_width).toEqual(
    base.parameters.ai_1_width,
  );
  expect(staged.document.parameters.ai_2_width.expression).toBe("60mm");
  expect(staged.document.features).toHaveLength(2);
  expect(
    staged.document.features.every((f) => f.componentId === staged.componentId),
  ).toBe(true);
  expect(
    Object.values(staged.document.sketches).every(
      (s) => s.componentId === staged.componentId,
    ),
  ).toBe(true);
  expect(staged.document.features[1]).toMatchObject({
    targetBodyIds: staged.bodyIds,
    termination: { type: "throughAll" },
  });
  expect(rebuildDocument(staged.document).success).toBe(true);
  const saved = parseProjectJson(serializeProject(staged.document));
  expect(saved).toMatchObject({
    components: staged.document.components,
    parameters: JSON.parse(JSON.stringify(staged.document.parameters)),
  });
  expect(evaluateParameters(staged.document.parameters).errors).toEqual([]);
  // Fallback results must never satisfy the AI Apply geometry gate.
  expect(() =>
    assertAiGeometry(staged, rebuildDocument(staged.document)),
  ).toThrow(/native/);
});
it("rejects unknown shapes, code, unsafe/duplicate identifiers, oversized recipes and invalid expression units", () => {
  const base = createEmptyDocument();
  expect(() => validateAiPlan({ ...aiPlatePlan, script: "alert(1)" })).toThrow(
    /format/,
  );
  expect(() =>
    validateAiPlan({
      ...aiPlatePlan,
      parameters: [{ name: "constructor", value: 10, unit: "mm" }],
    }),
  ).toThrow(/safe/);
  expect(() =>
    validateAiPlan({
      ...aiPlatePlan,
      steps: [aiPlatePlan.steps[0], aiPlatePlan.steps[0]],
    }),
  ).toThrow(/unique/);
  expect(() =>
    validateAiPlan({
      ...aiPlatePlan,
      steps: Array.from({ length: 33 }, (_, index) => ({
        ...aiPlatePlan.steps[0],
        id: `step_${index}`,
      })),
    }),
  ).toThrow(/limit/);
  const wrongUnit = structuredClone(aiPlatePlan);
  wrongUnit.parameters[0].unit = "deg";
  expect(() => buildAiPlan(base, wrongUnit)).toThrow(/length/);
  const code = structuredClone(aiPlatePlan);
  code.steps[0] = {
    ...code.steps[0],
    type: "sketch",
    id: "outline",
    name: "bad",
    plane: "XY",
    offset: "fetch('secret')",
    profile: { type: "circle", x: "0mm", y: "0mm", radius: "1mm" },
  };
  expect(() => buildAiPlan(base, code)).toThrow(/Invalid token/);
});
it("rejects forward/consumed targets and handles clarification without changing a project", () => {
  const base = createEmptyDocument(),
    original = JSON.stringify(base);
  const missing = structuredClone(aiPlatePlan);
  const cut = missing.steps[3];
  if (cut.type === "extrude") cut.targets = ["future"];
  expect(() => buildAiPlan(createEmptyDocument(), missing)).toThrow(
    /missing or consumed/,
  );
  expect(() =>
    buildAiPlan(base, {
      ...aiPlatePlan,
      steps: [],
      parameters: [],
      summary: "What diameter should the gear have? Gears are unsupported.",
    }),
  ).toThrow(/unsupported/);
  expect(JSON.stringify(base)).toBe(original);
});
it("rejects canceled/stale same-ID frames and creates no history entry", () => {
  const state = useCadStore.getState();
  state.setDocument(createEmptyDocument());
  const document = useCadStore.getState().history.present;
  const frame = {
    document,
    session: useCadStore.getState().documentSession,
    componentId: document.rootComponentId,
  };
  const staged = buildAiPlan(document, aiPlatePlan);
  state.setDocument(document);
  expect(() =>
    applyAiPlan(frame, staged, rebuildDocument(staged.document)),
  ).toThrow(/changed/);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("reports broken project parameters before native preview and rejects multi-turn revolve angles", () => {
  const base = upsertParameter(createEmptyDocument(), {
    id: "broken",
    name: "broken",
    expression: "missing + 1mm",
    value: 0,
    unit: "mm",
  });
  expect(() => buildAiPlan(base, aiPlatePlan)).toThrow(
    /Repair project parameters.*broken/,
  );
  const plan = {
    ...aiPlatePlan,
    steps: [
      aiPlatePlan.steps[0],
      {
        type: "revolve",
        id: "body",
        name: "Cylinder",
        sketch: "outline",
        axis: "Y",
        angle: "720deg",
        operation: "newBody",
        targets: [],
      },
    ],
  };
  expect(() => buildAiPlan(createEmptyDocument(), plan)).toThrow(
    /at most 360deg/,
  );
});
