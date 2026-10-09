import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { useCadStore } from "../state/useCadStore";
import { useCommandPlan } from "../state/commandPlanState";
import { clearAiCanvasPreview, publishAiCanvasPreview, useAiCanvasPreview } from "../state/aiCanvasPreview";
import { applyCadCommand, type CadCommandCall } from "../commands/cadCommandOperations";
import { applyCommandPlan, cancelCommandPlan, previewCommandPlan, registerCommandPlanCommands, resolvePlanReferences } from "../commands/commandPlans";
import { CAD_COMMANDS } from "../commands/cadCommands";
import { defineCommand, subscribeCommandExecutions } from "../commands/registry";
const native = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: native.preview }));
let dispose = () => {};
function result(document: CadDocument, volume = 1000): RebuildResult {
  const owner = document.features.find(feature => feature.type === "extrude");
  return { documentId: document.id, success: true, errors: [], warnings: [], bodies: [], durationMs: 1,
    meshes: owner ? [{ id: "mesh", bodyId: `body:${owner.id}`, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [20, 10, 5] }, geometrySource: "opencascade", geometryAssertions: { valid: true, volume, surfaceArea: 700, solidCount: 1 } }] : [] };
}
const steps: CadCommandCall[] = [
  { command: "cad.sketch.create", arguments: { name: "Outline", plane: "XY", as: "outline" } },
  { command: "cad.sketch.rectangle", arguments: { sketchId: { $result: { step: 0, path: ["id"] } }, width: "20", height: "10", as: "rectangle" } },
  { command: "cad.feature.extrude", arguments: { sketchId: "$outline", profileId: "$rectangle.profile0", distance: "5", as: "base" } },
];
beforeEach(() => {
  cancelCommandPlan(); clearAiCanvasPreview();
  useCadStore.setState(useCadStore.getInitialState(), true);
  const document = createEmptyDocument("Plan unit fixture");
  useCadStore.setState({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, selection: { selectedIds: [] }, documentSession: 7, fileBusy: false, rebuild: { status: "idle", kernelReady: true }, rebuildNow: vi.fn() });
  native.preview.mockReset(); native.preview.mockImplementation(async (document: CadDocument) => result(document));
  CAD_COMMANDS.forEach(descriptor => defineCommand(descriptor));
  dispose = registerCommandPlanCommands(() => true);
});
afterEach(() => { dispose(); clearAiCanvasPreview(); useCadStore.setState(useCadStore.getInitialState(), true); });
describe("transactional command plans", () => {
  it("resolves only backward own-property JSON result references", () => {
    const results = [{ id: "sketch", pointIds: ["point0"] }];
    expect(resolvePlanReferences({ sketchId: { $result: { step: 0, path: ["id"] } }, center: [{ $result: { step: 0, path: ["pointIds", 0] } }] }, results)).toEqual({ sketchId: "sketch", center: ["point0"] });
    expect(() => resolvePlanReferences({ $result: { step: 1, path: ["id"] } }, results)).toThrow("earlier");
    expect(() => resolvePlanReferences({ $result: { step: 0, path: ["constructor"] } }, results)).toThrow("lost");
    expect(() => resolvePlanReferences({ $result: { step: 0, path: ["missing"] } }, results)).toThrow("lost");
  });
  it("stages alias/reference-driven edits on the canvas then applies once with one Undo", async () => {
    const accepted = useCadStore.getState();
    const observed: string[] = [], unsubscribe = subscribeCommandExecutions(event => { if (event.request.command.startsWith("cad.")) observed.push(event.request.command); });
    try {
      const preview = await previewCommandPlan({ label: "Make plate", steps });
      expect(preview.status).toBe("ready");
      expect(useCadStore.getState().history).toBe(accepted.history);
      expect(useCadStore.getState().rebuild.result).toBe(accepted.rebuild.result);
      expect(useAiCanvasPreview.getState().preview?.candidate?.features).toHaveLength(1);
      expect(useAiCanvasPreview.getState().preview?.result.meshes[0].geometryAssertions?.volume).toBe(1000);
      expect(observed).toEqual([]);
      expect(applyCommandPlan(preview.planId)).toMatchObject({ applied: true, steps: 3 });
      expect(useCadStore.getState().history.past).toEqual([accepted.history.present]);
      expect(useCadStore.getState().history.present.features).toHaveLength(1);
      expect(observed).toEqual(steps.map(step => step.command));
      expect(() => applyCommandPlan(preview.planId)).toThrow("stale");
      useCadStore.getState().undo();
      expect(useCadStore.getState().history.present).toBe(accepted.history.present);
    } finally { unsubscribe(); }
  });
  it("fails a native feature prefix before a later deletion can conceal it", async () => {
    const accepted = useCadStore.getState();
    native.preview.mockImplementation(async (document: CadDocument) => document.features.some(feature => feature.type === "fillet") ? { ...result(document), success: false, errors: [{ sourceKind: "feature", sourceId: document.features.at(-1)!.id, message: "Fillet left geometry unchanged", severity: "error" }] } : result(document));
    await expect(previewCommandPlan({ steps: [...steps,
      { command: "cad.feature.fillet", arguments: { edges: [{ featureId: "$base", role: "endCapPerimeter" }], radius: "1", as: "fillet" } },
      { command: "cad.feature.delete", arguments: { featureId: "$fillet" } },
    ] })).rejects.toThrow("unchanged");
    expect(useCadStore.getState().history).toBe(accepted.history);
    expect(useAiCanvasPreview.getState().preview).toBeUndefined();
    expect(useCommandPlan.getState().status).toBe("failed");
    expect(native.preview).toHaveBeenCalledTimes(2);
  });
  it("validates parameter geometry changes before a later deletion can conceal invalid solids", async () => {
    let document = useCadStore.getState().history.present;
    let aliases: Record<string, string> = {};
    const prepare = (command: string, args: CadCommandCall["arguments"]) => {
      const applied = applyCadCommand(document, { command, arguments: args }, { aliases });
      document = applied.document; aliases = applied.aliases;
    };
    prepare("cad.parameter.add", { name: "width", expression: "20mm", as: "width" });
    prepare("cad.sketch.create", { name: "Outline", plane: "XY", as: "sketch" });
    prepare("cad.sketch.rectangle", { sketchId: "$sketch", width: "width", height: "10" });
    prepare("cad.feature.extrude", { sketchId: "$sketch", distance: "5", as: "base" });
    useCadStore.setState({ history: { past: [], present: document, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result: result(document) } });
    const accepted = useCadStore.getState();
    native.preview.mockImplementation(async (candidate: CadDocument) => candidate.features.length && candidate.parameters.width.expression === "-1mm" ? { ...result(candidate), success: false, errors: [{ sourceKind: "feature", sourceId: candidate.features[0].id, message: "Width produces invalid profile", severity: "error" }] } : result(candidate));
    await expect(previewCommandPlan({ steps: [
      { command: "cad.parameter.update", arguments: { parameterId: aliases.width, expression: "-1mm" } },
      { command: "cad.feature.delete", arguments: { featureId: aliases.base } },
    ] })).rejects.toThrow("invalid profile");
    expect(useCadStore.getState().history).toBe(accepted.history);
    expect(useAiCanvasPreview.getState().preview).toBeUndefined();
  });
  it.each(["fallback", "missingProof", "invalidVolume", "empty", "wrongDocument"])("rejects %s native proof without committing", async kind => {
    const accepted = useCadStore.getState();
    native.preview.mockImplementation(async (document: CadDocument) => {
      const proof = result(document);
      if (kind === "fallback") proof.meshes[0].geometrySource = "fallback";
      if (kind === "missingProof") proof.meshes[0].geometryAssertions = undefined;
      if (kind === "invalidVolume") proof.meshes[0].geometryAssertions!.volume = 0;
      if (kind === "empty") proof.meshes = [];
      if (kind === "wrongDocument") proof.documentId = "wrong";
      return proof;
    });
    await expect(previewCommandPlan({ steps })).rejects.toThrow();
    expect(useCadStore.getState().history).toBe(accepted.history);
    expect(useAiCanvasPreview.getState().preview).toBeUndefined();
  });
  it("leaves an unrelated AI canvas proposal intact when cancelling without a plan frame", () => {
    const source = useCadStore.getState().history.present;
    let candidate = source, aliases: Record<string, string> = {};
    for (const step of steps) {
      const call = { ...step };
      // This fixture uses plan-local aliases rather than a result reference.
      if (step.command === "cad.sketch.rectangle") call.arguments = { sketchId: "$outline", width: "20", height: "10", as: "rectangle" };
      const applied = applyCadCommand(candidate, call, { aliases }); candidate = applied.document; aliases = applied.aliases;
    }
    const state = useCadStore.getState(), proof = result(candidate);
    expect(publishAiCanvasPreview({ document: source, session: state.documentSession, componentId: state.activeComponentId, beforeResult: state.rebuild.result, result: proof, bodyIds: [proof.meshes[0].bodyId] })).toBe(true);
    const unrelated = useAiCanvasPreview.getState().preview;
    expect(unrelated?.planId).toBeUndefined();
    expect(useCommandPlan.getState().frame).toBeUndefined();
    cancelCommandPlan();
    expect(useAiCanvasPreview.getState().preview).toBe(unrelated);
    expect(useCommandPlan.getState().status).toBe("idle");
    expect(useCadStore.getState().history.present).toBe(source);
  });
  it("cancels an in-flight preview and ignores its late native result", async () => {
    const accepted = useCadStore.getState();
    let finish!: (value: RebuildResult) => void, staged!: CadDocument;
    native.preview.mockImplementation((document: CadDocument) => { staged = document; return new Promise<RebuildResult>(resolve => { finish = resolve; }); });
    const pending = previewCommandPlan({ steps });
    await vi.waitFor(() => expect(native.preview).toHaveBeenCalledTimes(1));
    cancelCommandPlan(); finish(result(staged));
    await expect(pending).rejects.toThrow("cancelled");
    expect(useCadStore.getState().history).toBe(accepted.history);
    expect(useCommandPlan.getState().status).toBe("idle");
    expect(useAiCanvasPreview.getState().preview).toBeUndefined();
  });
  it.each(["selection", "session", "document", "nativeResult", "component"])("rejects Apply when %s changes after preview", async kind => {
    const preview = await previewCommandPlan({ steps });
    const accepted = useCadStore.getState();
    if (kind === "selection") useCadStore.setState({ selection: { selectedIds: [{ kind: "sketch", id: "other", documentId: accepted.history.present.id }] } });
    if (kind === "session") useCadStore.setState({ documentSession: accepted.documentSession + 1 });
    if (kind === "document") useCadStore.setState({ history: { ...accepted.history, present: { ...accepted.history.present, name: "Edited outside plan" } } });
    if (kind === "nativeResult") useCadStore.setState({ rebuild: { ...accepted.rebuild, result: result(accepted.history.present) } });
    if (kind === "component") useCadStore.setState({ activeComponentId: "other" });
    expect(() => applyCommandPlan(preview.planId)).toThrow("stale");
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(useAiCanvasPreview.getState().preview).toBeUndefined();
  });
  it("preserves accepted parameter edits after cancelling a staged modification", async () => {
    const initial = useCadStore.getState().history.present;
    const parameter = applyCadCommand(initial, { command: "cad.parameter.add", arguments: { name: "width", expression: "20mm" } });
    const source = parameter.document;
    useCadStore.setState({ history: { past: [], present: source, future: [] } });
    const preview = await previewCommandPlan({ steps: [{ command: "cad.parameter.update", arguments: { parameterId: parameter.result.id!, expression: "30mm" } }] });
    expect(useCommandPlan.getState().frame?.document?.parameters.width.expression).toBe("30mm");
    expect(useCadStore.getState().history.present.parameters.width.expression).toBe("20mm");
    cancelCommandPlan();
    expect(() => applyCommandPlan(preview.planId)).toThrow("stale");
    expect(useCadStore.getState().history.present).toBe(source);
  });
});
