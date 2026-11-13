import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { inspectPngDownload } from "./pngDownload";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}
async function ready(page: Page, volume: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(state.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(volume, 5);
    expect((await viewer(page)).meshes).toHaveLength(1);
  }).toPass({ timeout: 30000 });
}
async function idle(page: Page) {
  await expect.poll(async () => (await viewer(page)).performance?.scheduled).toBe(false);
  const settled = await viewer(page);
  expect(settled.performance?.frameCount).toEqual(expect.any(Number));
  await page.evaluate(() => new Promise<void>((resolve) => {
    let remaining = 8;
    const frame = () => {
      if (--remaining === 0) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  expect((await viewer(page)).performance?.frameCount).toBe(settled.performance?.frameCount);
  return settled;
}

test("render status tracks studio loading and fine detail without blocking viewport controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const lighting = (url: URL) => url.pathname.endsWith("/studioEnvironment.ts");
  const detail = (url: URL) => url.pathname.includes("extrudePreviewWorker") && url.searchParams.has("worker_file");
  let releaseLighting!: () => void, releaseDetail!: () => void;
  const lightingGate = new Promise<void>(resolve => { releaseLighting = resolve; });
  const detailGate = new Promise<void>(resolve => { releaseDetail = resolve; });
  await page.route(lighting, async route => { await lightingGate; await route.continue(); });
  await page.route(detail, async route => { await detailGate; await route.abort(); });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
    await ready(page, 80000);
    const render = page.getByRole("button", { name: "Render view", exact: true });
    const model = page.getByRole("button", { name: "Model view", exact: true });
    const status = page.locator(".viewer-render-status[role='status']");
    await expect(status).toBeEmpty();
    await render.click();
    await expect(status).toHaveText("Preparing studio render…");
    expect(await status.evaluate(node => getComputedStyle(node, "::before").animationName)).toBe("none");
    await model.click();
    await expect(status).toBeEmpty();
    await render.click();
    await expect(status).toHaveText("Preparing studio render…");
    releaseLighting();
    await expect(status).toBeEmpty();
    await expect.poll(async () => (await viewer(page)).studioLighting?.ready).toBe(true);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByLabel("3D modeling canvas", { exact: true }).hover();
    await page.mouse.wheel(0, -1300);
    await expect(status).toHaveText("Rendering fine detail…");
    expect(await status.evaluate(node => getComputedStyle(node, "::before").animationName)).toBe("viewer-render-spin");
    await expect(status).toHaveCSS("pointer-events", "none");
    releaseDetail();
    await expect(status).toBeEmpty();
    await expect.poll(async () => (await viewer(page)).displayDetail?.status).toBe("unavailable");
    expect((await viewer(page)).meshes).toHaveLength(1);
    await idle(page);
  } finally {
    releaseLighting();
    releaseDetail();
  }
});

test("studio finishes/backdrops reuse native buffers, preserve history and camera, export actual pixels, and reset on reopen", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await ready(page, 80000);
  const model = await idle(page), before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await page.getByLabel("Studio finish", { exact: true }).selectOption("metal");
  await expect.poll(async () => (await viewer(page)).meshes[0].appearance?.metalness).toBe(0.65);
  await page.getByLabel("Studio backdrop", { exact: true }).selectOption("warm");
  await expect.poll(async () => (await viewer(page)).background).toBe("e8dfcf");
  await expect.poll(async () => (await viewer(page)).studioLighting).toMatchObject({ environment: "softbox", ready: true, toneMapped: true });
  await expect.poll(async () => (await viewer(page)).studioEffects).toMatchObject({ ambientOcclusion: true, groundShadow: true });
  const metal = await idle(page);
  expect(metal.meshes[0]).toMatchObject({ geometryId: model.meshes[0].geometryId, positions: model.meshes[0].positions, normals: model.meshes[0].normals, indices: model.meshes[0].indices, appearance: { roughness: 0.48, metalness: 0.65, color: "bbc4cc" } });
  metal.cameraPosition.forEach((value, axis) => expect(value).toBeCloseTo(model.cameraPosition[axis], 8));
  expect(metal.cameraTarget).toEqual(model.cameraTarget);
  const metalDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download studio PNG", exact: true }).click();
  const metalPng = await inspectPngDownload(page, await metalDownload, info.outputPath("studio-metal-warm.png"));
  expect(metalPng.pixels.width).toBe(metal.performance?.bufferWidth);
  expect(metalPng.pixels.height).toBe(metal.performance?.bufferHeight);
  const corner = await page.evaluate(async (src) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Studio PNG could not be decoded"));
      image.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, `data:image/png;base64,${metalPng.bytes.toString("base64")}`);
  expect(corner).toEqual([232, 223, 207, 255]);
  // The first export can allocate a cached fine mesh. Compare resource counts
  // after capture has warmed both that mesh and the studio effect targets.
  const resources = (await idle(page)).resources;
  await page.getByLabel("Studio finish", { exact: true }).selectOption("powder");
  await expect.poll(async () => (await viewer(page)).meshes[0].appearance?.roughness).toBe(0.85);
  await page.getByLabel("Studio backdrop", { exact: true }).selectOption("dark");
  await expect.poll(async () => (await viewer(page)).background).toBe("171d29");
  const powder = await idle(page);
  expect(powder.meshes[0].geometryId).toBe(metal.meshes[0].geometryId);
  expect(powder.meshes[0].appearance?.color).toBe(model.meshes[0].appearance?.color);
  expect(powder.resources.geometries).toBe(resources.geometries);
  expect(powder.resources.textures).toBe(resources.textures);
  const powderDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download studio PNG", exact: true }).click();
  const powderPng = await inspectPngDownload(page, await powderDownload, info.outputPath("studio-powder-midnight.png"));
  expect(powderPng.bytes.equals(metalPng.bytes)).toBe(false);
  const afterExport = (await idle(page)).resources;
  expect(afterExport.geometries).toBe(resources.geometries);
  expect(afterExport.textures).toBe(resources.textures);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(before.document);
  expect(after.result).toEqual(before.result);
  expect(after.past).toBe(before.past);
  await page.getByRole("button", { name: "Model view", exact: true }).click();
  await expect.poll(async () => (await viewer(page)).background).toBe(model.background);
  await expect.poll(async () => (await viewer(page)).studioLighting).toMatchObject({ ready: false, toneMapped: false });
  await expect.poll(async () => (await viewer(page)).meshes[0].appearance).toEqual(model.meshes[0].appearance);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await expect(page.getByLabel("Studio finish")).toHaveValue("powder");
  await expect(page.getByLabel("Studio backdrop")).toHaveValue("dark");
  await page.screenshot({ path: info.outputPath("studio-controls.png") });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = await download, path = info.outputPath("studio.pcaddoc");
  await saved.saveAs(path);
  expect(await readFile(path, "utf8")).not.toMatch(/studioMaterial|studioBackdrop|metalness|roughness/);
  const savedSession = (await aiSnapshot(page)).session;
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(savedSession);
  await ready(page, 80000);
  await expect(page.getByRole("button", { name: "Model view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await expect(page.getByLabel("Studio finish")).toHaveValue("original");
  await expect(page.getByLabel("Studio backdrop")).toHaveValue("theme");
  expect(errors).toEqual([]);
});

test("studio camera compositions follow CAD axes, retain finishes on actual rebuilds and reject stale controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await ready(page, 80000);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await page.getByLabel("Studio finish").selectOption("metal");
  await expect.poll(async () => (await viewer(page)).meshes[0].appearance?.metalness).toBe(0.65);
  await expect.poll(async () => (await viewer(page)).studioLighting?.ready).toBe(true);
  await expect.poll(async () => (await viewer(page)).studioEffects).toMatchObject({ ambientOcclusion: true, groundShadow: true });
  const original = await idle(page);
  const studio = page.getByRole("group", { name: "Studio camera compositions" });
  for (const [name, direction] of [["Top", [0, 0, 1]], ["Front", [0, -1, 0]], ["Right", [1, 0, 0]], ["Hero", [1, -1, 1]]] as const) {
    await studio.getByRole("button", { name, exact: true }).click();
    await expect(async () => {
      const view = await viewer(page);
      const delta = view.cameraPosition.map((value, axis) => value - view.cameraTarget[axis]);
      const length = Math.hypot(...delta), expected = Math.hypot(...direction);
      delta.forEach((value, axis) => expect(value / length).toBeCloseTo(direction[axis] / expected, 6));
      expect(view.meshes[0].geometryId).toBe(original.meshes[0].geometryId);
      expect(view.performance?.scheduled).toBe(false);
    }).toPass();
  }
  const accepted = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts", studioPath = "/src/ui/commands/studioCommand.ts";
    const store = (await import(storePath)).useCadStore;
    const captured = store.getState();
    const input = { session: captured.documentSession, documentId: captured.history.present.id, material: "powder" };
    store.getState().updateParameter("width", { expression: "90mm" });
    return (await import(studioPath)).setStudioAppearance(input, captured);
  });
  expect(accepted).toBe(false);
  await ready(page, 90000);
  await expect(async () => {
    const rebuilt = await viewer(page);
    expect(rebuilt.meshes[0].geometryId).not.toBe(original.meshes[0].geometryId);
    expect(rebuilt.meshes[0].bodyId).toBe(original.meshes[0].bodyId);
    expect(rebuilt.meshes[0].appearance).toMatchObject({ roughness: 0.48, metalness: 0.65, color: "bbc4cc" });
    expect(rebuilt.presentation?.shadowMaps).toBe(false);
    expect(rebuilt.resources.textures).toBe(original.resources.textures);
  }).toPass();
  await idle(page);
});

test("compact Saturn studio is keyboard operable and collapsible under reduced motion", async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("plaincad.workspace.v1", JSON.stringify({ version: 1, layout: "workbench", pins: [] }));
    localStorage.setItem("plaincad.ui.theme", "saturn");
  });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator(".file-menu > summary").click();
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await ready(page, 80000);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  const studio = page.getByRole("complementary", { name: "Product photo studio" });
  await expect(studio).toBeVisible();
  const finish = studio.getByLabel("Studio finish");
  await finish.selectOption("metal");
  await finish.focus();
  await page.keyboard.press("Tab");
  await expect(studio.getByLabel("Studio backdrop")).toBeFocused();
  await expect(finish).toHaveValue("metal");
  await expect.poll(async () => (await viewer(page)).meshes[0].appearance?.metalness).toBe(0.65);
  await studio.getByRole("button", { name: "Top", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(async () => {
    const view = await viewer(page);
    expect(view.cameraPosition[0]).toBeCloseTo(view.cameraTarget[0], 6);
    expect(view.cameraPosition[1]).toBeCloseTo(view.cameraTarget[1], 6);
    expect(view.cameraPosition[2]).toBeGreaterThan(view.cameraTarget[2]);
  }).toPass();
  const bounds = await studio.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Photo studio must be visible.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: info.outputPath("studio-compact-saturn.png") });
  const summary = studio.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(finish).toBeHidden();
  await expect(summary).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(finish).toBeVisible();
  await idle(page);
});
