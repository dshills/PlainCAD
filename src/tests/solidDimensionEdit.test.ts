import { beforeEach, afterEach, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { buildSolidDimensionEdit, solidDimensionImpact, solidDimensionParameters, solidDimensionRef } from "../cad/inspection/solidDimensionEdit";
import { useCadStore } from "../state/useCadStore";
import { beginSolidDimensionEdit, currentSolidDimensionFrame, cancelSolidDimensionEdit, applySolidDimensionEdit, useSolidDimensionEdit } from "../ui/commands/solidDimensionCommand";
import { solidDimensions } from "../cad/inspection/solidDimensions";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";

beforeEach(() => useCadStore.setState(useCadStore.getInitialState(), true));
afterEach(() => { cancelSolidDimensionEdit(); useCadStore.setState(useCadStore.getInitialState(), true); });
it("requires deliberate feature replacement versus shared parameter edit and retains stable identities/bindings", () => {
  const base = createBoxTemplate(), feature = base.features[0];
  const parameter = base.parameters.depth;
  const shared = { ...base, features: [feature, { ...feature, id: "shared-extrude", name: "Shared", timelineStep: 3 }] };
  const ref = solidDimensionRef(feature, "distance");
  expect(solidDimensionParameters(shared, ref)[0].parameter.id).toBe(parameter.id);
  expect(solidDimensionImpact(shared, "parameter", parameter.id)).toEqual(expect.arrayContaining(["feature: Box Extrude", "feature: Shared"]));
  const changed = buildSolidDimensionEdit(shared, feature.id, "distance", { kind: "parameter", id: parameter.id }, "25mm");
  expect(changed.parameters.depth).toMatchObject({ id: parameter.id, expression: "25mm" });
  expect(changed.features.map((f) => solidDimensionRef(f, "distance").expression)).toEqual(["depth", "depth"]);
  expect(base.parameters.depth.expression).toBe("20mm");
  const replaced = buildSolidDimensionEdit(base, feature.id, "distance", { kind: "feature" }, "depth + 5mm");
  expect(replaced.parameters.depth.expression).toBe("20mm");
  expect(solidDimensionRef(replaced.features[0], "distance")).toMatchObject({ expression: "depth + 5mm", parameterRefs: { depth: parameter.id } });
});
it("rejects unknown/wrong-unit/nonpositive/no-op fields and locked/derived parameter edits", () => {
  const base = createBoxTemplate(), id = base.features[0].id;
  for (const expression of ["missing", "5deg", "0mm", "-1mm", "depth"]) expect(() => buildSolidDimensionEdit(base, id, "distance", { kind: "feature" }, expression)).toThrow();
  for (const patch of [{ locked: true }, { expression: "width / 2" }]) {
    const doc = { ...base, parameters: { ...base.parameters, depth: { ...base.parameters.depth, ...patch } } };
    expect(() => buildSolidDimensionEdit(doc, id, "distance", { kind: "parameter", id: base.parameters.depth.id }, "25mm")).toThrow();
  }
  expect(() => buildSolidDimensionEdit(base, id, "depth", { kind: "feature" }, "4mm")).toThrow(/editable/);
});
it("uses exact snapshot/result/session and blocks competing shared commands while an inline draft is active", () => {
  const document = createBoxTemplate(), result = rebuildDocument(document);
  // Unit fixture verifies guards only; native assertions are exercised in browser acceptance.
  result.meshes = result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 80000, surfaceArea: 13200, solidCount: 1 } }));
  useCadStore.setState((state) => ({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { ...state.rebuild, kernelReady: true, status: "succeeded", result } }));
  const dimension = solidDimensions(document, result, { kind: "feature", id: document.features[0].id, documentId: document.id }, document.rootComponentId)[0];
  beginSolidDimensionEdit(dimension);
  const frame = useSolidDimensionEdit.getState().frame!;
  expect(currentSolidDimensionFrame(frame)).toBe(true);
  expect(() => applySolidDimensionEdit({ frame, document, result, expression: "25mm", target: { kind: "feature" } })).toThrow(/not issued/);
  const enabled = selectCommandEnablement(useCadStore.getState());
  expect(enabled.outsideGuidedHole).toBe(false);
  expect(enabled.createExtrude).toBe(false);
  expect(enabled.exportStl).toBe(false);
  useCadStore.setState({ history: { past: [], present: { ...document }, future: [] } });
  expect(currentSolidDimensionFrame(frame)).toBe(false);
});
