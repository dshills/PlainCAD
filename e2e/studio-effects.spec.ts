import { expect, test, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { inspectPngDownload } from "./pngDownload";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}

test("Render effects add real shadow and occlusion pixels and reuse the shadow mask during camera changes", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && message.text().includes("Shader Error")) errors.push(message.text()); });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("docs/examples/orbit-drive-housing.pcaddoc");
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await expect.poll(async () => (await viewer(page)).meshes.length).toBe(1);
  const before = await aiSnapshot(page);
  expect(before.result?.meshes[0].geometryAssertions?.valid).toBe(true);
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  const studio = page.getByRole("complementary", { name: "Product photo studio" });
  const occlusion = studio.getByRole("checkbox", { name: "Ambient occlusion" });
  const shadow = studio.getByRole("checkbox", { name: "Ground shadow" });
  await expect(occlusion).toBeChecked();
  await expect(shadow).toBeChecked();
  await expect.poll(async () => (await viewer(page)).studioEffects).toMatchObject({ ambientOcclusion: true, groundShadow: true });
  const settled = await viewer(page);
  expect(settled.studioEffects!.occlusionWidth).toBeLessThanOrEqual(720);
  expect(settled.studioEffects!.occlusionHeight).toBeLessThanOrEqual(720);

  // Wheel input restores effects after the sharp frame without adding a new
  // animation loop. Zoom changes the AO view but preserves the ground mask.
  const box = await page.getByLabel("3D modeling canvas").boundingBox();
  if (!box) throw new Error("Expected a visible viewport.");
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  await page.mouse.wheel(0, 80);
  await expect.poll(async () => (await viewer(page)).studioEffects!.occlusionRenders).toBeGreaterThan(settled.studioEffects!.occlusionRenders);
  await expect.poll(async () => (await viewer(page)).performance?.scheduled).toBe(false);
  const restored = await viewer(page);
  expect(restored.studioEffects).toMatchObject({ ambientOcclusion: true, groundShadow: true, shadowRenders: settled.studioEffects!.shadowRenders });
  await page.waitForTimeout(250);
  expect((await viewer(page)).performance?.frameCount).toBe(restored.performance?.frameCount);

  await studio.getByRole("button", { name: "Hero", exact: true }).click();
  const capture = async (name: string) => {
    const promise = page.waitForEvent("download");
    await studio.getByRole("button", { name: "Download studio PNG", exact: true }).click();
    return (await inspectPngDownload(page, await promise, info.outputPath(name))).bytes;
  };
  const full = await capture("studio-effects.png");
  await occlusion.click();
  await expect(occlusion).not.toBeChecked();
  const shadowOnly = await capture("studio-shadow.png");
  await shadow.click();
  await expect(shadow).not.toBeChecked();
  const base = await capture("studio-base.png");
  expect(full.equals(shadowOnly)).toBe(false);
  expect(shadowOnly.equals(base)).toBe(false);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(before.document);
  expect(after.result).toEqual(before.result);
  expect(after.past).toBe(before.past);
  await page.getByRole("button", { name: "Model view", exact: true }).click();
  await expect.poll(async () => (await viewer(page)).studioEffects).toMatchObject({ ambientOcclusion: false, groundShadow: false });
  expect(errors).toEqual([]);
});
