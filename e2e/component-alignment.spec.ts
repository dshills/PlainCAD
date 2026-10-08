import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addComponent } from "../src/cad/document/components";
import { withComponentPlacement } from "../src/cad/document/componentPlacement";
import { addCornerRectangle, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { stableFaceId } from "../src/cad/sketch/planes";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
function fixture() {
  let document = createEmptyDocument("Aligned components");
  document = { ...document, components: { ...document.components, [document.rootComponentId]: { ...document.components[document.rootComponentId], name: "Source part" } } };
  const added = addComponent(document, "Target part"); document = added.document;
  document = upsertParameter(document, { id: "alignment_width", name: "width", expression: "30mm", unit: "mm", value: 30 });
  const features: string[] = [], edges: string[] = [];
  for (const [componentId, name] of [[document.rootComponentId, "Source block"], [added.component.id, "Target block"]]) {
    const sketch = { ...addCornerRectangle(createSketchOnPlane(`${name} sketch`, "XY"), "width", "20mm"), componentId };
    const profile = detectProfiles(solveSketch(sketch, { width: { value: 30, unit: "mm", dimension: "length" } })).profiles[0];
    const feature = { ...createExtrudeFeature({ name, sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } }), componentId };
    document = upsertFeature(upsertSketch(document, sketch), feature); features.push(feature.id); edges.push(Object.values(sketch.entities).find(entity => entity.type === "line")!.id);
  }
  document = withComponentPlacement(document, added.component.id, { translation: [70, 40, 30], rotation: [0, 0, Math.PI / 2] });
  return { document, features, edges };
}
async function check(page: Page, featureId: string, min: number[], max: number[], volume = 4800) {
  await expect(async () => {
    const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); expect(state.result?.success).toBe(true); expect(state.result?.errors).toEqual([]); expect(state.result?.meshes).toHaveLength(2);
    const mesh = state.result!.meshes.find(mesh => mesh.bodyId === `body:${featureId}`)!;
    expect(mesh).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } }); expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 7);
    for (const axis of [0, 1, 2]) { expect(mesh.bounds.min[axis]).toBeCloseTo(min[axis], 7); expect(mesh.bounds.max[axis]).toBeCloseTo(max[axis], 7); }
  }).toPass({ timeout: 30000 });
}
async function open(page: Page) {
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("component.move"); });
  return page.getByRole("dialog", { name: "Move or rotate component", exact: true });
}
test("pointer-picked face alignment validates clearance, cancellation, Undo, durable native edits and placed STL", async ({ page }, info) => {
  const model = fixture(); await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "alignment.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
  await check(page, model.features[0], [0, 0, 0], [30, 20, 8]); const before = await aiSnapshot(page);
  let dialog = await open(page);
  await dialog.getByRole("button", { name: /Pick source:.*Source block.*end cap/i }).click();
  await dialog.getByRole("button", { name: /Pick target:.*Target block.*start cap/i }).click();
  await expect(dialog.getByRole("img", { name: /Selected geometry:.*Source block.*end cap/i })).toBeVisible();
  await expect(dialog.getByRole("img", { name: /Selected geometry:.*Target block.*start cap/i })).toBeVisible();
  await dialog.getByLabel("Gap (mm)").fill("2"); await dialog.getByLabel("Gap (mm)").press("Enter");
  await dialog.getByText("Details · exact placement", { exact: true }).click();
  await expect(dialog.getByLabel("Position Z (mm)")).toHaveValue("20");
  await expect(dialog.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  expect((await aiSnapshot(page)).document).toEqual(before.document); await dialog.getByRole("button", { name: "Cancel placement" }).click(); expect((await aiSnapshot(page)).past).toBe(before.past);
  dialog = await open(page); await dialog.getByRole("combobox", { name: "Source geometry", exact: true }).selectOption(`face:${stableFaceId(model.features[0], "endCap")}`); await dialog.getByRole("combobox", { name: "Target geometry", exact: true }).selectOption(`face:${stableFaceId(model.features[1], "startCap")}`);
  await dialog.getByLabel("Gap (mm)").fill("2"); await dialog.getByLabel("Gap (mm)").press("Enter"); await expect(dialog.getByRole("button", { name: "Apply component placement" })).toBeEnabled(); await dialog.getByRole("button", { name: "Apply component placement" }).click();
  await check(page, model.features[0], [0, 0, 20], [30, 20, 28]); await check(page, model.features[1], [50, 40, 30], [70, 70, 38]); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await check(page, model.features[0], [0, 0, 0], [30, 20, 8]); await page.getByRole("button", { name: "Redo", exact: true }).click(); await check(page, model.features[0], [0, 0, 20], [30, 20, 28]);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const path = info.outputPath("aligned.pcaddoc"); await (await saving).saveAs(path); const session = (await aiSnapshot(page)).session;
  expect(JSON.parse(await readFile(path, "utf8")).components[model.document.rootComponentId].placement.translation).toEqual([0, 0, 20]); await page.locator('input[type="file"]').first().setInputFiles(path); await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(session); await check(page, model.features[0], [0, 0, 20], [30, 20, 28]);
  const width = page.getByRole("textbox", { name: "Parameter width expression", exact: true }); await width.fill("42mm"); await width.press("Enter"); await check(page, model.features[0], [0, 0, 20], [42, 20, 28], 6720);
  const exporting = page.waitForEvent("download"); await page.evaluate(async bodyId => { const path = "/src/persistence/fileJobs.ts"; await (await import(path)).runFabrication("separate", true, [bodyId]); }, `body:${model.features[0]}`); const stl = info.outputPath("aligned.stl"); await (await exporting).saveAs(stl); const bytes = await readFile(stl); expect(stlSignedVolume(bytes)).toBeCloseTo(6720, 4);
  const z: number[] = []; for (let offset = 84; offset < bytes.length; offset += 50) for (const vertex of [0, 1, 2]) z.push(bytes.readFloatLE(offset + 20 + vertex * 12)); expect(Math.min(...z)).toBeCloseTo(20, 6); expect(Math.max(...z)).toBeCloseTo(28, 6);
});
test("straight-edge alignment rotates to a placed component and endpoint alignment remains a cancellable rigid snapshot", async ({ page }) => {
  const model = fixture(); await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "edge-alignment.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) }); await check(page, model.features[0], [0, 0, 0], [30, 20, 8]);
  const before = await aiSnapshot(page); let dialog = await open(page); await dialog.getByRole("combobox", { name: "Alignment geometry", exact: true }).selectOption("edge");
  const source = `edge:${model.features[0]}:endCapPerimeter:${model.edges[0]}`, target = `edge:${model.features[1]}:endCapPerimeter:${model.edges[1]}`;
  await dialog.getByRole("combobox", { name: "Source geometry", exact: true }).selectOption(source); await dialog.getByRole("combobox", { name: "Target geometry", exact: true }).selectOption(target); await dialog.getByText("Details · exact placement", { exact: true }).click(); await expect(dialog.getByLabel("Rotation Z (deg)")).toHaveValue("90"); await expect(dialog.getByRole("button", { name: "Apply component placement" })).toBeEnabled(); await dialog.getByRole("button", { name: "Apply component placement" }).click(); await check(page, model.features[0], [50, 40, 30], [70, 70, 38]); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  dialog = await open(page); await dialog.getByRole("combobox", { name: "Alignment geometry", exact: true }).selectOption("point"); await dialog.getByRole("combobox", { name: "Source geometry", exact: true }).selectOption(`${source}:point:0`); await dialog.getByRole("combobox", { name: "Target geometry", exact: true }).selectOption(`${target}:point:1`); await expect(dialog.getByRole("button", { name: "Apply component placement" })).toBeEnabled(); await dialog.getByText("Details · exact placement", { exact: true }).click(); await expect(dialog.getByLabel("Position Y (mm)")).toHaveValue("70"); await dialog.getByRole("button", { name: "Cancel placement" }).click(); await check(page, model.features[0], [50, 40, 30], [70, 70, 38]); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
});
