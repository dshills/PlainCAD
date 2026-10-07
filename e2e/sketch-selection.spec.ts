import { openNewPartMenu } from "./newPartWorkflow";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

test.use({ storageState: { cookies: [], origins: [] } });
async function clientPoint(page: Page, x: number, y: number) {
  const canvas = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Sketch canvas unavailable");
  const viewBox = await canvas.getAttribute("viewBox");
  if (!viewBox) throw new Error("Sketch canvas has no viewBox");
  const view = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  // Canvas uses preserveAspectRatio="none" and its handler maps border-box coordinates.
  return {
    x: Math.round(bounds.x + ((x - view[0]) / view[2]) * bounds.width),
    y: Math.round(bounds.y + ((-y - view[1]) / view[3]) * bounds.height),
  };
}
async function clickLocal(page: Page, x: number, y: number, shift = false) {
  const p = await clientPoint(page, x, y);
  if (shift) await page.keyboard.down("Shift");
  try {
    await page.mouse.click(p.x, p.y);
  } finally {
    if (shift) await page.keyboard.up("Shift");
  }
}
async function box(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const start = await clientPoint(page, x1, y1),
    end = await clientPoint(page, x2, y2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}
async function nativeVolume(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
    expect(state.result!.meshes[0].geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(
      expected,
      6,
    );
  }).toPass({ timeout: 30000 });
}
test("box and Shift selection delete whole shapes once, preserve native geometry, and restore through undo/save/open/STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await openNewPartMenu(page);
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  await clickLocal(page, 0, 0);
  await page.getByLabel("Draft width", { exact: true }).fill("20mm");
  await page.getByLabel("Draft height", { exact: true }).fill("12mm");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const base = await aiSnapshot(page),
    sketch = Object.values(base.document.sketches)[0];
  await page
    .getByRole("toolbar", { name: "Drawing tools" })
    .getByLabel("Construction", { exact: true })
    .check();
  await clickLocal(page, 45, 30);
  await page.getByLabel("Draft width", { exact: true }).fill("10mm");
  await page.getByLabel("Draft height", { exact: true }).fill("8mm");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const full = await aiSnapshot(page);
  await page
    .getByRole("button", { name: "Draw tool: select", exact: true })
    .click();
  // A window only selects fully enclosed curves; a crossing catches partial edges.
  await box(page, 48, 28, 52, 32);
  await expect(page.getByLabel("Sketch selection count")).toHaveText(
    "0 selected",
  );
  await box(page, 52, 28, 48, 32);
  await expect(page.getByLabel("Sketch selection count")).toHaveText(
    "1 selected",
  );
  await clickLocal(page, 50, 38, true);
  await expect(page.getByLabel("Sketch selection count")).toHaveText(
    "2 selected",
  );
  await clickLocal(page, 50, 38, true);
  await expect(page.getByLabel("Sketch selection count")).toHaveText(
    "1 selected",
  );
  await box(page, 42, 27, 58, 41);
  await expect(page.getByLabel("Sketch selection count")).toHaveText(
    "4 selected",
  );
  await expect(page.locator(".canvas-entity-selected")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Edit selected size", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Removes 8 geometry item/)).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.locator(".canvas-point")).toHaveCount(4);
  const deleted = await aiSnapshot(page);
  expect(deleted.past).toBe(full.past + 1);
  expect(deleted.document.sketches[sketch.id].entities).toEqual(
    sketch.entities,
  );
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Extrude", exact: true })).toBeVisible();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await nativeVolume(page, 1200);
  const solid = await aiSnapshot(page);
  const history = page.getByRole("button", { name: "History", exact: true });
  if ((await history.getAttribute("aria-expanded")) !== "true")
    await history.click();
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button")
    .filter({ has: page.getByText(sketch.name, { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: select", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Sketch drawing canvas", exact: true })
    .focus();
  await page.keyboard.press("Control+a");
  await expect(page.getByLabel("Sketch selection count")).toHaveText(
    "8 selected",
  );
  await page.keyboard.press("Backspace");
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  expect(
    (await aiSnapshot(page)).document.sketches[sketch.id].entities,
  ).toEqual({});
  await expect(page.locator(".canvas-point")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await nativeVolume(page, 1200);
  expect((await aiSnapshot(page)).document.sketches[sketch.id]).toEqual(
    solid.document.sketches[sketch.id],
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await nativeVolume(page, 1200);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath("selection-restored.pcaddoc");
  await (await save).saveAs(project);
  await page.locator('input[type="file"]').setInputFiles(project);
  await nativeVolume(page, 1200);
  const exportStl = page.waitForEvent("download");
  await page.locator(".file-menu > summary").click();
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("selection-restored.stl");
  await (await exportStl).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1200, 2);
});
