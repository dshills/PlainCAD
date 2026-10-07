import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "../src/cad/document/schema";

async function nativeVolume(page: Page, thickness: number, count: number) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.locator(".body-row").getByRole("button", { name: "Base", exact: true }).click();
  const expected = (200 - count * Math.PI) * thickness;
  // This native assertion is displayed to three decimals; allow that rounding,
  // while development acceptance checks the unrounded BRep mass at 1e-8 relative.
  await expect.poll(async () => {
    const volume = Number(await page.getByText("Volume (mm³)", { exact: true }).locator("..").locator("dd").innerText());
    return Math.abs(volume - expected);
  }).toBeLessThan(0.00051);
  await expect(page.getByText("Solids", { exact: true }).locator("..").locator("dd")).toHaveText("1");
}
function stlVolume(bytes: Buffer) {
  const triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + 50 * triangles);
  let volume = 0;
  for (let i = 0; i < triangles; i++) {
    const p = Array.from({ length: 9 }, (_, j) => bytes.readFloatLE(96 + 50 * i + 4 * j));
    expect(p.every(Number.isFinite)).toBe(true);
    volume += (p[0] * (p[4] * p[8] - p[5] * p[7]) - p[1] * (p[3] * p[8] - p[5] * p[6]) + p[2] * (p[3] * p[7] - p[4] * p[6])) / 6;
  }
  // Outward triangle winding is part of fabrication correctness; reject inversion.
  expect(volume).toBeGreaterThan(0);
  return volume;
}
test("schema 14 associative hole pattern: production native edit, source update, save/open and STL", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.locator('input[type="file"]').setInputFiles(resolve("src/persistence/fixtures/schema-v14.pcaddoc"));
  await nativeVolume(page, 5, 2);
  // Change the source depth by changing the body thickness: every through-hole stays associated.
  const thickness = page.getByLabel("Parameter thickness expression", { exact: true });
  await thickness.fill("8mm"); await thickness.press("Enter");
  await nativeVolume(page, 8, 2);
  const timeline = page.getByRole("list", { name: "Sketch and feature history" });
  await timeline.getByRole("button", { name: /Linear holes/ }).click();
  await page.getByRole("button", { name: "Edit Feature", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit feature pattern" });
  await edit.getByLabel("Pattern count", { exact: true }).fill("3");
  await edit.getByLabel("Pattern spacing", { exact: true }).fill("-3mm");
  await expect(edit.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await edit.getByRole("button", { name: "Apply pattern", exact: true }).click();
  await nativeVolume(page, 8, 3);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const savedPath = info.outputPath("schema14-pattern.pcaddoc"); await (await saving).saveAs(savedPath);
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(saved.features.at(-1)).toMatchObject({ id: "hole-pattern", sourceFeatureId: "hole", pattern: { count: { expression: "3", authoredUnit: "" }, spacing: { expression: "-3mm" } } });
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(page.getByLabel("Parameter width expression", { exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(savedPath);
  await nativeVolume(page, 8, 3);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("schema14-pattern.stl"); await (await exporting).saveAs(stlPath);
  const actual = stlVolume(await readFile(stlPath)), expected = (200 - 3 * Math.PI) * 8;
  expect(Math.abs(actual / expected - 1)).toBeLessThan(0.001);
  expect(errors).toEqual([]);
});
