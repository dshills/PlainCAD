import { expect, test, type Page } from "@playwright/test";
import { aiPlatePlan } from "../src/tests/fixtures/aiPlan";
import { aiSnapshot } from "./aiAcceptanceHelpers";

async function nativeVolume(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    if (expected === 0) { expect(state.result?.meshes).toHaveLength(0); return; }
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(expected, 5);
  }).toPass({ timeout: 30000 });
}

async function setup(page: Page) {
  await page.route("**/api/ai/status", route => route.fulfill({ json: {
    providers: ["anthropic", "openai", "google"].map(id => ({ id, label: id, available: true, model: "test-model" })),
  } }));
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await nativeVolume(page, 0);
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  return page.getByRole("region", { name: "AI modeling assistant" });
}

test("canvas AI create has one native undo/redo step, local history prompts bypass provider configuration and protect manual edits", async ({ page }) => {
  test.setTimeout(120000);
  let requests = 0;
  await page.route("**/api/ai/generate", route => { requests++; return route.fulfill({ json: { plan: aiPlatePlan } }); });
  const panel = await setup(page);
  const prompt = panel.getByLabel("What would you like to make?"), generate = panel.getByRole("button", { name: "Generate preview" });
  const before = await aiSnapshot(page);
  await prompt.fill(aiPlatePlan.summary);
  await generate.click();
  const apply = panel.getByRole("button", { name: "Apply AI component" });
  await expect(apply).toBeEnabled({ timeout: 60000 });
  await apply.click();
  const volume = 12000 - Math.PI * 2 ** 2 * 5;
  await nativeVolume(page, volume);
  const applied = await aiSnapshot(page);
  expect(applied.past).toBe(before.past + 1);
  expect(applied.document.features).toHaveLength(2);
  expect(requests).toBe(1);
  await panel.getByLabel("AI model", { exact: true }).fill("");
  await prompt.fill("undo that");
  await expect(generate).toBeEnabled(); await generate.click();
  await nativeVolume(page, 0);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  expect(requests).toBe(1);
  await prompt.fill("redo that"); await expect(generate).toBeEnabled(); await generate.click();
  await nativeVolume(page, volume);
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  expect(requests).toBe(1);
  const thickness = page.getByRole("textbox", { name: "Parameter ai_1_thickness expression", exact: true });
  await thickness.fill("6mm"); await thickness.press("Enter");
  await nativeVolume(page, (60 * 40 - Math.PI * 2 ** 2) * 6);
  const manuallyEdited = await aiSnapshot(page);
  await prompt.fill("undo that"); await expect(generate).toBeEnabled(); await generate.click();
  await expect(panel).toContainText("latest AI change cannot be undone");
  expect((await aiSnapshot(page)).document).toEqual(manuallyEdited.document);
  expect((await aiSnapshot(page)).past).toBe(manuallyEdited.past);
  expect(requests).toBe(1);
});

test("canvas AI adds holes and pocket in one native history step and local undo/redo needs no new sharing consent", async ({ page }) => {
  test.setTimeout(120000);
  let requests = 0;
  await page.route("**/api/ai/features", route => {
    requests++;
    return route.fulfill({ json: { proposal: { summary: "Four holes and a pocket", warnings: [], actions: [
      { kind: "holes", centers: [{ x: "5mm", y: "5mm" }, { x: "35mm", y: "5mm" }, { x: "5mm", y: "25mm" }, { x: "35mm", y: "25mm" }], diameter: "3mm", depth: "throughAll" },
      { kind: "pocket", profile: { type: "rectangle", x: "15mm", y: "10mm", width: "10mm", height: "10mm" }, depth: "2mm" },
    ] } } });
  });
  await setup(page);
  const featureId = await page.evaluate(async () => {
    const docsPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", solverPath = "/src/cad/sketch/SketchSolver.ts", profilesPath = "/src/cad/sketch/profileDetection.ts", statePath = "/src/state/useCadStore.ts";
    const docs = await import(docsPath), model = await import(modelPath), solver = await import(solverPath), profiles = await import(profilesPath), state = await import(statePath);
    const sketch = model.addCornerRectangle(model.createXySketch("Outline"), "40mm", "30mm");
    const feature = docs.createExtrudeFeature({ name: "Plate", sketchId: sketch.id, profileId: profiles.detectProfiles(solver.solveSketch(sketch, {})).profiles[0].id, direction: "positive", operation: "newBody", distance: { expression: "10mm", unit: "mm" } });
    state.useCadStore.getState().setDocument(docs.upsertFeature(docs.upsertSketch(docs.createEmptyDocument("AI additions"), sketch), feature));
    return feature.id;
  });
  await nativeVolume(page, 12000);
  await page.getByRole("button", { name: "Add features to this part", exact: true }).click();
  const panel = page.getByLabel("AI feature additions", { exact: true });
  await panel.getByLabel("Feature target face").selectOption(`extrude:${featureId}:endCap`);
  const prompt = panel.getByLabel("Feature request"), generate = panel.getByRole("button", { name: "Generate AI feature preview" });
  await prompt.fill("Add four mounting holes and a pocket");
  await panel.getByRole("checkbox").check();
  const before = await aiSnapshot(page);
  await generate.click();
  await expect(panel.getByRole("button", { name: "Apply AI feature plan" })).toBeEnabled({ timeout: 60000 });
  await panel.getByRole("button", { name: "Apply AI feature plan" }).click();
  const volume = 12000 - 4 * Math.PI * 1.5 ** 2 * 10 - 200;
  await nativeVolume(page, volume);
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  expect((await aiSnapshot(page)).document.features).toHaveLength(3);
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await prompt.fill("undo that"); await expect(generate).toBeEnabled(); await generate.click();
  await nativeVolume(page, 12000);
  const undone = await aiSnapshot(page);
  expect(undone.past).toBe(before.past);
  expect(undone.document).toEqual(before.document);
  await prompt.fill("redo that"); await expect(generate).toBeEnabled(); await generate.click(); await nativeVolume(page, volume);
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  expect((await aiSnapshot(page)).document.features).toHaveLength(3);
  expect(requests).toBe(1);
});
