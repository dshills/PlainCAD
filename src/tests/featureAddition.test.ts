import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch, upsertParameter } from "../cad/document/CadDocument";
import { createXySketch } from "../cad/sketch/SketchModel";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import * as previewClient from "../cad/worker/extrudePreviewClient";
import { previewAiFeatureAddition } from "../ui/commands/aiFeatureAdditionCommand";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { facePocketFaces } from "../ui/commands/facePocketCommand";
import { captureAiFeatureAddition, featureAdditionContext, currentAiFeatureAddition, applyAiFeatureAddition, cancelAiFeatureAddition, useAiFeatureAddition } from "../ui/commands/aiFeatureAdditionCommand";
import { buildAiFeatureAddition, validateAiFeatureAddProposal, validateAiFeatureAddContext } from "../ai/featureAddPlan";
import { prepareAiFeatureAddRequest } from "../ai/featureAddAiClient";
import { serializeProject } from "../persistence/exportProject";
import { parseProjectJson } from "../persistence/importSafety";

vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs"), { createRequire } = await import("node:module");
  const root = `${process.cwd()}/node_modules/opencascade.js/dist`, filename = `${root}/opencascade.wasm.js`;
  const factory = new Function("require", "__dirname", "__filename", readFileSync(filename, "utf8").replace("export default opencascade;", "return opencascade;"))(createRequire(filename), root, filename);
  return { default: () => factory({ wasmBinary: readFileSync(`${root}/opencascade.wasm.wasm`) }) };
});
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
beforeAll(async () => OpenCascadeKernel.initialize());
beforeEach(() => { useCadStore.setState(useCadStore.getInitialState(), true); useViewerState.setState({ session: -1, hiddenBodyIds: [], hiddenComponentIds: [], hiddenSketchIds: [] }); cancelAiFeatureAddition(); });
function fixture(opening = false) {
  const base = createXySketch("Plate outline"), sketch = addCanvasGeometry(base, solveSketch(base, {}), "rectangle", [{ x: 0, y: 0 }, { x: 40, y: 30 }]).sketch;
  const authored = opening ? addCanvasGeometry(sketch, solveSketch(sketch, {}), "circle", [{ x: 20, y: 15 }, { x: 22, y: 15 }]).sketch : sketch;
  let document = upsertSketch(createEmptyDocument(), authored);
  document = upsertParameter(document, { id: "holeSize", name: "holeSize", expression: "3mm", value: 999, unit: "mm" });
  const profileId = detectProfiles(solveSketch(authored, {})).profiles.find((profile) => !opening || profile.innerLoops.length === 1)!.id;
  const feature = createExtrudeFeature({ name: "Plate", sketchId: sketch.id, profileId, direction: "positive", operation: "newBody", distance: { expression: "10mm", unit: "mm" } });
  document = upsertFeature(document, feature);
  const result = rebuildDocument(document);
  expect(result.success).toBe(true); expect(result.meshes[0].geometryAssertions?.volume).toBeCloseTo(12000 - (opening ? Math.PI * 2 ** 2 * 10 : 0), 5);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, rebuild: { status: "succeeded", kernelReady: true, result } });
  const face = facePocketFaces().find((item) => item.id === `extrude:${feature.id}:endCap`)!;
  const frame = captureAiFeatureAddition(face.id), context = featureAdditionContext(frame);
  return { document, result, feature, frame, context };
}
const proposal = { summary: "Four holes and a pocket", warnings: [], actions: [
  { kind: "holes", centers: [{ x: "5mm", y: "5mm" }, { x: "35mm", y: "5mm" }, { x: "5mm", y: "25mm" }, { x: "35mm", y: "25mm" }], diameter: "holeSize", depth: "throughAll" },
  { kind: "pocket", profile: { type: "rectangle", x: "15mm", y: "10mm", width: "10mm", height: "10mm" }, depth: "2mm" },
] };
it("shares bounded evaluated context and preserves bindings through native multi-feature additions and parameter edits", () => {
  const { document, result, frame, context } = fixture();
  expect(context.parameters[0].value).toBe(3);
  expect(validateAiFeatureAddContext(context)).toEqual(context);
  expect(context.face.bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 30 });
  expect(JSON.stringify(context)).not.toMatch(/meshes|positions|schemaVersion/);
  const plan = buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, proposal);
  expect(plan.document.parameters.holeSize.expression).toBe("3mm");
  expect(plan.document.features[0]).toEqual(document.features[0]);
  expect(plan.features).toHaveLength(2);
  const native = rebuildDocument(plan.document);
  const expected = 12000 - 4 * Math.PI * 1.5 ** 2 * 10 - 200;
  expect(native.success).toBe(true);
  expect(native.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(native.meshes[0].geometryAssertions!.volume).toBeCloseTo(expected, 5);
  const roundtrip = parseProjectJson(serializeProject(plan.document));
  expect(roundtrip).toEqual(JSON.parse(serializeProject(plan.document)));
  const changed = upsertParameter(plan.document, { ...plan.document.parameters.holeSize, expression: "4mm" });
  expect(rebuildDocument(changed).meshes[0].geometryAssertions!.volume).toBeCloseTo(12000 - 4 * Math.PI * 2 ** 2 * 10 - 200, 5);
});
it("rejects unsupported actions, oversized plans, invalid sizes, overlapping/off-face holes and unlisted parameters", () => {
  const { document, result, frame, context } = fixture();
  const build = (actions: unknown[]) => buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, { summary: "Test", warnings: [], actions });
  expect(() => validateAiFeatureAddProposal({ ...proposal, code: "alert(1)" })).toThrow(/unsupported/);
  expect(() => validateAiFeatureAddProposal({ ...proposal, actions: Array(5).fill(proposal.actions[0]) })).toThrow(/limit/);
  expect(() => build([{ kind: "holes", centers: [{ x: "0mm", y: "0mm" }], diameter: "3mm", depth: "throughAll" }])).toThrow(/fit/);
  expect(() => build([{ kind: "holes", centers: [{ x: "5mm", y: "5mm" }, { x: "5mm", y: "5mm" }], diameter: "3mm", depth: "throughAll" }])).toThrow(/overlapping/);
  expect(() => build([{ ...proposal.actions[0], diameter: "unshared" }])).toThrow(/unshared/);
  expect(() => build([{ kind: "fillet", edgeIds: ["arbitrary-edge"], size: "1mm" }])).toThrow(/listed/);
  expect(() => build([{ kind: "pocket", profile: { type: "circle", x: "10mm", y: "10mm", radius: "-1mm" }, depth: "2mm" }])).toThrow(/Invalid feature length/);
  expect(() => build([])).toThrow("Test");
  expect(useCadStore.getState().history.present).toBe(document);
});
it("requires a worker-issued exact plan proof and rejects canceled, replaced or hidden target frames", () => {
  const { document, result, frame, context } = fixture();
  const plan = buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, proposal);
  useAiFeatureAddition.setState({ frame });
  expect(currentAiFeatureAddition(frame)).toBe(true);
  expect(() => applyAiFeatureAddition(frame, plan, rebuildDocument(plan.document))).toThrow(/preview changed/);
  useViewerState.setState({ session: frame.session, hiddenBodyIds: [context.face.bodyId] });
  expect(currentAiFeatureAddition(frame)).toBe(false);
  useViewerState.setState({ hiddenBodyIds: [], hiddenComponentIds: [frame.componentId] });
  expect(currentAiFeatureAddition(frame)).toBe(false);
  useViewerState.setState({ hiddenComponentIds: [] });
  expect(currentAiFeatureAddition(frame)).toBe(true);
  cancelAiFeatureAddition();
  expect(() => applyAiFeatureAddition(frame, plan, result)).toThrow(/preview changed/);
  useCadStore.setState({ history: { past: [], present: { ...document }, future: [] } });
  expect(currentAiFeatureAddition(frame)).toBe(false);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("bounds complete request/history data without credentials or partial recent turns", () => {
  const { context } = fixture();
  const request = prepareAiFeatureAddRequest("openai", "test-model", "Add four mounting holes", [], context);
  expect(request.featureContext).toEqual(context);
  const messages = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `${i}:` + "x".repeat(8000) }));
  const bounded = prepareAiFeatureAddRequest("openai", "test-model", "Add holes", messages, context);
  expect(bounded.history.length).toBeLessThan(messages.length);
  expect(bounded.history.length % 2).toBe(0);
  expect(bounded.history.at(-1)).toEqual(messages.at(-1));
  expect(new TextEncoder().encode(JSON.stringify(bounded)).byteLength).toBeLessThanOrEqual(32768);
  expect(() => prepareAiFeatureAddRequest("openai", "test-model", "Add holes", [{ role: "user", content: "造".repeat(16000) }, { role: "assistant", content: "造".repeat(16000) }], context)).toThrow(/32 KB/);
  expect(() => prepareAiFeatureAddRequest("openai", "", "Add holes", [], context)).toThrow(/provider/);
  expect(() => prepareAiFeatureAddRequest("openai", "test-model", "", [], context)).toThrow(/prompt/);
  expect(() => prepareAiFeatureAddRequest("openai", "test-model", "Add holes", [{ role: "assistant", content: "Wrong initial turn" }], context)).toThrow();
});

