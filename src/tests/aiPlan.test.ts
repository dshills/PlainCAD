import { expect, it, afterEach } from "vitest";
import {
  createEmptyDocument,
  upsertParameter,
} from "../cad/document/CadDocument";
import { buildAiPlan } from "../ai/buildPlan";
import { validateAiPlan } from "../ai/plan";
import { aiPlatePlan } from "./fixtures/aiPlan";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { serializeProject } from "../persistence/exportProject";
import { parseProjectJson } from "../persistence/importSafety";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { useCadStore } from "../state/useCadStore";
import { applyAiPlan, assertAiGeometry } from "../ui/commands/aiCommand";

afterEach(() => useCadStore.setState(useCadStore.getInitialState(), true));
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
