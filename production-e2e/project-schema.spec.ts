import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CURRENT_SCHEMA_VERSION, type CadDocument } from "../src/cad/document/schema";

async function nativePlacedParts(page: Page, width: number) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
  for (const [name, component, bounds] of [
    ["First solid", "First part", [20, -7, 4, 30, width - 7, 9]],
    ["Second part", "Second part", [7, 11, -width - 3, 12, 21, -3]],
  ] as const) {
    const disclosure = page.getByRole("button", { name: new RegExp(`^(?:Expand|Collapse) component ${component}$`) });
    await expect(disclosure).toBeVisible();
    if (await disclosure.getAttribute("aria-expanded") === "false") await disclosure.click();
    await page.locator(".body-row").getByRole("button", { name, exact: true }).click();
    // These assertions are shown only for valid native BRep measurements.
    await expect(page.getByText("Volume (mm³)", { exact: true }).locator("..").locator("dd")).toHaveText((width * 10 * 5).toFixed(3));
    await expect(page.getByText("Solids", { exact: true }).locator("..").locator("dd")).toHaveText("1");
    const readout = page.getByText("Bounds", { exact: true }).locator("..");
    await expect.poll(async () => {
      const values = (await readout.innerText()).match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      if (values?.length !== bounds.length) return Infinity;
      return Math.max(...values.map((value, index) => Math.abs(value - bounds[index])));
    }).toBeLessThan(0.0005);
  }
}

function stlShells(bytes: Buffer) {
  const triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0); expect(bytes.length).toBe(84 + 50 * triangles);
  const shells = Array.from({ length: 2 }, () => ({ triangles: 0, volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
  for (let i = 0; i < triangles; i++) {
    for (let axis = 0; axis < 3; axis++) expect(Number.isFinite(bytes.readFloatLE(84 + 50 * i + 4 * axis))).toBe(true);
    const p = Array.from({ length: 9 }, (_, j) => bytes.readFloatLE(96 + 50 * i + 4 * j));
    expect(p.every(Number.isFinite)).toBe(true);
    // The two posed boxes are separated by an X gap; classify each entire triangle.
    const shell = shells[(p[0] + p[3] + p[6]) / 3 > 16 ? 0 : 1];
    shell.triangles++;
    for (let j = 0; j < 9; j++) { shell.min[j % 3] = Math.min(shell.min[j % 3], p[j]); shell.max[j % 3] = Math.max(shell.max[j % 3], p[j]); }
    shell.volume += (p[0] * (p[4] * p[8] - p[5] * p[7]) - p[1] * (p[3] * p[8] - p[5] * p[6]) + p[2] * (p[3] * p[7] - p[4] * p[6])) / 6;
  }
  return shells;
}

test("schema 16 native component poses preserve orientation, parameters, save/open and separate STL shells", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = resolve("src/persistence/fixtures/schema-v16.pcaddoc"), original = JSON.parse(await readFile(fixture, "utf8")) as CadDocument;
  expect(original.schemaVersion).toBe(16);
  expect(original.components["first-component"].placement?.rotation).toEqual([0, 0, Math.PI / 2]);
  expect(original.components["second-component"].placement?.rotation).toEqual([Math.PI / 2, Math.PI / 2, Math.PI / 2]);
  await page.goto("/"); await page.locator('input[type="file"]').setInputFiles(fixture);
  await nativePlacedParts(page, 20);
  const width = page.getByLabel("Parameter width expression", { exact: true });
  await width.fill("24mm"); await width.press("Enter");
  // Different posed axes react to the same authored width: Y for the first box,
  // negative Z for the second. This rejects unchanged meshes and wrong rotation order.
  await nativePlacedParts(page, 24);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const savedPath = info.outputPath("placed-components-v16.pcaddoc"); await (await saving).saveAs(savedPath);
  const saved = JSON.parse(await readFile(savedPath, "utf8")) as CadDocument;
  expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(saved.id).toBe(original.id);
  expect(saved.components).toEqual(original.components);
  expect(saved.features).toEqual(original.features); expect(saved.sketches).toEqual(original.sketches);
  expect(saved.parameters.width).toMatchObject({ id: original.parameters.width.id, expression: "24mm" });
  expect(JSON.stringify(saved)).not.toContain("kernelHandle");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(savedPath);
  await expect(width).toHaveValue("24mm"); await nativePlacedParts(page, 24);
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "STL export options" });
  await dialog.getByLabel("Output files").selectOption("shells");
  const exporting = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Generate STL", exact: true }).click();
  const stlPath = info.outputPath("placed-components.stl"); await (await exporting).saveAs(stlPath);
  const shells = stlShells(await readFile(stlPath));
  for (const [index, shell] of shells.entries()) {
    expect(shell.triangles).toBeGreaterThan(0); expect(shell.volume).toBeGreaterThan(0);
    expect(Math.abs(shell.volume / 1200 - 1)).toBeLessThan(1e-7);
    const expected = index === 0 ? { min: [20, -7, 4], max: [30, 17, 9] } : { min: [7, 11, -27], max: [12, 21, -3] };
    shell.min.forEach((n, axis) => expect(n).toBeCloseTo(expected.min[axis], 5));
    shell.max.forEach((n, axis) => expect(n).toBeCloseTo(expected.max[axis], 5));
  }
  await expect(dialog).toBeHidden();
  const resaving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const reopenedPath = info.outputPath("placed-components-reopened.pcaddoc"); await (await resaving).saveAs(reopenedPath);
  const reopened = JSON.parse(await readFile(reopenedPath, "utf8")) as CadDocument;
  expect(reopened.components).toEqual(saved.components); expect(reopened.sketches).toEqual(saved.sketches); expect(reopened.features).toEqual(saved.features); expect(reopened.parameters).toEqual(saved.parameters);
  expect(errors).toEqual([]);
});
