import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addCornerRectangle, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
function fixture() {
  const sketch = addCornerRectangle(createSketchOnPlane("Asymmetric outline", "XY"), "width", "20mm");
  const profile = detectProfiles(solveSketch(sketch, { width: { value: 30, unit: "mm", dimension: "length" } })).profiles[0];
  const feature = createExtrudeFeature({ name: "Placement block", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
  return upsertFeature(upsertSketch(upsertParameter(createEmptyDocument("Placed bracket"), { id: "placement_width", name: "width", expression: "30mm", unit: "mm", value: 30 }), sketch), feature);
}
async function native(page: Page, volume: number, min: number[], max: number[]) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result!.errors).toEqual([]); expect(state.result!.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 7);
    mesh.bounds.min.forEach((value, axis) => expect(value).toBeCloseTo(min[axis], 7)); mesh.bounds.max.forEach((value, axis) => expect(value).toBeCloseTo(max[axis], 7));
  }).toPass({ timeout: 30000 });
}
async function open(page: Page) {
  // Shared command opens the same task as the active component's Move button.
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("component.move"); });
  return page.getByRole("dialog", { name: "Move or rotate component", exact: true });
}
test("moves and rotates native components with mouse cancellation, exact fields, one Undo, save/open and correctly oriented STL", async ({ page }, info) => {
  const model = fixture(); await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "placement.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)) });
  await native(page, 4800, [0, 0, 0], [30, 20, 8]);
  const before = await aiSnapshot(page), dialog = await open(page);
  const move = dialog.getByRole("button", { name: "Move component X", exact: true });
  await expect(move).toBeEnabled(); const bounds = await move.boundingBox(); expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2); await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 60, bounds!.y + bounds!.height / 2, { steps: 6 });
  await expect(dialog.getByRole("status", { name: "Placement status" })).toContainText("Moving live");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel("Position X (mm)")).toHaveValue("0");
  await move.focus(); await move.press("ArrowRight");
  await expect(dialog.getByLabel("Position X (mm)")).toHaveValue("1");
  await expect(dialog.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel placement" }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past); expect((await aiSnapshot(page)).document).toEqual(before.document);
  const again = await open(page);
  for (const [name, value] of [["Position X (mm)", "50"], ["Position Y (mm)", "20"], ["Position Z (mm)", "10"], ["Rotation Z (deg)", "90"]]) {
    const field = again.getByLabel(name); await field.fill(value); await field.press("Enter");
  }
  await expect(again.getByRole("status", { name: "Placement status" })).toContainText("Native placement is valid");
  await again.getByRole("button", { name: "Apply component placement" }).click();
  await native(page, 4800, [30, 20, 10], [50, 50, 18]);
  const applied = await aiSnapshot(page);
  expect(applied.past).toBe(before.past + 1); expect(applied.document.components[model.rootComponentId].placement).toMatchObject({ translation: [50, 20, 10], rotation: [0, 0, Math.PI / 2] });
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await native(page, 4800, [0, 0, 0], [30, 20, 8]);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await native(page, 4800, [30, 20, 10], [50, 50, 18]);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = info.outputPath("placed-component.pcaddoc"); await (await download).saveAs(saved);
  expect(JSON.parse(await readFile(saved, "utf8")).components[model.rootComponentId].placement.translation).toEqual([50, 20, 10]);
  const previousSession = (await aiSnapshot(page)).session; await page.locator('input[type="file"]').first().setInputFiles(saved);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(previousSession);
  await native(page, 4800, [30, 20, 10], [50, 50, 18]);
  const width = page.getByRole("textbox", { name: "Parameter width expression", exact: true }); await width.fill("42mm"); await width.press("Enter");
  await native(page, 6720, [30, 20, 10], [50, 62, 18]);
  const exported = page.waitForEvent("download");
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("file.exportStl"); });
  const stl = info.outputPath("placed-component.stl"); await (await exported).saveAs(stl);
  const bytes = await readFile(stl); expect(stlSignedVolume(bytes)).toBeCloseTo(6720, 4);
  const vertices: number[][] = []; for (let offset = 84; offset < bytes.length; offset += 50) for (const vertex of [0, 1, 2]) vertices.push([0, 1, 2].map((axis) => bytes.readFloatLE(offset + 12 + vertex * 12 + axis * 4)));
  [0, 1, 2].forEach((axis) => { expect(Math.min(...vertices.map((point) => point[axis]))).toBeCloseTo([30, 20, 10][axis], 5); expect(Math.max(...vertices.map((point) => point[axis]))).toBeCloseTo([50, 62, 18][axis], 5); });
});
