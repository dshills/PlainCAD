import { openNewPartMenu } from "./newPartWorkflow";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";
import { aiPlatePlan } from "../src/tests/fixtures/aiPlan";

test.use({ storageState: { cookies: [], origins: [] } });

async function nativePart(page: Page, volume: number, componentName: string) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result!.meshes[0]).toMatchObject({
      geometrySource: "opencascade",
      geometryAssertions: { valid: true, solidCount: 1 },
    });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 5);
    const feature = state.document.features[0];
    expect(state.document.components[feature.componentId!].name).toBe(componentName);
    expect(Object.values(state.document.sketches).every((sketch) => sketch.componentId === feature.componentId)).toBe(true);
  }).toPass({ timeout: 30000 });
}

async function pointerStart(page: Page, x: number, y: number) {
  const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  const viewBox = await canvas.getAttribute("viewBox");
  if (!bounds || bounds.width <= 0 || bounds.height <= 0)
    throw new Error("Drawing canvas has no visible drawing area");
  if (!viewBox?.trim()) throw new Error("Drawing canvas has no viewBox");
  const view = viewBox.trim().split(/\s+/).map(Number);
  if (view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0)
    throw new Error("Drawing canvas viewBox must contain four finite coordinates and positive dimensions");
  await page.mouse.click(bounds.x + ((x - view[0]) / view[2]) * bounds.width, bounds.y + ((-y - view[1]) / view[3]) * bounds.height);
}

test("named Draw route creates component and sketch atomically, then produces portable native geometry", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await openNewPartMenu(page);
  await page.getByLabel("Part name", { exact: true }).fill("Mouse bracket");
  await expect(page.getByRole("region", { name: "Start a part" })).toBeVisible();
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page.getByRole("button", { name: "Cancel plane selection", exact: true }).click();
  const canceled = await aiSnapshot(page);
  expect(canceled.past).toBe(0);
  expect(Object.keys(canceled.document.components)).toHaveLength(1);
  expect(Object.keys(canceled.document.sketches)).toHaveLength(0);
  await openNewPartMenu(page);
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page.getByRole("button", { name: "Sketch on Top (XY) plane", exact: true }).click();
  const created = await aiSnapshot(page);
  expect(created.past).toBe(1);
  expect(Object.keys(created.document.components)).toHaveLength(2);
  expect(Object.keys(created.document.sketches)).toHaveLength(1);
  await expect(page.getByRole("navigation", { name: "Project location" })).toContainText("Mouse bracket");
  await expect(page.getByRole("navigation", { name: "Project location" })).toContainText("Sketch 1");
  await page.getByRole("button", { name: "Draw tool: rectangle", exact: true }).click();
  await pointerStart(page, 0, 0);
  await page.getByLabel("Draft width", { exact: true }).fill("30mm");
  await page.getByLabel("Draft height", { exact: true }).fill("20mm");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Extrude", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Extrude", exact: true }).getByLabel("Extrude distance").fill("6mm");
  await applyExtrusion(page);
  await nativePart(page, 3600, "Mouse bracket");
  const mesh = (await aiSnapshot(page)).result!.meshes[0];
  for (const [axis, value] of [0, 0, 0].entries())
    expect(mesh.bounds.min[axis]).toBeCloseTo(value, 6);
  for (const [axis, value] of [30, 20, 6].entries())
    expect(mesh.bounds.max[axis]).toBeCloseTo(value, 6);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = info.outputPath("first-part.pcaddoc");
  await (await save).saveAs(projectPath);
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await nativePart(page, 3600, "Mouse bracket");
  await page.locator(".file-menu > summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("first-part.stl");
  await (await download).saveAs(stlPath);
  expect(stlSignedVolume(await readFile(stlPath))).toBeCloseTo(3600, 5);
});

test("named Describe route previews native geometry without an empty component and only publishes on Apply", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map((id) => ({ id, label: id, model: "test-model", available: true })) } }));
  await page.route("**/api/ai/generate", (route) => {
    requests += 1;
    return route.fulfill({ json: { plan: aiPlatePlan } });
  });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await openNewPartMenu(page);
  const start = page.getByRole("region", { name: "Start a part" });
  await start.getByLabel("Part name", { exact: true }).fill("Described bracket");
  await start.getByRole("button", { name: "Describe a part with AI", exact: true }).click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant", exact: true });
  await expect(drawer.getByRole("combobox", { name: "AI scope", exact: true })).toHaveValue("create");
  await expect(drawer.getByLabel("What would you like to make?", { exact: true })).toHaveValue('Make a part named "Described bracket". ');
  expect(requests).toBe(0);
  const before = await aiSnapshot(page);
  expect(before.past).toBe(0);
  expect(Object.keys(before.document.components)).toHaveLength(1);
  await drawer.getByLabel("What would you like to make?", { exact: true }).fill("A 60 x 40 x 5 mm plate with a centered 4 mm through hole.");
  await drawer.getByRole("button", { name: "Generate preview", exact: true }).click();
  const apply = drawer.getByRole("button", { name: "Apply AI component", exact: true });
  await expect(apply).toBeEnabled();
  const preview = await aiSnapshot(page);
  expect(preview.document).toEqual(before.document);
  expect(preview.past).toBe(0);
  await drawer.getByRole("button", { name: "Cancel AI proposal", exact: true }).click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await drawer.getByRole("button", { name: "Generate preview", exact: true }).click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await nativePart(page, (60 * 40 - Math.PI * 4) * 5, "Described bracket");
  expect((await aiSnapshot(page)).past).toBe(1);
  expect(Object.keys((await aiSnapshot(page)).document.components)).toHaveLength(2);
  await expect(page.getByRole("navigation", { name: "Project location" })).toContainText("Described bracket");
});
