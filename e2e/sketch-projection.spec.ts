import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addCornerRectangle, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { aiSnapshot } from "./aiAcceptanceHelpers";
function fixture(oblique = false) {
  const sketch = addCornerRectangle(createSketchOnPlane("Source rectangle", "XY"), "width", "20mm");
  const profile = detectProfiles(solveSketch(sketch, { width: { value: 30, unit: "mm", dimension: "length" } })).profiles[0];
  const feature = createExtrudeFeature({ name: "Reference block", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
  let document = upsertFeature(upsertSketch(upsertParameter(createEmptyDocument("Linked cover"), { id: "projection_width", name: "width", expression: "30mm", unit: "mm", value: 30 }), sketch), feature);
  const target = createSketchOnPlane("Cover outline", { type: "offset", base: oblique ? "XZ" : "XY", offset: { expression: "12mm", unit: "mm" } });
  document = upsertSketch(document, target);
  return { document, target, feature };
}
async function native(page: Page, volume: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result!.errors).toEqual([]);
    expect(state.result!.meshes).toHaveLength(1);
    expect(state.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 7);
  }).toPass();
}
async function openCanvas(page: Page, targetId: string) {
  await page.evaluate(async (id) => {
    const sp = "/src/state/useCadStore.ts";
    const state = (await import(sp)).useCadStore.getState(); state.select({ kind: "sketch", id, documentId: state.history.present.id });
  }, targetId);
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
}
async function configure(page: Page) {
  await page.getByRole("button", { name: "Project part edges into sketch", exact: true }).click();
  const panel = page.getByRole("region", { name: "Project part edges", exact: true });
  await expect(panel.getByLabel("Source part boundary").locator("option")).toHaveCount(3);
  const end = await panel.getByLabel("Source part boundary").locator("option").evaluateAll((options) => options.find((option) => option.textContent?.includes("End cap"))?.getAttribute("value"));
  expect(end, "A native End cap choice must exist").toBeTruthy();
  await panel.getByLabel("Source part boundary").selectOption(end!);
  await panel.getByRole("button", { name: "Preview projected boundary" }).click();
  return panel;
}

test("projects native authored caps associatively with preview, one Undo, source edit, save/open and break link", async ({ page }, info) => {
  const model = fixture();
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "projection.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
  await native(page, 4800);
  await openCanvas(page, model.target.id);
  const original = await aiSnapshot(page), panel = await configure(page);
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await expect(panel.getByRole("img", { name: "Linked projected sketch preview" })).toBeVisible();
  expect((await aiSnapshot(page)).document).toEqual(original.document);
  await panel.getByRole("button", { name: "Cancel projection" }).click();
  expect((await aiSnapshot(page)).past).toBe(original.past);
  const again = await configure(page);
  await expect(again.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await again.getByRole("button", { name: "Apply projected boundary" }).click();
  await native(page, 4800);
  const applied = await aiSnapshot(page), target = applied.document.sketches[model.target.id];
  expect(applied.past).toBe(original.past + 1); expect(target.projections).toHaveLength(1);
  expect(Object.keys(target.entities)).toHaveLength(8);
  await page.getByRole("button", { name: "Draw tool: select", exact: true }).click();
  const selection = page.getByLabel("Selected sketch item", { exact: true });
  await selection.selectOption(target.projections![0].members[0].targetEntityId);
  await expect(page.getByRole("region", { name: "Linked projected boundaries" })).toContainText("linked and read-only");
  await expect(page.getByRole("button", { name: "Delete selected sketch item", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await native(page, 4800); expect((await aiSnapshot(page)).document.sketches[model.target.id].projections ?? []).toEqual([]);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await native(page, 4800);
  const width = page.getByRole("textbox", { name: "Parameter width expression", exact: true });
  await width.fill("42mm"); await width.press("Enter"); await native(page, 6720);
  const edited = await aiSnapshot(page), solved = edited.result!.solvedSketches![model.target.id];
  expect(Math.max(...Object.values(solved.points).map((point) => point.x))).toBeCloseTo(42, 8);
  expect(edited.result!.sketchPlanes![model.target.id].origin.z).toBe(12);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("linked-cover.pcaddoc"); await (await download).saveAs(path);
  const saved = JSON.parse(await readFile(path, "utf8")); expect(saved.sketches[model.target.id].projections).toHaveLength(1);
  const savedSession = edited.session;
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(savedSession);
  await native(page, 6720);
  await openCanvas(page, model.target.id);
  await page.getByRole("button", { name: "Break projection link", exact: true }).click(); await native(page, 6720);
  expect((await aiSnapshot(page)).document.sketches[model.target.id].projections ?? []).toEqual([]);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await width.fill("50mm"); await width.press("Enter"); await native(page, 8000);
  expect(Math.max(...Object.values((await aiSnapshot(page)).result!.solvedSketches![model.target.id].points).map((point) => point.x))).toBeCloseTo(42, 8);
});

test("oblique projection fails explicitly without changing document or history", async ({ page }) => {
  const model = fixture(true); await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "oblique.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
  await native(page, 4800); await openCanvas(page, model.target.id);
  const before = await aiSnapshot(page), panel = await configure(page);
  await expect(panel.getByRole("alert")).toContainText("parallel planes");
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeDisabled();
  const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.past).toBe(before.past);
});


test("repairs the same authored cap role without new member IDs and removes a lost-source link explicitly", async ({ page }) => {
  const model = fixture(); await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "repair.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
  await native(page, 4800); await openCanvas(page, model.target.id);
  const panel = await configure(page); await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply projected boundary" }).click(); await native(page, 4800);
  const before = await aiSnapshot(page), previous = before.document.sketches[model.target.id].projections![0];
  await page.getByRole("button", { name: "Reselect projected boundary", exact: true }).click();
  const repair = page.getByRole("region", { name: "Project part edges", exact: true });
  await expect(repair.getByLabel("Source part boundary").locator("option")).toHaveCount(3);
  const start = await repair.getByLabel("Source part boundary").locator("option").evaluateAll((options) => options.find((option) => option.textContent?.includes("Start cap"))?.getAttribute("value"));
  expect(start, "A native Start cap choice must exist").toBeTruthy();
  await repair.getByLabel("Source part boundary").selectOption(start!);
  await repair.getByRole("button", { name: "Preview projected boundary" }).click(); await expect(repair.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await repair.getByRole("button", { name: "Apply projected boundary" }).click(); await native(page, 4800);
  const repaired = await aiSnapshot(page), link = repaired.document.sketches[model.target.id].projections![0];
  expect(link.id).toBe(previous.id); expect(link.members).toEqual(previous.members); expect(link.role).toBe("startCapPerimeter"); expect(repaired.past).toBe(before.past + 1);
  // Simulate a document/import losing its upstream owner; repair must be possible
  // with a failed current rebuild and must not reuse prior native proof.
  await page.evaluate(async (featureId) => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateDocument((document: import("../src/cad/document/schema").CadDocument) => ({ ...document, features: document.features.filter((feature) => feature.id !== featureId) }));
  }, model.feature.id);
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("failed");
  expect((await aiSnapshot(page)).result!.errors.some((error) => error.sourceId === model.target.id && /missing|unsupported/i.test(error.message))).toBe(true);
  await expect(page.getByRole("button", { name: "Break projection link", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove projection and geometry", exact: true }).click();
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  const removed = await aiSnapshot(page);
  expect(removed.document.sketches[model.target.id].projections ?? []).toEqual([]);
  expect(removed.document.sketches[model.target.id].entities).toEqual({});
});
