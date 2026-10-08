import { expect, test, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}
async function publish(page: Page): Promise<{ staged: import("../src/ui/commands/aiCommand").AiStaged; accepted: boolean; result: import("../src/cad/worker/workerProtocol").RebuildResult }> {
  return page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts", planPath = "/src/ai/buildPlan.ts", fixturePath = "/src/tests/fixtures/aiExpandedPlans.ts", aiPath = "/src/ui/commands/aiCommand.ts", previewPath = "/src/state/aiCanvasPreview.ts";
    const state = (await import(storePath)).useCadStore.getState();
    const plan = structuredClone((await import(fixturePath)).aiPolygonPlan);
    // Keep the proposal above the existing box, so both actual parts are visible.
    plan.steps[0].profile.vertices = [
      { x: "width - 40mm", y: "height + 15mm" },
      { x: "width - 20mm", y: "height + 15mm" },
      { x: "width - 40mm", y: "height + 25mm" },
    ];
    const staged = (await import(planPath)).buildAiPlan(state.history.present, plan);
    const { result } = await (await import(aiPath)).previewAiPlan(staged, new AbortController().signal);
    const accepted = (await import(previewPath)).publishAiCanvasPreview({ document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, selection: state.selection.selectedIds, beforeResult: state.rebuild.result, result, bodyIds: staged.bodyIds });
    return { staged, accepted, result };
  });
}

test("AI native proposal uses the main camera, preserves existing parts and history, compares, cancels, invalidates and applies real geometry", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(80000, 5);
  }).toPass({ timeout: 30000 });
  await expect.poll(async () => (await viewer(page)).performance?.scheduled).toBe(false);
  const before = await aiSnapshot(page), camera = await viewer(page);
  const first = await publish(page);
  expect(first.accepted).toBe(true);
  expect(first.result.meshes).toHaveLength(2);
  expect(first.result.meshes.every((mesh) => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid && mesh.geometryAssertions.solidCount === 1)).toBe(true);
  expect(first.result.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0)).toBeCloseTo(80500, 5);
  await expect.poll(async () => (await viewer(page)).aiPreview?.meshes.length).toBe(2);
  const shown = await viewer(page);
  shown.cameraPosition.forEach((value, axis) => expect(value).toBeCloseTo(camera.cameraPosition[axis], 10));
  shown.cameraTarget.forEach((value, axis) => expect(value).toBeCloseTo(camera.cameraTarget[axis], 10));
  shown.cameraUp.forEach((value, axis) => expect(value).toBeCloseTo(camera.cameraUp[axis], 10));
  expect(shown.aiPreview!.meshes.every((mesh) => mesh.visible)).toBe(true);
  await expect.poll(async () => (await viewer(page)).performance?.scheduled).toBe(false);
  const settledFrames = (await viewer(page)).performance!.frameCount;
  await page.evaluate(() => new Promise<void>((resolve) => {
    let remaining = 8;
    const frame = () => { if (--remaining === 0) resolve(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
  expect((await viewer(page)).performance!.frameCount).toBe(settledFrames);
  await page.screenshot({ path: info.outputPath("ai-native-main-canvas.png") });
  for (const original of camera.meshes)
    expect(shown.aiPreview!.meshes.find((mesh) => mesh.bodyId === original.bodyId)?.positions).toEqual(original.positions);
  const triangle = shown.aiPreview!.meshes.find((mesh) => first.staged.bodyIds.includes(mesh.bodyId))!;
  const ys = triangle.positions.filter((_value, index) => index % 3 === 1);
  expect(Math.min(...ys)).toBeCloseTo(-5, 6);
  expect(Math.max(...ys)).toBeCloseTo(0, 6);
  expect(shown.meshes[0].geometryId).toBe(camera.meshes[0].geometryId);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.evaluate(async () => {
    const path = "/src/state/aiCanvasPreview.ts";
    (await import(path)).useAiCanvasPreview.getState().setMode("before");
  });
  await expect.poll(async () => (await viewer(page)).aiPreview?.mode).toBe("before");
  const compared = await viewer(page);
  expect(compared.aiPreview!.meshes.map((mesh) => mesh.geometryId)).toEqual(shown.aiPreview!.meshes.map((mesh) => mesh.geometryId));
  const exportDiagnostic = await page.evaluate(async () => {
    const previewPath = "/src/state/aiCanvasPreview.ts", storePath = "/src/state/useCadStore.ts", pngPath = "/src/persistence/pngCapture.ts";
    const preview = await import(previewPath), state = (await import(storePath)).useCadStore.getState(), png = await import(pngPath);
    // Clear and capture in the same task, before React releases displayed proposal buffers.
    preview.clearAiCanvasPreview();
    try {
      await png.capturePng("viewer", { document: state.history.present, session: state.documentSession, result: state.rebuild.result });
      return "unexpected PNG export";
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(exportDiagnostic).toContain("Apply or cancel the AI preview before exporting PNG.");
  await expect.poll(async () => (await viewer(page)).aiPreview).toBeUndefined();
  expect((await viewer(page)).meshes[0].geometryId).toBe(camera.meshes[0].geometryId);
  (await viewer(page)).cameraPosition.forEach((value, axis) => expect(value).toBeCloseTo(camera.cameraPosition[axis], 10));
  await publish(page);
  await expect.poll(async () => (await viewer(page)).aiPreview?.meshes.length).toBe(2);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    state.select({ kind: "body", id: state.rebuild.result.meshes[0].bodyId, documentId: state.history.present.id });
  });
  await expect.poll(async () => (await viewer(page)).aiPreview).toBeUndefined();
  const final = await publish(page);
  await expect.poll(async () => (await viewer(page)).aiPreview?.meshes.length).toBe(2);
  await page.evaluate(async (staged) => {
    const storePath = "/src/state/useCadStore.ts", previewPath = "/src/state/aiCanvasPreview.ts", aiPath = "/src/ui/commands/aiCommand.ts";
    const state = (await import(storePath)).useCadStore.getState(), preview = (await import(previewPath)).useAiCanvasPreview.getState().preview;
    (await import(aiPath)).applyAiPlan({ document: state.history.present, session: state.documentSession, componentId: state.activeComponentId }, staged, preview.result);
  }, final.staged);
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result!.meshes).toHaveLength(2);
    expect(state.result!.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0)).toBeCloseTo(80500, 5);
    expect(state.past).toBe(before.past + 1);
    expect((await viewer(page)).aiPreview).toBeUndefined();
  }).toPass({ timeout: 30000 });
  expect(errors).toEqual([]);
});
