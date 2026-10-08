import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";
test("built product configurations compare and batch-export native variants under CSP", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const violations: string[] = [];
  await page.exposeFunction("familyCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => {
    void (window as unknown as { familyCspViolation: (directive: string) => Promise<void> }).familyCspViolation(event.violatedDirective);
  }));
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v20.pcaddoc"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.keyboard.press("ControlOrMeta+k"); const palette = page.getByRole("dialog", { name: "Command Palette", exact: true }); await palette.getByLabel("Filter commands").fill("Product configurations"); await palette.getByRole("button", { name: /^Product configurations/ }).click();
  const dialog = page.getByRole("dialog", { name: "Product configurations", exact: true }); await dialog.getByRole("checkbox", { name: "Compare Large", exact: true }).check(); await dialog.getByRole("button", { name: "Compare selected configurations", exact: true }).click(); await expect(dialog.getByRole("status")).toHaveText("Comparison complete"); await expect(dialog.getByRole("table")).toContainText("6240.000");
  const downloading = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Download configuration STL archive", exact: true }).click(); const archive = info.outputPath("large.zip"); await (await downloading).saveAs(archive); const bytes = await readFile(archive); const parts: number[] = [];
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) { const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), start = offset + 30 + length + bytes.readUInt16LE(offset + 28), name = bytes.subarray(offset + 30, offset + 30 + length).toString(); if (name.endsWith(".stl")) { expect(name).toContain("Large"); parts.push(stlSignedVolume(bytes.subarray(start, start + size))); } offset = start + size; }
  parts.sort((a, b) => a - b); expect(parts).toHaveLength(3);
  for (const [index, expected] of [1500, 1500, 3240].entries()) expect(parts[index]).toBeCloseTo(expected, 4);
  expect(errors).toEqual([]); expect(violations).toEqual([]);
});
