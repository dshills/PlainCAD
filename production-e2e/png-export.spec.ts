import { test, expect } from "@playwright/test";
import { inspectPngDownload } from "../e2e/pngDownload";

test("production CSP permits native viewer and dimensioned SVG PNG downloads", async ({ page }, info) => {
  const errors: string[] = [], violations: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("pngCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => {
    void (window as unknown as { pngCspViolation(directive: string): Promise<void> }).pngCspViolation(event.effectiveDirective);
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project view PNG", exact: true }).click();
  await inspectPngDownload(page, await download, info.outputPath("production-project.png"));
  await page.locator(".body-row").getByRole("button", { name: "Box Extrude", exact: true }).click();
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected part PNG", exact: true }).click();
  await inspectPngDownload(page, await download, info.outputPath("production-part.png"));
  await page.getByRole("button", { name: /^Box Base XY plane/ }).click();
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  await expect(page.getByRole("group", { name: "Sketch drawing canvas", exact: true }).locator(".canvas-dimensions text")).not.toHaveCount(0);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sketch PNG", exact: true }).last().click();
  await inspectPngDownload(page, await download, info.outputPath("production-sketch.png"));
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});
