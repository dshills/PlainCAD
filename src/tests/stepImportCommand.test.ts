import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createBoxMesh } from "../cad/kernel/meshConversion";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { clearAiFacePicking, useAiFacePicking } from "../state/aiFacePicking";
import { useCadStore } from "../state/useCadStore";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
import { applyStepImport, beginStepImport, cancelStepImport } from "../ui/commands/stepImportCommand";
import { useStepImport } from "../ui/commands/stepImportState";

vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));

afterEach(() => {
  cancelStepImport();
  clearAiFacePicking();
  useCadStore.setState(useCadStore.getInitialState());
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("uses proven reader availability and shares the AI face-pick guard for opening and applying STEP", async () => {
  vi.stubGlobal("Worker", class {});
  const document = createEmptyDocument("STEP import task"), session = 11, componentId = document.rootComponentId;
  const result = { documentId: document.id, success: true, bodies: [], meshes: [], errors: [], warnings: [], durationMs: 0 };
  useCadStore.setState({ documentSession: session, activeComponentId: componentId,
    history: { present: document, past: [], future: [] },
    rebuild: { status: "succeeded", kernelReady: true, result: { ...result, stepImportAvailable: false } } });
  const current = useCadStore.getState;
  const enabled = () => selectCommandEnablement(current());
  expect(enabled().importStep).toBe(false);
  const nativeResult = { ...result, stepImportAvailable: true };
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: nativeResult } });
  expect(enabled().importStep).toBe(true);

  const facePick = { document, session, componentId, result: nativeResult };
  useAiFacePicking.setState({ frame: facePick });
  expect(enabled().importStep).toBe(false);
  await expect(beginStepImport(undefined, current())).rejects.toThrow(/finish other tasks/);
  expect(useAiFacePicking.getState().frame).toBe(facePick);
  clearAiFacePicking();

  vi.mocked(previewModeling).mockImplementation(async candidate => {
    const feature = candidate.features.at(-1)!;
    const mesh = createBoxMesh(`body:${feature.id}`, 20, 10, 8);
    return { ...nativeResult, meshes: [{ ...mesh, geometrySource: "opencascade", kernelOperation: "stepImport",
      geometryAssertions: { valid: true, solidCount: 1, volume: 1600, surfaceArea: 880 } }] };
  });
  const source: string = JSON.parse(readFileSync("src/persistence/fixtures/schema-v21.pcaddoc", "utf8")).features[0].stepSource;
  await beginStepImport({ name: "test.step", size: source.length, text: async () => source } as File, current());
  const staged = useStepImport.getState().frame!;
  expect(enabled().applyStepImport).toBe(true);
  useAiFacePicking.setState({ frame: facePick });
  expect(enabled().applyStepImport).toBe(false);
  expect(() => applyStepImport(staged)).toThrow(/current validated STEP preview/);
  expect(current().history.present).toBe(document);
  clearAiFacePicking();
  expect(() => applyStepImport({ ...staged })).toThrow(/current validated STEP preview/);
  expect(current().history.past).toEqual([]);
});
