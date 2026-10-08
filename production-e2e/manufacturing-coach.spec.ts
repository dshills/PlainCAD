import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";

test("built CNC coach applies a verified native hole correction under production CSP", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const violations: string[] = [];
  await page.exposeFunction("coachCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => {
    void (window as unknown as { coachCspViolation: (directive: string) => Promise<void> }).coachCspViolation(event.violatedDirective);
  }));
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v13.pcaddoc");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
  await palette.getByLabel("Filter commands").fill("Manufacturing coach");
  await palette.getByRole("button", { name: /^Manufacturing coach/ }).click();
  const dialog = page.getByRole("dialog", { name: "Manufacturing coach", exact: true });
  await dialog.getByLabel("Process").selectOption("cnc");
  await dialog.getByText("Screening thresholds", { exact: true }).click();
  await dialog.getByLabel("Tool diameter (mm)").fill("4");
  await dialog.getByRole("button", { name: "Hole smaller than selected tool", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Native correction ready" })).toBeVisible();
  await dialog.getByRole("button", { name: "Apply manufacturing correction" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  // Export enablement requires a successful rebuild matching the edited document.
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const filename = info.outputPath("coached.stl"); await (await exporting).saveAs(filename);
  const volume = stlSignedVolume(await readFile(filename)), expected = 1000 - 20 * Math.PI;
  // STL circles are polygonal; the development test also checks exact BRep volume.
  expect(Math.abs(volume - expected) / expected).toBeLessThan(0.001);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});
