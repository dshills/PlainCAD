import { expect, test } from "@playwright/test";
import { workbenchTaskFixture } from "../e2e/workbenchTaskFixtures";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";
import { readFile } from "node:fs/promises";

test.use({ storageState: { cookies: [], origins: [] } });
test("built docked AI contains its input and preserves native geometry and draft under CSP", async ({ page }, info) => {
  const errors: string[] = [], violations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("canvasAiCsp", (directive: string) => violations.push(directive));
  await page.addInitScript(() => {
    const observer = window as unknown as { canvasAiCsp(directive: string): Promise<void>; canvasAiPending: Promise<void>[] };
    observer.canvasAiPending = [];
    document.addEventListener("securitypolicyviolation", event => {
      observer.canvasAiPending.push(observer.canvasAiCsp(event.effectiveDirective));
    });
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "Base.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workbenchTaskFixture("Extrude"))) });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.locator(".body-row")).toHaveCount(1);
  const canvas = page.locator(".model-view canvas"), bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  const prompt = page.getByLabel("What would you like to make?", { exact: true });
  await prompt.fill("Make a removable lid for this enclosure");
  expect(await prompt.evaluate(input => Boolean(input.closest("#workbench-ai.bottom-dock-body")))).toBe(true);
  const dock = await page.locator(".workbench-bottom").boundingBox(), model = await canvas.boundingBox();
  expect(dock!.y).toBeGreaterThanOrEqual(model!.y + model!.height - 1);
  const resizeHandle = page.getByRole("separator", { name: "Resize bottom dock" });
  const startHeight = Number(await resizeHandle.getAttribute("aria-valuenow"));
  await resizeHandle.press("Shift+ArrowUp");
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", String(startHeight + 32));
  await page.getByRole("button", { name: "Close AI assistant", exact: true }).click();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  await expect(prompt).toHaveValue("Make a removable lid for this enclosure");
  await page.getByRole("button", { name: "Close AI assistant", exact: true }).click();
  await page.locator(".file-menu > summary").click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const path = info.outputPath("unchanged-native-base.stl");
  await (await downloading).saveAs(path);
  expect(stlSignedVolume(await readFile(path))).toBeCloseTo(3072, 3);
  await expect(page.locator(".workbench-bottom")).not.toHaveClass(/expanded/);
  await page.evaluate(async () => {
    await Promise.all((window as unknown as { canvasAiPending: Promise<void>[] }).canvasAiPending);
  });
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});
