import { afterEach, expect, it, vi } from "vitest";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { sketchPlaneTransform, stableFaceId } from "../cad/sketch/planes";
import { useCadStore } from "../state/useCadStore";
import { shellTarget, useShell } from "../state/shellDraftState";
import { applyShell, beginShell, cancelShell, previewShell, type ShellInput } from "../ui/commands/shellCommand";
import { createBoxTemplate } from "../templates/templates";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
import { applyCadCommand } from "../commands/cadCommandOperations";
import { executeCommand, subscribeCommandExecutions } from "../commands/registry";

vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
const worker = vi.mocked(previewModeling);

function fixture() {
  const document = createBoxTemplate(), source = document.features[0];
  const result = rebuildDocument(document);
  const mesh = { ...result.meshes[0], geometrySource: "opencascade" as const, kernelOperation: "extrusion" as const,
    geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 100, solidCount: 1 } };
  const base: RebuildResult = { ...result, shellAvailable: true, meshes: [mesh],
    availableFaces: [{ id: stableFaceId(source.id, "endCap"), featureId: source.id, label: "End cap", transform: sketchPlaneTransform("XY") }] };
  const output: RebuildResult = { ...base, meshes: [{ ...mesh, kernelOperation: "shell",
    geometryAssertions: { ...mesh.geometryAssertions, volume: 500 } }] };
  useCadStore.setState({
    history: { present: document, past: [], future: [] }, documentSession: 1, fileBusy: false,
    activeComponentId: document.rootComponentId,
    rebuild: { kernelReady: true, status: "succeeded", result: base },
    selection: { selectedIds: [{ documentId: document.id, kind: "feature", id: source.id }] },
  });
  const input: ShellInput = { opening: "endCap", wallThickness: "1mm" };
  return { document, base, output, input };
}

afterEach(() => {
  cancelShell();
  useCadStore.setState(useCadStore.getInitialState());
  worker.mockReset();
});

it("records only an applied worker-issued Shell edit and preserves one Undo", async () => {
  const { document, output, input } = fixture();
  worker.mockResolvedValue(output);
  const record = vi.fn();
  const unsubscribe = subscribeCommandExecutions(record);
  try {
    expect(selectCommandEnablement(useCadStore.getState()).createShell).toBe(true);
    beginShell();
    expect(selectCommandEnablement(useCadStore.getState()).createShell).toBe(false);
    const proof = await previewShell(useShell.getState().frame!, input, new AbortController().signal);
    expect(useCadStore.getState().history.present).toBe(document);
    expect(() => applyShell({ ...proof }, input)).toThrow(/latest valid/);
    expect(() => applyShell(proof, { ...input, wallThickness: "2mm" })).toThrow(/latest valid/);
    expect(record).not.toHaveBeenCalled();
    applyShell(proof, input);
    expect(useCadStore.getState().history.past).toEqual([document]);
    expect(useCadStore.getState().history.present.features.at(-1)).toMatchObject({ type: "shell", sourceFeatureId: document.features[0].id });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      request: { command: "cad.feature.shell", session: 1, target: "domain", arguments: { ...input, sourceFeatureId: document.features[0].id } },
      result: { id: proof.featureId, bodyId: output.meshes[0].bodyId },
    });
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(document);
  } finally { unsubscribe(); }
});

it("requires native plan proof before direct commands can create or change Shell geometry", async () => {
  const { document, input } = fixture();
  const args = { ...input, sourceFeatureId: document.features[0].id };
  expect(await executeCommand({ command: "cad.feature.shell", session: 1, arguments: { ...args, wallThickness: "100mm" } }))
    .toMatchObject({ ok: false, error: { code: "unavailable", message: expect.stringContaining("plan.preview") } });
  expect(useCadStore.getState().history.present).toBe(document);
  const staged = applyCadCommand(document, { command: "cad.feature.shell", arguments: args });
  const history = { present: staged.document, past: [], future: [] };
  useCadStore.setState({ history });
  expect(await executeCommand({ command: "cad.feature.update", session: 1, arguments: { featureId: staged.result.id!, wallThickness: "100mm" } }))
    .toMatchObject({ ok: false, error: { code: "command_failed", message: expect.stringContaining("plan.preview") } });
  expect(useCadStore.getState().history).toBe(history);
  expect(worker).not.toHaveBeenCalled();
});

it("rejects a late preview after a same-ID replacement and excludes modified or fallback sources", async () => {
  const { document, base, output, input } = fixture();
  for (const mesh of [
    { ...base.meshes[0], kernelOperation: "cut" as const },
    { ...base.meshes[0], geometrySource: "fallback" as const },
  ]) {
    const state = useCadStore.getState();
    expect(shellTarget({ ...state, rebuild: { ...state.rebuild, result: { ...base, meshes: [mesh] } } }, false)).toBeUndefined();
  }
  beginShell();
  let resolve!: (value: RebuildResult) => void;
  worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const pending = previewShell(useShell.getState().frame!, input, new AbortController().signal);
  useCadStore.setState({ documentSession: 2 });
  resolve(output);
  await expect(pending).rejects.toThrow(/stale/);
  expect(useCadStore.getState().history.present).toBe(document);
  expect(useCadStore.getState().history.past).toEqual([]);
});