it.each(["fillet", "chamfer"] as const)("adds a supported individual %s after a pocket while preserving source refs", (kind) => {
  const { document, result, frame, context } = fixture();
  const edge = context.edges.find((item) => item.role === "endCapPerimeter" && item.sourceEntityId)!;
  expect(edge).toBeTruthy();
  const source = document.sketches[(document.features[0] as { sketchId: string }).sketchId];
  const solved = solveSketch(source, {});
  const line = source.entities[edge.sourceEntityId!];
  if (line.type !== "line") throw new Error("Expected authored line edge");
  const a = solved.points[line.startPointId], b = solved.points[line.endPointId];
  if (!a || !b) throw new Error("Expected line endpoints");
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  const plan = buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, { summary: "Pocket and edge treatment", warnings: [], actions: [proposal.actions[1], { kind, edgeIds: [edge.id], size: "1mm" }] });
  const native = rebuildDocument(plan.document);
  expect(native.success).toBe(true);
  expect(native.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(native.meshes[0].geometryAssertions!.volume).toBeCloseTo(11800 - length * (kind === "fillet" ? 1 - Math.PI / 4 : 0.5), 5);
  const treatment = plan.features[1];
  if (treatment.type !== "fillet" && treatment.type !== "chamfer") throw new Error("Expected edge treatment");
  expect(treatment.targetEdgeRefs[0].sourceEntityId).toBe(edge.sourceEntityId);
  expect(treatment.targetEdgeRefs[0].featureId).toBe(document.features[0].id);
});

