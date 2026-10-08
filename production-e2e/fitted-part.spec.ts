import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";
test("built fitted-part command validates native geometry under CSP and exports its own material", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v18.pcaddoc");
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command Palette", exact: true }); await palette.getByLabel("Filter commands").fill("Build a fitted part"); await expect(palette.getByRole("button", { name: /^Build a fitted part/ })).toBeEnabled(); await palette.getByRole("button", { name: /^Build a fitted part/ }).click();
  const dialog = page.getByRole("dialog", { name: "Build a fitted part", exact: true }); await expect(dialog.getByRole("status")).toHaveText("Native fitted preview ready"); await dialog.getByRole("button", { name: "Apply fitted part" }).click(); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const savedPath = info.outputPath("fitted.pcaddoc"); await (await saving).saveAs(savedPath); const saved = JSON.parse(await readFile(savedPath, "utf8")); expect(saved.features.at(-1)).toMatchObject({ type: "fit", sourceBodyId: "body:first-solid", clearance: { expression: "2mm" }, wallThickness: { expression: "2mm" } });
  await page.getByRole("button", { name: "Export STL", exact: true }).click(); const exportDialog = page.getByRole("dialog", { name: /STL/i }); await exportDialog.getByRole("button", { name: "Clear body selection" }).click(); await exportDialog.getByRole("checkbox", { name: "Export body Fitted enclosure", exact: true }).check();
  const exporting = page.waitForEvent("download"); await exportDialog.getByRole("button", { name: "Generate STL", exact: true }).click(); const stl = info.outputPath("fitted.stl"); await (await exporting).saveAs(stl); expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(2520, 5); expect(errors).toEqual([]);
});
