import { beforeEach, expect, it, vi } from "vitest";
import { buildAiPlan } from "../ai/buildPlan";
import { selectionAiTarget, assertSelectionAiPlan } from "../ai/selectionTarget";
import { separatePartsPlan } from "./fixtures/aiTargetsPlan";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { currentAiFrame } from "../ui/commands/aiCommand";
import { useViewerState } from "../state/viewerState";
import { useCadStore } from "../state/useCadStore";
import { beginAiFacePicking, clearAiFacePicking, currentAiFacePicking, useAiFacePicking } from "../state/aiFacePicking";
import { sketchPlaneChoices } from "../cad/sketch/planePicking";
import type { SelectionRef } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";

function fixture() {
  const staged = buildAiPlan(createEmptyDocument(), separatePartsPlan);
  const result = rebuildDocument(staged.document);
  // Controlled proof metadata for target/enablement tests; no native modeling assertion.
  result.meshes.forEach(mesh => { mesh.geometrySource = "opencascade"; mesh.geometryAssertions = { valid: true, volume: 1000, surfaceArea: 500, solidCount: 1 }; });
  return { ...staged, result };
}
beforeEach(() => { useCadStore.setState({ ...useCadStore.getInitialState(), rebuildNow: vi.fn() }, true); clearAiFacePicking(); useViewerState.setState(useViewerState.getInitialState(), true); useAiDrawer.setState({ open: false }); useExtrudeDraft.setState({ draft: undefined }); });
it("limits a selected native body's parameter context to independent drivers of that body", () => {
  const { document, componentId, bodyIds, result } = fixture();
  const selected: SelectionRef = { kind: "body", id: bodyIds[0], documentId: document.id };
  const target = selectionAiTarget(document, componentId, [selected], result);
  expect(target.kind).toBe("body"); expect(target.context?.parameters.map(p => p.name)).toEqual(["ai_1_width"]);
  expect(target.bodyIds).toEqual([bodyIds[0]]);
  expect(selectionAiTarget(document, componentId, [selected], result, [], [bodyIds[0]])).toMatchObject({ kind: "unsupported", diagnostic: expect.any(String) });
  const plan = { ...separatePartsPlan, steps: [], parameters: [{ name: "ai_1_width", value: 24, unit: "mm" as const }] };
  expect(() => assertSelectionAiPlan(target, plan)).not.toThrow();
  expect(() => assertSelectionAiPlan(target, { ...plan, parameters: [{ name: "ai_1_depth", value: 24, unit: "mm" }] })).toThrow("outside the selected target");
  expect(() => assertSelectionAiPlan(target, { ...plan, steps: separatePartsPlan.steps })).toThrow("outside the selected target");
});
it("keeps selected feature fields narrow and routes supported faces and authored sketches explicitly", () => {
  const { document, componentId, result } = fixture(), feature = document.features[0];
  expect(selectionAiTarget(document, componentId, [{ kind: "feature", id: feature.id, documentId: document.id }], result).context?.parameters.map(p => p.name)).toEqual(["distance"]);
  const face = sketchPlaneChoices(document, result).find(choice => choice.id === `extrude:${feature.id}:endCap`)!;
  const target = selectionAiTarget(document, componentId, [{ kind: "face", id: face.id, documentId: document.id }], result, [face]);
  expect(target).toMatchObject({ kind: "face", faceId: face.id, bodyIds: [face.bodyId] });
  const sketch = Object.values(document.sketches)[0];
  expect(selectionAiTarget(document, componentId, [{ kind: "sketch", id: sketch.id, documentId: document.id }], result)).toMatchObject({ kind: "sketch", sketchId: sketch.id });
});
it("diagnoses multiple, stale, unsupported, invalid and missing native targets rather than broadening scope", () => {
  const { document, componentId, bodyIds, result } = fixture();
  const selection: SelectionRef = { kind: "body", id: bodyIds[0], documentId: document.id };
  for (const [selected, native] of [
    [[selection, selection], result], [[{ ...selection, documentId: "old" }], result],
    [[{ ...selection, kind: "edge" as const }], result], [[selection], undefined],
    [[selection], { ...result, documentId: "old" }],
    [[selection], { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometryAssertions: { ...mesh.geometryAssertions!, volume: NaN } })) }],
    [[selection], { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometryAssertions: { ...mesh.geometryAssertions!, volume: 0 } })) }],
    [[selection], { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometryAssertions: { ...mesh.geometryAssertions!, solidCount: 0 } })) }],
  ] as Array<[SelectionRef[], RebuildResult | undefined]>) {
    expect(selectionAiTarget(document, componentId, selected, native)).toMatchObject({ kind: "unsupported", diagnostic: expect.any(String) });
  }
});
it("captures the full selection without changing legacy frames and invalidates pending work on selection replacement", () => {
  const { document, componentId, bodyIds, result } = fixture();
  const selection: SelectionRef = { kind: "body", id: bodyIds[0], documentId: document.id };
  useCadStore.setState({ activeComponentId: componentId, history: { past: [], present: document, future: [] }, selection: { selectedIds: [selection] }, rebuild: { status: "succeeded", result, kernelReady: true } });
  const state = useCadStore.getState(), frame = { document, componentId, session: state.documentSession, selection: [selection] };
  expect(currentAiFrame(frame)).toBe(true);
  const viewer = useViewerState.getState();
  useViewerState.setState({ session: state.documentSession, hiddenBodyIds: [bodyIds[0]], hiddenComponentIds: [] });
  expect(currentAiFrame({ ...frame, targetBodyIds: [bodyIds[0]] })).toBe(false);
  useViewerState.setState(viewer, true);
  useCadStore.getState().select({ ...selection, id: bodyIds[1] });
  expect(currentAiFrame(frame)).toBe(false);
  expect(currentAiFrame({ document, componentId, session: state.documentSession })).toBe(true);
});
it("requires current native results for face picking and releases the captured frame on same-ID reopen", () => {
  const { document, componentId, result } = fixture();
  useCadStore.setState({ activeComponentId: componentId, history: { past: [], present: document, future: [] }, rebuild: { status: "succeeded", result, kernelReady: true } });
  expect(beginAiFacePicking()).toBe(true); expect(currentAiFacePicking()).toBe(useAiFacePicking.getState().frame);
  useCadStore.getState().setDocument(document);
  expect(currentAiFacePicking()).toBeUndefined(); expect(useAiFacePicking.getState().frame).toBeUndefined();
  useCadStore.setState({ rebuild: { status: "succeeded", result: { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "fallback" })) }, kernelReady: true } });
  expect(beginAiFacePicking()).toBe(false);
});

it("blocks opening AI during a manual draft or scope capture while always allowing close", () => {
  const state = useCadStore.getState();
  expect(selectCommandEnablement(state, true).aiAssistant).toBe(false);
  useExtrudeDraft.setState({ draft: {} as NonNullable<ReturnType<typeof useExtrudeDraft.getState>["draft"]> });
  runCommand("ai.toggle");
  expect(useAiDrawer.getState().open).toBe(false);
  useAiDrawer.setState({ open: true });
  runCommand("ai.toggle");
  expect(useAiDrawer.getState().open).toBe(false);
});
