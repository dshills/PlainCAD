import { expect, test } from "@playwright/test";
import { inspectPngDownload } from "../e2e/pngDownload";
import type { Page } from "@playwright/test";

async function corner(page: Page, bytes: Buffer) {
  return page.evaluate(async (src) => {
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
  }, `data:image/png;base64,${bytes.toString("base64")}`);
}

test("built studio lazy controls and real material/backdrop PNG export work under CSP", async ({ page }, info) => {
  const violations: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("studioCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => {
    void (window as unknown as { studioCspViolation(directive: string): Promise<void> }).studioCspViolation(event.effectiveDirective);
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await page.getByLabel("Studio finish").selectOption("metal");
  await page.getByLabel("Studio backdrop").selectOption("warm");
  await expect(page.getByLabel("Studio finish")).toHaveValue("metal");
  await expect(page.getByLabel("Studio backdrop")).toHaveValue("warm");
  await page.getByRole("group", { name: "Studio camera compositions" }).getByRole("button", { name: "Hero", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download studio PNG", exact: true }).click();
  const warm = await inspectPngDownload(page, await download, info.outputPath("studio-production-warm.png"));
  expect(await corner(page, warm.bytes)).toEqual([232, 223, 207, 255]);
  // Isolate material changes: same camera and backdrop, different actual model
  // pixels. The later dark-backdrop check cannot mask an unapplied finish.
  await page.getByLabel("Studio finish").selectOption("powder");
  await expect(page.getByLabel("Studio finish")).toHaveValue("powder");
  const finishDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download studio PNG", exact: true }).click();
  const powder = await inspectPngDownload(page, await finishDownload, info.outputPath("studio-production-powder-warm.png"));
  expect(await corner(page, powder.bytes)).toEqual([232, 223, 207, 255]);
  expect(powder.bytes.equals(warm.bytes)).toBe(false);
  await page.getByLabel("Studio backdrop").selectOption("dark");
  await expect(page.getByLabel("Studio backdrop")).toHaveValue("dark");
  const second = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download studio PNG", exact: true }).click();
  const dark = await inspectPngDownload(page, await second, info.outputPath("studio-production-dark.png"));
  expect(await corner(page, dark.bytes)).toEqual([23, 29, 41, 255]);
  expect(dark.bytes.equals(warm.bytes)).toBe(false);
  await page.getByRole("button", { name: "Model view", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Product photo studio" })).toHaveCount(0);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
