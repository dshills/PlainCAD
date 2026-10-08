import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "../src/cad/document/schema";

async function part(page: import("@playwright/test").Page, name: string, volume: number, bounds: number[]) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const disclosure = page.getByRole("button", { name: new RegExp(`^(?:Expand|Collapse) component ${name}$`) });
  await expect(disclosure).toBeVisible();
  if (await disclosure.getAttribute("aria-expanded") === "false") await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  // The root component retains its feature label; other single-body components
  // use their part name. Both scopes must be expanded before choosing a body.
  const bodyName = name === "Base part" ? "Base" : name;
  await page.locator(".body-row").getByRole("button", { name: bodyName, exact: true }).click();
  await expect(page.getByText("Volume (mm³)", { exact: true }).locator("..")).toContainText(volume.toFixed(3));
  await expect(page.getByText("Solids", { exact: true }).locator("..").locator("dd")).toHaveText("1");
  const text = await page.getByText("Bounds", { exact: true }).locator("..").locator("dd").textContent();
  const numbers = text?.match(/-?\d+(?:\.\d+)?/g)?.map(Number); expect(numbers).toHaveLength(6);
  numbers!.forEach((value, index) => expect(value).toBeCloseTo(bounds[index], 3));
}
test("schema 17 production world links preserve different poses, native bounds and parameter associations through save/open", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = resolve("src/persistence/fixtures/schema-v17.pcaddoc");
  await page.goto("/"); await page.locator('input[type="file"]').setInputFiles(fixture);
  await part(page, "Base part", 4800, [30, 20, 0, 50, 50, 8]); await part(page, "Cover part", 1200, [30, 20, 12, 50, 50, 14]);
  const width = page.getByRole("textbox", { name: "Parameter width expression", exact: true }); await width.fill("42mm"); await width.press("Enter");
  await part(page, "Base part", 6720, [30, 20, 0, 50, 62, 8]); await part(page, "Cover part", 1680, [30, 20, 12, 50, 62, 14]);
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const path = info.outputPath("placed-cover.pcaddoc"); await (await downloading).saveAs(path);
  const saved = JSON.parse(await readFile(path, "utf8")); expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(saved.sketches["cover-section"].projections[0].coordinateSpace).toBe("world");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Parametric Box");
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Schema 17 placed linked cover");
  await part(page, "Cover part", 1680, [30, 20, 12, 50, 62, 14]);
  expect(errors).toEqual([]);
});
