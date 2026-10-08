import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { inspectPngDownload } from "./pngDownload";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

test.use({ deviceScaleFactor: 2 });
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}
async function command(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const path = "/src/ui/commands/commandRegistry.ts";
    await (await import(path)).runCommand(id);
  }, id);
}
async function ready(page: Page) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
    expect(state.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeGreaterThan(0);
    expect((await viewer(page)).meshes).toHaveLength(1);
  }).toPass();
}

test("native Render keeps geometry/camera/visibility, hides overlays, idles without frames and exports full-resolution matching PNG", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("docs/examples/orbit-drive-housing.pcaddoc");
  await ready(page);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", { useCadStore } = await import(path), state = useCadStore.getState();
    state.select({ kind: "body", id: state.rebuild.result.meshes[0].bodyId, documentId: state.history.present.id });
  });
  const original = await aiSnapshot(page), model = await viewer(page);
  const hidden = await page.evaluate(async () => {
    const path = "/src/state/viewerState.ts", state = (await import(path)).useViewerState.getState();
    return { hiddenBodyIds: state.hiddenBodyIds, hiddenComponentIds: state.hiddenComponentIds, hiddenSketchIds: state.hiddenSketchIds };
  });
  await command(page, "view.toggleGrid");
  await command(page, "view.toggleModelEdges");
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Render view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(async () => {
    const render = await viewer(page);
    expect(render.presentation).toEqual({ mode: "render", gridVisible: false, axesVisible: false, sketchVisible: false, measurementVisible: false, lights: 4, shadowMaps: false });
    expect(render.meshes[0]).toMatchObject({ bodyId: model.meshes[0].bodyId, geometryId: model.meshes[0].geometryId, positions: model.meshes[0].positions, normals: model.meshes[0].normals, indices: model.meshes[0].indices, visible: true, highlighted: false, appearance: { roughness: 0.32, metalness: 0.22, flatShading: false } });
    for (let axis = 0; axis < 3; axis++) {
      expect(render.cameraPosition[axis]).toBeCloseTo(model.cameraPosition[axis], 8);
      expect(render.cameraTarget[axis]).toBeCloseTo(model.cameraTarget[axis], 8);
    }
    expect(render.cameraUp).toEqual(model.cameraUp);
    expect(render.performance?.drawCalls).toBeLessThan(model.performance!.drawCalls);
    expect(render.performance?.scheduled).toBe(false);
  }).toPass();
  await expect(page.getByRole("group", { name: "Solid driving dimensions" })).toHaveCount(0);
  const settled = await viewer(page);
  await page.waitForTimeout(400);
  expect((await viewer(page)).performance?.frameCount).toBe(settled.performance?.frameCount);
  let download = page.waitForEvent("download");
  await command(page, "file.exportProjectPng");
  const project = await inspectPngDownload(page, await download, info.outputPath("render-project.png"));
  expect(project.pixels.width).toBe(settled.performance!.bufferWidth);
  expect(project.pixels.height).toBe(settled.performance!.bufferHeight);
  download = page.waitForEvent("download");
  await command(page, "file.exportBodyPng");
  await inspectPngDownload(page, await download, info.outputPath("render-part.png"));
  expect((await viewer(page)).presentation).toEqual(settled.presentation);
  const restored = await viewer(page);
  for (let axis = 0; axis < 3; axis++) expect(restored.cameraPosition[axis]).toBeCloseTo(model.cameraPosition[axis], 8);
  await command(page, "view.toggleGrid");
  await command(page, "view.toggleModelEdges");
  await expect.poll(async () => (await viewer(page)).presentation?.gridVisible).toBe(true);
  await expect.poll(async () => (await viewer(page)).performance?.showModelEdges).toBe(true);
  await page.getByRole("button", { name: "Model view", exact: true }).click();
  await expect.poll(async () => (await viewer(page)).presentation?.gridVisible).toBe(false);
  await expect.poll(async () => (await viewer(page)).performance?.showModelEdges).toBe(false);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await expect.poll(async () => (await viewer(page)).presentation?.gridVisible).toBe(true);
  await expect.poll(async () => (await viewer(page)).performance?.showModelEdges).toBe(true);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(original.document);
  expect(after.result).toEqual(original.result);
  expect(after.past).toBe(original.past);
  expect(await page.evaluate(async () => {
    const path = "/src/state/viewerState.ts", state = (await import(path)).useViewerState.getState();
    return { hiddenBodyIds: state.hiddenBodyIds, hiddenComponentIds: state.hiddenComponentIds, hiddenSketchIds: state.hiddenSketchIds };
  })).toEqual(hidden);
  await page.locator('input[type="file"]').setInputFiles("docs/examples/orbit-drive-housing.pcaddoc");
  await ready(page);
  await expect(page.getByRole("button", { name: "Model view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await viewer(page)).presentation?.gridVisible).toBe(true);
  expect(errors).toEqual([]);
});


test("Render survives a native parameter rebuild and sharp PNG during motion, then save/open restores Model with unchanged STL geometry", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  const before = await viewer(page);
  const hitPoint = await page.evaluate(async () => {
    const diagnostics = "/src/viewer/viewerDiagnostics.ts", store = "/src/state/useCadStore.ts";
    (await import(store)).useCadStore.getState().select(undefined);
    return (await import(diagnostics)).projectViewerPoint([10, -5, 20]);
  });
  const pickCanvas = (await page.locator(".viewer-canvas canvas").first().boundingBox())!;
  await page.mouse.click(pickCanvas.x + hitPoint!.x, pickCanvas.y + hitPoint!.y);
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().selection.selectedIds[0];
  })).toMatchObject({ kind: "body", id: before.meshes[0].bodyId });
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateParameter("width", { expression: "90mm" });
  });
  await expect(async () => {
    const state = await aiSnapshot(page), rebuilt = await viewer(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
    expect(state.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(90000, 5);
    expect(rebuilt.meshes[0].geometryId).not.toBe(before.meshes[0].geometryId);
    expect(rebuilt.meshes[0].bodyId).toBe(before.meshes[0].bodyId);
    expect(before.meshes[0].appearance?.color).toBeDefined();
    expect(rebuilt.meshes[0].appearance).toEqual({ roughness: 0.32, metalness: 0.22, flatShading: false, color: before.meshes[0].appearance?.color });
    expect(rebuilt.meshes[0].positions).toEqual(Array.from(new Float32Array(Array.from(state.result!.meshes[0].positions))));
    expect(rebuilt.presentation?.mode).toBe("render");
  }).toPass();
  const sharp = await viewer(page), canvas = page.locator(".viewer-canvas canvas").first(), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 });
  await expect.poll(async () => (await viewer(page)).performance?.pixelRatio).toBe(1);
  let download = page.waitForEvent("download");
  await command(page, "file.exportProjectPng");
  const png = await inspectPngDownload(page, await download, info.outputPath("render-sharp-during-motion.png"));
  expect(png.pixels.width).toBe(sharp.performance!.bufferWidth);
  expect(png.pixels.height).toBe(sharp.performance!.bufferHeight);
  expect((await viewer(page)).performance?.pixelRatio).toBe(1);
  await page.mouse.up();
  await expect.poll(async () => (await viewer(page)).performance?.moving).toBe(false);
  await expect.poll(async () => (await viewer(page)).performance?.pixelRatio).toBe(2);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = await download;
  await saved.saveAs(info.outputPath("render-edited.pcaddoc"));
  await page.locator('input[type="file"]').setInputFiles(info.outputPath("render-edited.pcaddoc"));
  await ready(page);
  await expect(page.getByRole("button", { name: "Model view", exact: true })).toHaveAttribute("aria-pressed", "true");
  download = page.waitForEvent("download");
  await command(page, "file.exportStl");
  const stl = await download;
  await stl.saveAs(info.outputPath("render-edited.stl"));
  expect(stlSignedVolume(await readFile(info.outputPath("render-edited.stl")))).toBeCloseTo(90000, 3);
});