it("rejects rectangular pockets crossing an opening even with every corner on material", () => {
  const { document, result, frame, context } = fixture(true);
  expect(() => buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, { summary: "Pocket crossing opening", warnings: [], actions: [proposal.actions[1]] })).toThrow(/crosses a face opening/);
  expect(useCadStore.getState().history.present).toBe(document);
});
it("applies only the exact native private preview once and preserves one Undo", async () => {
  const { document, result, frame, context } = fixture();
  const plan = buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, { summary: "Pocket", warnings: [], actions: [proposal.actions[1]] });
  const native = rebuildDocument(plan.document);
  useAiFeatureAddition.setState({ frame });
  const worker = vi.spyOn(previewClient, "previewModeling").mockResolvedValue(native);
  try {
    const preview = await previewAiFeatureAddition(frame, plan, new AbortController().signal);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(preview.volume).toBeCloseTo(11800, 5);
    applyAiFeatureAddition(frame, plan, preview.result);
    expect(useCadStore.getState().history.present).toEqual(plan.document);
    expect(useCadStore.getState().history.past).toEqual([document]);
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(document);
    expect(() => applyAiFeatureAddition(frame, plan, preview.result)).toThrow(/preview changed/);
  } finally { worker.mockRestore(); }
});

it("rejects a redundant cut across separate AI actions before Apply", async () => {
  const { document, result, frame, context } = fixture();
  const hole = { kind: "holes", centers: [{ x: "5mm", y: "5mm" }], diameter: "3mm", depth: "throughAll" };
  const plan = buildAiFeatureAddition(document, document.rootComponentId, frame.choice, result, context, { summary: "Duplicate holes", warnings: [], actions: [hole, hole] });
  useAiFeatureAddition.setState({ frame });
  const worker = vi.spyOn(previewClient, "previewModeling").mockImplementation(async (staged) => rebuildDocument(staged));
  try {
    await expect(previewAiFeatureAddition(frame, plan, new AbortController().signal)).rejects.toThrow(/No-op|no material|native|volume/i);
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  } finally { worker.mockRestore(); cancelAiFeatureAddition(); }
});
