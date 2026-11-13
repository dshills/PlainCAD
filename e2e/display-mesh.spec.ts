import { expect, test, type Page } from "@playwright/test";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
import { inspectPngDownload } from "./pngDownload";
import { aiSnapshot } from "./aiAcceptanceHelpers";

const orbitFile = "docs/examples/orbit-drive-housing.pcaddoc";
const leadFile = "docs/examples/11-trapezoidal-lead-screw.pcaddoc";

function view(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const modulePath = "/src/viewer/viewerDiagnostics.ts";
    return (await import(modulePath)).inspectViewer();
  });
}

test("zoomed native display uses finer triangles without replacing the pick geometry or issuing another rebuild", async ({ page }, info) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(orbitFile);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect.poll(async () => (await view(page))?.meshes.length).toBe(1);
  const accepted = await aiSnapshot(page);
  const first = await view(page);
  expect(first.displayDetail).toBeUndefined();
  const canvas = page.getByLabel("3D modeling canvas", { exact: true });
  await canvas.hover();
  await page.mouse.wheel(0, -1300);
  await expect.poll(async () => (await view(page)).displayDetail?.status, { timeout: 25000 }).toBe("ready");
  const sharp = await view(page);
  expect(sharp.displayDetail!.triangles).toBeGreaterThan(first.meshes[0].indices.length / 3);
  expect(sharp.performance!.triangles).toBe(sharp.displayDetail!.triangles);
  expect(sharp.meshes[0].geometryId).toBe(first.meshes[0].geometryId);
  expect(sharp.meshes[0].positions).toEqual(first.meshes[0].positions);
  expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions).toEqual(accepted.result?.meshes[0].geometryAssertions);

  const download = page.waitForEvent("download");
  await page.evaluate(async () => {
    const api = window.plaincadCommands;
    const snapshot = await api.execute({ command: "runtime.snapshot" });
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    const saved = await api.execute({ command: "file.exportProjectPng", session: (snapshot.value as { session: number }).session });
    if (!saved.ok) throw new Error(saved.error.message);
  });
  await inspectPngDownload(page, await download, info.outputPath("orbit-close-up.png"));
  expect((await view(page)).meshes[0].geometryId).toBe(first.meshes[0].geometryId);

  await page.locator('input[type="file"]').setInputFiles(leadFile);
  await expect.poll(async () => (await aiSnapshot(page)).document.name).toBe("Trapezoidal lead screw and nut");
  await expect.poll(async () => (await view(page)).displayDetail).toBeUndefined();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded", { timeout: 40000 });
  await expect.poll(async () => (await view(page))?.meshes.length).toBe(2);
});
