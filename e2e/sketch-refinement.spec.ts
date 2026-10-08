import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { workbenchTaskFixture } from "./workbenchTaskFixtures";

test("local sketch refinement previews native downstream geometry, Cancel, one Undo, save/open and STL", async ({ page }, info) => {
  let providerRequests = 0;
  await page.route("**/api/ai/generate", async (route) => { providerRequests += 1; await route.abort(); });
  const fixture = workbenchTaskFixture("Extrude");
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "rectangle.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(3072, 5);
  }).toPass();
  await page.getByRole("button", { name: "Section XY plane, 8 entities", exact: true }).click();
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  const panel = page.getByLabel("Sketch refinement", { exact: true });
  const request = panel.getByLabel("Sketch refinement request");
  await request.fill("make a rocket");
  await panel.getByRole("button", { name: "Preview sketch refinement" }).click();
  await expect(panel.getByRole("alert")).toContainText("Supported requests");
  const mixedNativeProof = await page.evaluate(async () => {
    const commandPath = "/src/ui/commands/sketchRefinementCommand.ts";
    const planPath = "/src/ai/sketchRefinement.ts";
    const storePath = "/src/state/useCadStore.ts";
    const commands = await import(commandPath), plans = await import(planPath), store = (await import(storePath)).useCadStore;
    const frame = commands.captureSketchRefinementFrame();
    commands.useSketchRefinement.setState({ frame });
    const plan = plans.buildSketchRefinement(frame.document, frame.active.sketchId, [], "make this rectangle 60 x 40 mm");
    const other = plans.buildSketchRefinement(frame.document, frame.active.sketchId, [], "make this rectangle 30 x 20 mm");
    const preview = await commands.previewSketchRefinement(plan, new AbortController().signal);
    const before = store.getState().history.present;
    let diagnostic = "";
    try { commands.applySketchRefinement(frame, other, preview.result); }
    catch (failure) { diagnostic = failure instanceof Error ? failure.message : String(failure); }
    commands.useSketchRefinement.setState({ frame: undefined });
    return { diagnostic, unchanged: store.getState().history.present === before, source: preview.result.meshes[0].geometrySource, volume: preview.volume };
  });
  expect(mixedNativeProof).toMatchObject({ diagnostic: "Refinement result does not match this proposal. Generate a fresh preview.", unchanged: true, source: "opencascade" });
  expect(mixedNativeProof.volume).toBeCloseTo(19200, 4);
  await request.fill("make this rectangle 60 x 40 mm");
  const before = await aiSnapshot(page);
  await panel.getByRole("button", { name: "Preview sketch refinement" }).click();
  await expect(panel.getByLabel("Sketch refinement status")).toContainText("Native refinement preview ready");
  await expect(panel).toContainText("19200.000 mm³");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await panel.getByRole("button", { name: "Cancel refinement" }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await panel.getByRole("button", { name: "Preview sketch refinement" }).click();
  await expect(panel.getByRole("button", { name: "Apply sketch refinement" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply sketch refinement" }).click();
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(state.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(19200, 4);
    expect(state.past).toBe(before.past + 1);
    const sketch = Object.values(state.document.sketches)[0];
    expect(Object.keys(sketch.entities)).toEqual(Object.keys(Object.values(before.document.sketches)[0].entities));
    expect(sketch.dimensions).toHaveLength(2);
    expect(state.document.features[0].id).toBe(before.document.features[0].id);
    const mesh = state.result!.meshes[0];
    expect(mesh.bounds.max[0] - mesh.bounds.min[0]).toBeCloseTo(60, 5);
    expect(mesh.bounds.max[1] - mesh.bounds.min[1]).toBeCloseTo(40, 5);
    expect(mesh.bounds.max[2] - mesh.bounds.min[2]).toBeCloseTo(8, 5);
  }).toPass({ timeout: 30000 });
  await page.getByRole("button", { name: "Close AI assistant", exact: true }).click();
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(async () => expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(3072, 5)).toPass();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(async () => expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(19200, 4)).toPass();
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("refinement.pcaddoc"); await (await saving).saveAs(path);
  const saved = JSON.parse(await readFile(path, "utf8"));
  const priorOpen = await aiSnapshot(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(priorOpen.session);
  await expect(async () => {
    const reopened = await aiSnapshot(page);
    expect(reopened.status).toBe("succeeded");
    expect(reopened.document.sketches).toEqual(saved.sketches);
    expect(reopened.document.features).toEqual(saved.features);
    expect(reopened.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(19200, 4);
  }).toPass();
  // The full-workspace acceptance fixture exposes STL directly in the ribbon.
  const exportButton = page.getByRole("navigation", { name: "Main CAD commands", exact: true }).getByRole("button", { name: "Export STL", exact: true });
  await expect(exportButton).toBeVisible();
  const exporting = page.waitForEvent("download");
  await exportButton.click();
  const stl = info.outputPath("refinement.stl"); await (await exporting).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(19200, 1);
  expect(providerRequests).toBe(0);
});
