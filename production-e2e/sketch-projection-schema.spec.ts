import { CURRENT_SCHEMA_VERSION } from "../src/cad/document/schema";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CadDocument } from "../src/cad/document/schema";

async function nativeParts(page: Page, width: number) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
  for (const [name, component, depth, z] of [["Base", "Base part", 8, 0], ["Cover part", "Cover part", 2, 12]] as const) {
    const disclosure = page.getByRole("button", { name: new RegExp(`^(?:Expand|Collapse) component ${component}$`) });
    await expect(disclosure).toBeVisible();
    if (await disclosure.getAttribute("aria-expanded") === "false") await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await page.locator(".body-row").getByRole("button", { name, exact: true }).click();
    await expect(page.getByText("Volume (mm³)", { exact: true }).locator("..").locator("dd")).toHaveText((width * 20 * depth).toFixed(3));
    await expect(page.getByText("Solids", { exact: true }).locator("..").locator("dd")).toHaveText("1");
    const bounds = page.getByText("Bounds", { exact: true }).locator("..");
    await expect.poll(async () => (await bounds.innerText()).match(/-?\d+(?:\.\d+)?/g)?.map(Number)).toEqual([0, 0, z, width, 20, z + depth]);
  }
}
function stlVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80); expect(count).toBeGreaterThan(0); expect(bytes.length).toBe(84 + 50 * count);
  let volume = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const points = Array.from({ length: 9 }, (_, j) => bytes.readFloatLE(96 + 50 * i + 4 * j));
    expect(points.every(Number.isFinite)).toBe(true);
    for (let j = 0; j < 9; j++) { min[j % 3] = Math.min(min[j % 3], points[j]); max[j % 3] = Math.max(max[j % 3], points[j]); }
    const [a, b, c, d, e, f, g, h, k] = points;
    volume += (a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)) / 6;
  }
  return { volume, min, max };
}

test("schema 15 preserves linked cover dimensions through native parameter edit, save/open and multibody STL", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const fixture = resolve("src/persistence/fixtures/schema-v15.pcaddoc");
  const original = JSON.parse(await readFile(fixture, "utf8")) as CadDocument;
  expect(original.schemaVersion).toBe(15);
  expect(original.sketches["cover-section"].projections).toHaveLength(1);
  const link = original.sketches["cover-section"].projections?.[0];
  expect(link).toMatchObject({ sourceFeatureId: "base", role: "endCapPerimeter" });
  expect(link?.members).toHaveLength(8);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await nativeParts(page, 30);
  const width = page.getByLabel("Parameter width expression", { exact: true });
  await width.fill("42mm"); await width.press("Enter");
  // Cover's BRep volume changes too: this proves the link drove native geometry,
  // rather than merely preserving projection metadata or stale copied points.
  await nativeParts(page, 42);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const savedPath = info.outputPath("linked-cover-v15.pcaddoc"); await (await download).saveAs(savedPath);
  const saved = JSON.parse(await readFile(savedPath, "utf8")) as CadDocument;
  expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(saved.id).toBe(original.id);
  expect(saved.parameters.width.id).toBe(original.parameters.width.id);
  expect(saved.parameters.width.expression).toBe("42mm");
  expect(saved.features.map((feature) => feature.id)).toEqual(["base", "cover"]);
  expect(saved.sketches["cover-section"].projections).toEqual(original.sketches["cover-section"].projections);
  expect(Object.keys(saved.sketches["cover-section"].entities).sort()).toEqual(Object.keys(original.sketches["cover-section"].entities).sort());
  await page.getByRole("button", { name: "Load parametric box template" }).click();
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(savedPath);
  await expect(width).toHaveValue("42mm"); await nativeParts(page, 42);
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const exportPanel = page.getByRole("dialog", { name: "STL export options" });
  await exportPanel.getByLabel("Output files").selectOption("shells");
  const exporting = page.waitForEvent("download");
  await exportPanel.getByRole("button", { name: "Generate STL", exact: true }).click();
  const stlPath = info.outputPath("linked-cover.stl"); await (await exporting).saveAs(stlPath);
  const mesh = stlVolume(await readFile(stlPath));
  const expectedVolume = 42 * 20 * (8 + 2);
  expect(mesh.volume).toBeGreaterThan(0);
  expect(Math.abs(mesh.volume - expectedVolume) / expectedVolume).toBeLessThan(1e-7);
  for (const [actual, expected] of [[mesh.min, [0, 0, 0]], [mesh.max, [42, 20, 14]]]) actual.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 5));
  await expect(exportPanel).toBeHidden();
  const resave = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const reopenedPath = info.outputPath("linked-cover-reopened.pcaddoc"); await (await resave).saveAs(reopenedPath);
  const reopened = JSON.parse(await readFile(reopenedPath, "utf8")) as CadDocument;
  expect(reopened.sketches).toEqual(saved.sketches); expect(reopened.features).toEqual(saved.features); expect(reopened.parameters).toEqual(saved.parameters);
  expect(errors).toEqual([]);
});
