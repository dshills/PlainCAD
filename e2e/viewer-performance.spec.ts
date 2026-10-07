import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { inspectPngDownload } from "./pngDownload";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

test.use({ deviceScaleFactor: 2 });
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).inspectViewer(); });
}
async function ready(page: Page, name: string, count: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.document.name).toBe(name);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.meshes).toHaveLength(count);
    for (const mesh of state.result!.meshes) {
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(mesh.geometryAssertions!.volume).toBeGreaterThan(0);
    }
  }).toPass();
  await expect.poll(async () => (await viewer(page)).meshes.length).toBe(count);
}


async function observeQualityRestoration(page: Page, event: "pointerup" | "wheel") {
  await page.evaluate(async (event) => {
    const path = "/src/viewer/viewerDiagnostics.ts", { inspectViewer } = await import(path);
    const canvas = document.querySelector<HTMLCanvasElement>(".viewer-canvas canvas")!;
    delete canvas.dataset.restoreMs;
    delete canvas.dataset.inputPixelRatio;
    canvas.addEventListener(event, () => {
      const started = performance.now();
      canvas.dataset.inputPixelRatio = String(inspectViewer()?.performance?.pixelRatio);
      function sample() {
        const state = inspectViewer()?.performance;
        const elapsed = performance.now() - started;
        if ((state && !state.moving && state.pixelRatio === 2) || elapsed >= 1000) canvas.dataset.restoreMs = String(elapsed);
        else requestAnimationFrame(sample);
      }
      sample();
    }, { once: true });
  }, event);
}
async function restoredQualityDelay(page: Page) {
  const canvas = page.locator(".viewer-canvas canvas").first();
  await expect.poll(() => canvas.getAttribute("data-restore-ms"), { timeout: 2000, intervals: [20] }).not.toBeNull();
  const elapsed = Number(await canvas.getAttribute("data-restore-ms"));
  expect(elapsed).toBeLessThan(500);
  return elapsed;
}

test("native ORBIT orbit/zoom uses reduced resolution and edge passes, restores detail promptly and exports full-resolution PNG during a gesture", async ({ page }, info) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("docs/examples/orbit-drive-housing.pcaddoc");
  await ready(page, "ORBIT drive housing", 1);
  const original = await aiSnapshot(page), settled = await viewer(page);
  expect(settled.performance).toMatchObject({ pixelRatio: 2, sharpPixelRatio: 2, moving: false, showModelEdges: true });
  const canvas = page.locator(".viewer-canvas canvas").first(), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await expect.poll(async () => (await viewer(page)).performance?.pixelRatio).toBe(1);
  await expect.poll(async () => (await viewer(page)).performance?.drawCalls).toBeLessThan(settled.performance!.drawCalls);
  const moving = await viewer(page);
  expect(moving.performance?.showModelEdges).toBe(false);
  expect(moving.performance!.bufferWidth).toBe(Math.floor(settled.performance!.bufferWidth / 2));
  expect(moving.performance!.bufferHeight).toBe(Math.floor(settled.performance!.bufferHeight / 2));
  expect(moving.meshes[0].geometryId).toBe(settled.meshes[0].geometryId);
  const download = page.waitForEvent("download");
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("file.exportProjectPng"); });
  const png = await inspectPngDownload(page, await download, info.outputPath("orbit-sharp-during-motion.png"));
  expect(png.pixels.width).toBe(settled.performance!.bufferWidth);
  expect(png.pixels.height).toBe(settled.performance!.bufferHeight);
  expect((await viewer(page)).performance?.pixelRatio).toBe(1);
  await observeQualityRestoration(page, "pointerup");
  await page.mouse.up();
  const restoreMs = await restoredQualityDelay(page);
  const sharp = await viewer(page);
  expect(sharp.performance?.pixelRatio).toBe(2);
  expect(sharp.performance?.showModelEdges).toBe(true);
  // Keep wheel input on canvas, away from the solid labels that an orbit click may reveal.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await observeQualityRestoration(page, "wheel");
  await page.mouse.wheel(0, -120);
  const zoomRestoreMs = await restoredQualityDelay(page);
  await expect(canvas).toHaveAttribute("data-input-pixel-ratio", "1");
  await page.getByLabel("Show model edges", { exact: true }).uncheck();
  await expect.poll(async () => (await viewer(page)).performance?.showModelEdges).toBe(false);
  await expect.poll(async () => (await viewer(page)).performance?.drawCalls).toBeLessThan(sharp.performance!.drawCalls);
  await page.getByLabel("Optimize while moving", { exact: true }).uncheck();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 });
  expect((await viewer(page)).performance?.pixelRatio).toBe(2);
  await page.mouse.up();
  await expect.poll(async () => (await viewer(page)).performance?.moving).toBe(false);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(original.document);
  expect(after.past).toBe(original.past);
  expect(after.result).toEqual(original.result);
  await writeFile(info.outputPath("viewer-performance.json"), JSON.stringify({ settled: settled.performance, moving: moving.performance, sharp: sharp.performance, restoreMs, zoomRestoreMs }, null, 2));
  await page.screenshot({ path: info.outputPath("orbit-shaded.png"), fullPage: true });
});

test("40 native fixture bodies reuse unchanged GPU buffers through an edit, Undo and same-ID reopen", async ({ page }, info) => {
  await page.goto("/");
  const file = "docs/examples/10-rotary-fixture.pcaddoc";
  await page.locator('input[type="file"]').setInputFiles(file);
  await ready(page, "Rotary machining fixture concept", 40);
  const before = await aiSnapshot(page), initial = await viewer(page);
  await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; (await import(path)).useCadStore.getState().updateParameter("platter_thickness", { expression: "16mm" }); });
  await ready(page, before.document.name, 40);
  const edited = await aiSnapshot(page);
  expect(edited.document.parameters.platter_thickness.expression).toBe("16mm");
  const changed = edited.result!.meshes.filter((mesh) => JSON.stringify(mesh.positions) !== JSON.stringify(before.result!.meshes.find((previous) => previous.bodyId === mesh.bodyId)!.positions));
  expect(changed.length).toBeGreaterThan(0);
  expect(changed.length).toBeLessThan(40);
  await expect(async () => {
    const view = await viewer(page);
    for (const mesh of view.meshes) {
      const old = initial.meshes.find((previous) => previous.bodyId === mesh.bodyId)!;
      if (changed.some((candidate) => candidate.bodyId === mesh.bodyId)) expect(mesh.geometryId).not.toBe(old.geometryId);
      else expect(mesh.geometryId).toBe(old.geometryId);
      const native = edited.result!.meshes.find((candidate) => candidate.bodyId === mesh.bodyId)!;
      expect(mesh.positions).toEqual(Array.from(new Float32Array(native.positions)));
    }
  }).toPass();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, before.document.name, 40);
  expect((await aiSnapshot(page)).result?.meshes).toEqual(before.result!.meshes);
  await page.getByLabel("Show model edges", { exact: true }).uncheck();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBe(before.session + 1);
  await ready(page, before.document.name, 40);
  await expect(page.getByLabel("Show model edges", { exact: true })).toBeChecked();
  await expect.poll(async () => (await viewer(page)).performance?.showModelEdges).toBe(true);
  expect((await aiSnapshot(page)).result?.meshes).toEqual(before.result!.meshes);
  await writeFile(info.outputPath("buffer-reuse.json"), JSON.stringify({ bodies: 40, changedBodies: changed.length, reusedBodies: 40 - changed.length }, null, 2));
});
