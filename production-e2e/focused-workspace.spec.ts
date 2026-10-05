import { applyExtrusion } from "../e2e/extrudeWorkflow";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";
test.use({ storageState: { cookies: [], origins: [] } });
test("built focused workspace starts quietly and edits/exports a native example under CSP", async ({
  page,
}, info) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "worker-src 'self'",
  );
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
  await expect(
    page.getByRole("heading", { name: "Dependencies" }),
  ).toBeHidden();
  await page.getByText("Start from example", { exact: true }).click();
  await page
    .getByRole("button", { name: "Load mounting plate template", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Task panel").selectOption("parameters");
  const input = page.getByLabel("Parameter plate_width expression", {
    exact: true,
  });
  await input.fill("100mm");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  // Verify the edited native solid through the public readout before exporting;
  // a formerly enabled Export button alone cannot prove the new geometry is current.
  const expected = (100 * 50 - 4 * Math.PI * 1.6 ** 2) * 5;
  await page.getByLabel("Task panel").selectOption("inspector");
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.locator(".body-row").getByRole("button").first().click();
  const nativeVolume = page
    .getByText("Volume (mm³)", { exact: true })
    .locator("..")
    .locator("dd");
  // InspectorPanel uses toFixed(3); 0.001 mm³ allows the display rounding.
  await expect
    .poll(async () =>
      Math.abs(Number(await nativeVolume.textContent()) - expected),
    )
    .toBeLessThan(0.001);
  await expect(
    page.getByText("Solids", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("1");
  const exportFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const path = info.outputPath("focused-production.stl");
  await (await exportFile).saveAs(path);
  expect(
    Math.abs(stlSignedVolume(await readFile(path)) / expected - 1),
  ).toBeLessThan(0.001);
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
});

test("built Focused precise sketch and inline dimension edit produce native STL under CSP", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "worker-src 'self'",
  );
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Front (XZ) plane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  const svg = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  const bounds = (await svg.boundingBox())!,
    view = (await svg.getAttribute("viewBox"))!.split(/\s+/).map(Number);
  await svg.click({
    position: {
      x: (-view[0] / view[2]) * bounds.width,
      y: (-view[1] / view[3]) * bounds.height,
    },
  });
  await page.getByLabel("Draft width", { exact: true }).fill("20mm");
  await page.getByLabel("Draft height", { exact: true }).fill("12");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  const dimension = svg.locator("g[data-dimension-id]").first();
  await dimension.focus();
  await dimension.press("Enter");
  await page.getByLabel("Sketch size expression", { exact: true }).fill("30");
  await page
    .getByLabel("Sketch size expression", { exact: true })
    .press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Task panel").selectOption("inspector");
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.locator(".body-row").getByRole("button").first().click();
  await expect(
    page.getByText("Volume (mm³)", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("1800.000");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const file = info.outputPath("precise-production.stl");
  await (await download).saveAs(file);
  const bytes = await readFile(file);
  expect(stlSignedVolume(bytes)).toBeCloseTo(1800, 2);
  const axes: number[][] = [[], [], []];
  for (let i = 0; i < bytes.readUInt32LE(80); i++)
    for (let j = 0; j < 9; j++)
      axes[j % 3].push(bytes.readFloatLE(96 + 50 * i + j * 4));
  expect(Math.min(...axes[1])).toBeCloseTo(-5, 4);
  expect(Math.max(...axes[1])).toBeCloseTo(0, 4);
  expect(Math.max(...axes[0]) - Math.min(...axes[0])).toBeCloseTo(30, 4);
  expect(Math.max(...axes[2]) - Math.min(...axes[2])).toBeCloseTo(12, 4);
  expect(errors).toEqual([]);
});
