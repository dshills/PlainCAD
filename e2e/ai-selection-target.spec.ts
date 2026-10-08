import { expect, test, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { separatePartsPlan } from "../src/tests/fixtures/aiTargetsPlan";

async function providers(page: Page) {
  await page.route("**/api/ai/status", route => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map(id => ({ id, label: id, available: true, model: "test-model" })) } }));
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}
async function ready(page: Page, volume: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.meshes.length).toBeGreaterThan(0);
    expect(state.result!.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid && mesh.geometryAssertions.solidCount === 1)).toBe(true);
    expect(state.result!.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0)).toBeCloseTo(volume, 5);
  }).toPass({ timeout: 30000 });
}
async function select(page: Page, kind: "body" | "edge", id: string) {
  await page.evaluate(async ({ kind, id }) => { const path = "/src/state/useCadStore.ts", store = (await import(path)).useCadStore; store.getState().select({ kind, id, documentId: store.getState().history.present.id }); }, { kind, id });
}

test("selected native body sends only its independent driver, rejects escaped edits, and invalidates late responses when selection changes", async ({ page }) => {
  test.setTimeout(120000);
  await providers(page);
  const ids = await page.evaluate(async plan => {
    const buildPath = "/src/ai/buildPlan.ts", docsPath = "/src/cad/document/CadDocument.ts", statePath = "/src/state/useCadStore.ts";
    const staged = (await import(buildPath)).buildAiPlan((await import(docsPath)).createEmptyDocument(), plan), store = (await import(statePath)).useCadStore;
    store.getState().setDocument(staged.document); store.getState().activateComponent(staged.componentId); return staged.bodyIds;
  }, separatePartsPlan);
  await ready(page, 1500);
  await select(page, "body", ids[0]);
  const requests: Array<Record<string, unknown>> = [], held: { release?: () => void } = {};
  let markLateResponseFulfilled!: () => void;
  const lateResponseFulfilled = new Promise<void>(resolve => { markLateResponseFulfilled = resolve; });
  await page.route("**/api/ai/generate", async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await new Promise<void>(resolve => { held.release = resolve; });
    await route.fulfill({ json: { plan: { name: "Width edit", summary: "Change width", warnings: [], steps: [], parameters: [{ name: requests.length === 1 ? "ai_1_width" : "ai_1_depth", value: 24, unit: "mm" }] } } });
    if (requests.length === 1) markLateResponseFulfilled();
  });
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI modeling assistant" });
  await expect(panel.getByLabel("AI selected target")).toContainText("follows selection");
  await expect(panel.getByRole("combobox", { name: "AI scope", exact: true })).toHaveValue("auto");
  const prompt = panel.getByLabel("What would you like to make?"), generate = panel.getByRole("button", { name: "Generate preview" });
  await prompt.fill("Increase its width slightly while keeping the rest"); await expect(generate).toBeEnabled(); await generate.click();
  await expect.poll(() => requests.length).toBe(1);
  const context = requests[0].editContext as { parameters: Array<{ name: string }> };
  expect(context.parameters.map(parameter => parameter.name)).toEqual(["ai_1_width"]);
  const before = await aiSnapshot(page);
  await select(page, "body", ids[1]);
  if (!held.release) throw new Error("Missing held provider response"); held.release();
  await lateResponseFulfilled;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(generate).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Apply AI parameter edits" })).toBeDisabled();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await select(page, "body", ids[0]); await generate.click();
  await expect(panel.getByRole("alert").filter({ hasText: /outside the selected target|can change only ai_1_width/ })).toBeVisible();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await panel.getByRole("combobox", { name: "AI scope", exact: true }).selectOption("create");
  await expect(panel.getByLabel("AI selected target")).toContainText("explicit scope");
  await select(page, "edge", "unsupported-edge");
  await page.getByRole("button", { name: "Follow current selection", exact: true }).click();
  await expect(panel.getByRole("alert").filter({ hasText: "Choose a part or supported feature" })).toBeVisible();
  await expect(generate).toBeDisabled();
});

test("one deliberate native face click routes AI additions and previews a real inward cut without changing the project until Apply", async ({ page }) => {
  test.setTimeout(120000);
  await providers(page);
  const featureId = await page.evaluate(async () => {
    const docsPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", solverPath = "/src/cad/sketch/SketchSolver.ts", profilesPath = "/src/cad/sketch/profileDetection.ts", statePath = "/src/state/useCadStore.ts";
    const docs = await import(docsPath), model = await import(modelPath), solver = await import(solverPath), profiles = await import(profilesPath), state = await import(statePath);
    const sketch = model.addCornerRectangle(model.createXySketch("Outline"), "40mm", "30mm");
    const feature = docs.createExtrudeFeature({ name: "Plate", sketchId: sketch.id, profileId: profiles.detectProfiles(solver.solveSketch(sketch, {})).profiles[0].id, direction: "positive", operation: "newBody", distance: { expression: "10mm", unit: "mm" } });
    state.useCadStore.getState().setDocument(docs.upsertFeature(docs.upsertSketch(docs.createEmptyDocument("Picked face"), sketch), feature)); return feature.id;
  });
  await ready(page, 12000);
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  await page.getByRole("button", { name: "Choose face on model", exact: true }).click();
  const point = await page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).projectViewerPoint([20, 15, 10]); });
  const bounds = await page.locator(".viewer-canvas canvas").boundingBox();
  if (!point || !bounds) throw new Error("Missing native viewport projection");
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
  const panel = page.getByLabel("AI feature additions", { exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Feature target face")).toHaveValue(`extrude:${featureId}:endCap`);
  let requests = 0;
  await page.route("**/api/ai/features", route => { requests++; return route.fulfill({ json: { proposal: { summary: "One 3 mm through hole", warnings: [], actions: [{ kind: "holes", centers: [{ x: "20mm", y: "15mm" }], diameter: "3mm", depth: "throughAll" }] } } }); });
  const before = await aiSnapshot(page);
  await panel.getByLabel("Feature request").fill("Put a 3 mm through hole at the face center"); await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Generate AI feature preview" }).click();
  const apply = panel.getByRole("button", { name: "Apply AI feature plan" }); await expect(apply).toBeEnabled({ timeout: 60000 });
  expect((await aiSnapshot(page)).document).toEqual(before.document); expect((await aiSnapshot(page)).past).toBe(before.past);
  await apply.click(); await ready(page, 12000 - Math.PI * 1.5 ** 2 * 10);
  expect((await aiSnapshot(page)).past).toBe(before.past + 1); expect(requests).toBe(1);
});
