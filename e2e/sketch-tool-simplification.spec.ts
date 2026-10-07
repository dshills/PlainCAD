import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

test.use({ storageState: { cookies: [], origins: [] } });

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      const mesh = state.result!.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30_000 });
}
async function local(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await svg.scrollIntoViewIfNeeded();
  const bounds = await svg.boundingBox();
  const view = (await svg.getAttribute("viewBox"))!.trim().split(/[\s,]+/).map(Number);
  if (!bounds || view.length !== 4 || view.some((value) => !Number.isFinite(value)))
    throw new Error("Sketch canvas unavailable.");
  return {
    x: bounds.x + (x - view[0]) / view[2] * bounds.width,
    y: bounds.y + (-y - view[1]) / view[3] * bounds.height,
  };
}
for (const mode of ["corner", "center"] as const) {
  test(`${mode} Rectangle mode and uncluttered editable dimensions preserve native geometry, history, save/open and STL`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
    await page.getByRole("button", { name: "Sketch on Top (XY) plane", exact: true }).click();
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await page.getByRole("button", { name: "Draw rectangle", exact: true }).click();
    await page.getByLabel("Rectangle creation mode", { exact: true }).selectOption(mode);
    const anchor = await local(page, 20, 10);
    await page.mouse.click(anchor.x, anchor.y);
    const canvasBounds = await page.getByRole("group", { name: "Sketch drawing canvas", exact: true }).boundingBox();
    const sizeBounds = await page.getByRole("form", { name: "Draft shape size", exact: true }).boundingBox();
    expect(canvasBounds).not.toBeNull();
    expect(sizeBounds).not.toBeNull();
    expect(sizeBounds!.x >= canvasBounds!.x + canvasBounds!.width || sizeBounds!.y >= canvasBounds!.y + canvasBounds!.height).toBe(true);
    await page.getByLabel("Draft width", { exact: true }).fill("24mm");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Draft height", { exact: true })).toBeFocused();
    await page.keyboard.type("12mm");
    await page.keyboard.press("Enter");
    await ready(page);
    const drawn = await aiSnapshot(page);
    const sketch = Object.values(drawn.document.sketches)[0];
    expect(sketch.dimensions).toHaveLength(2);
    await expect(page.locator(".canvas-driving-dimension")).toHaveCount(2);
    await expect(page.locator(".canvas-reference-dimension")).toHaveCount(0);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
    await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
    await applyExtrusion(page);
    await ready(page, 1440);
    const mesh = (await aiSnapshot(page)).result!.meshes[0];
    const expected = mode === "center"
      ? { min: [8, 4, 0], max: [32, 16, 5] }
      : { min: [20, 10, 0], max: [44, 22, 5] };
    for (const key of ["min", "max"] as const)
      for (let axis = 0; axis < 3; axis++) expect(mesh.bounds[key][axis]).toBeCloseTo(expected[key][axis], 6);
    await page.getByRole("button", { name: sketch.name, exact: true }).dblclick();
    const dimension = page.locator(`[data-dimension-id="${sketch.dimensions[0].id}"]`);
    await dimension.press("Enter");
    await page.getByLabel("Sketch size expression", { exact: true }).fill("30mm");
    await page.keyboard.press("Enter");
    await ready(page, 1800);
    const resized = await aiSnapshot(page);
    const line = Object.values(resized.document.sketches[sketch.id].entities).find(
      (entity) => entity.type === "line" && !sketch.dimensions.some((d) => d.entityIds.includes(entity.id)),
    )!;
    await page.getByRole("button", { name: "Draw tool: select", exact: true }).click();
    await page.getByLabel("Selected sketch item", { exact: true }).selectOption(line.id);
    await expect(page.locator(".canvas-reference-dimension")).toHaveCount(1);
    await page.getByLabel("Selected sketch item", { exact: true }).selectOption("");
    await expect(page.locator(".canvas-reference-dimension")).toHaveCount(0);
    expect((await aiSnapshot(page)).document).toEqual(resized.document);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, 1440);
    expect((await aiSnapshot(page)).document.sketches[sketch.id]).toEqual(sketch);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, 1800);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const project = info.outputPath(`${mode}-rectangle.pcaddoc`);
    await (await saving).saveAs(project);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(resized.session);
    await ready(page, 1800);
    expect((await aiSnapshot(page)).document.sketches[sketch.id]).toEqual(resized.document.sketches[sketch.id]);
    const exporting = page.waitForEvent("download");
    await page.locator(".file-menu > summary").click();
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${mode}-rectangle.stl`);
    await (await exporting).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1800, 3);
    expect(errors).toEqual([]);
  });
}
