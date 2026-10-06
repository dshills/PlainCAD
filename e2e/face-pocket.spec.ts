import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";

test.use({ storageState: { cookies: [], origins: [] } });
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
      expect(state.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function clickSketch(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  const box = await svg.boundingBox(), viewBox = await svg.getAttribute("viewBox");
  if (!box || !viewBox) throw new Error("Drawing canvas or viewBox unavailable");
  const view = viewBox.split(/[\s,]+/).map(Number);
  await page.mouse.click(box.x + (x - view[0]) / view[2] * box.width, box.y + (-y - view[1]) / view[3] * box.height);
}
async function fixture(page: Page) {
  await page.goto("/"); await ready(page);
  const ids = await page.evaluate(async () => {
    const docsPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", geometryPath = "/src/cad/sketch/canvasGeometry.ts", solvePath = "/src/cad/sketch/SketchSolver.ts", profilePath = "/src/cad/sketch/profileDetection.ts", storePath = "/src/state/useCadStore.ts";
    const docs = await import(docsPath), model = await import(modelPath), geometry = await import(geometryPath), solver = await import(solvePath), profiles = await import(profilePath), { useCadStore } = await import(storePath);
    const base = model.createXySketch("Plate outline"), sketch = geometry.addCanvasGeometry(base, solver.solveSketch(base, {}), "rectangle", [{ x: 0, y: 0 }, { x: 40, y: 30 }]).sketch;
    const profile = profiles.detectProfiles(solver.solveSketch(sketch, {})).profiles[0];
    const feature = docs.createExtrudeFeature({ name: "Plate", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "10mm", unit: "mm" } });
    useCadStore.getState().setDocument(docs.upsertFeature(docs.upsertSketch(docs.createEmptyDocument("Face pocket proof"), sketch), feature));
    const segment = profile.outerLoop.segments.find((segment: { type: string }) => segment.type === "line");
    return { ownerId: feature.id, sideId: segment!.id };
  });
  await ready(page, 12000); return ids;
}
for (const role of ["endCap", "side"] as const) test(`${role} Draw here → mouse region → inward native pocket → Undo/save/open/STL`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const ids = await fixture(page), initial = await aiSnapshot(page);
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; (await import(path)).runCommand("sketch.facePocket"); });
  const picker = page.getByRole("region", { name: "Draw on a face" });
  await expect(picker.getByRole("button", { name: "Draw here", exact: true })).toBeDisabled();
  // Click an actual viewer face for the cap; the keyboard cards cover side selection.
  if (role === "endCap") {
    const point = await page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).projectViewerPoint([20, 15, 10]); });
    const box = await page.locator(".viewer-canvas canvas").boundingBox();
    if (!point || !box) throw new Error("Viewer projection unavailable");
    await page.mouse.click(box.x + point.x, box.y + point.y);
  } else {
    await picker.getByRole("button", { name: `Plate — side ${ids.sideId}`, exact: true }).focus();
    await picker.getByRole("button", { name: `Plate — side ${ids.sideId}`, exact: true }).press("Enter");
  }
  await expect(picker.getByRole("status")).toContainText("inward");
  expect((await aiSnapshot(page)).past).toBe(initial.past);
  await picker.getByRole("button", { name: "Draw here", exact: true }).click();
  const faceSketch = await page.evaluate(async () => { const path = "/src/ui/commands/sketchCanvasCommand.ts"; return (await import(path)).useSketchCanvas.getState().active.sketchId; });
  expect((await aiSnapshot(page)).past).toBe(initial.past + 1);
  await page.getByRole("button", { name: "Draw tool: rectangle", exact: true }).click();
  await clickSketch(page, 10, role === "endCap" ? 10 : 3);
  await clickSketch(page, 20, role === "endCap" ? 20 : 7);
  await expect.poll(async () => (await aiSnapshot(page)).result?.profiles?.[faceSketch]?.length).toBe(1);
  await ready(page, 12000);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  const handoff = page.getByRole("region", { name: "Make solid from finished sketch" });
  await expect(handoff).toContainText("Target: Plate");
  await handoff.getByRole("button", { name: "Remove material", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove material", exact: true });
  await expect(dialog.getByLabel("Extrude direction", { exact: true })).toHaveValue("negative");
  await expect(dialog.getByLabel("Extrude direction", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Extrude operation", { exact: true })).toHaveValue("cut");
  await expect(dialog.getByLabel("Extrude operation", { exact: true })).toBeDisabled();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("2mm");
  await expect(dialog.getByRole("status")).toContainText("Native preview ready");
  const beforeApply = await aiSnapshot(page);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await aiSnapshot(page)).document).toEqual(beforeApply.document);
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; (await import(path)).runCommand("sketch.editCanvas"); });
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await handoff.getByRole("button", { name: "Remove material", exact: true }).click();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("2mm");
  await expect(dialog.getByRole("status")).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Apply pocket", exact: true }).click();
  const volume = role === "endCap" ? 11800 : 11920;
  await ready(page, volume);
  const accepted = await aiSnapshot(page);
  expect(accepted.past).toBe(beforeApply.past + 1);
  expect(accepted.document.features.at(-1)).toMatchObject({ operation: "cut", direction: "negative", sketchId: faceSketch, targetBodyIds: [`body:${ids.ownerId}`] });
  expect(accepted.result!.meshes[0].kernelOperation).toBe("cut");
  for (const [side, expected] of [["min", [0, 0, 0]], ["max", [40, 30, 10]]] as const) expected.forEach((value, axis) => expect(accepted.result!.meshes[0].bounds[side][axis]).toBeCloseTo(value, 6));
  await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; (await import(path)).useCadStore.getState().undo(); });
  await ready(page, 12000);
  await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; (await import(path)).useCadStore.getState().redo(); });
  await ready(page, volume);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = info.outputPath(`${role}-pocket.pcaddoc`); await (await saving).saveAs(projectPath);
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(accepted.session);
  await ready(page, volume);
  expect((await aiSnapshot(page)).document.features).toEqual(accepted.document.features);
  await page.locator(".file-menu > summary").click(); const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath(`${role}-pocket.stl`); await (await exporting).saveAs(stlPath);
  expect(stlSignedVolume(await readFile(stlPath))).toBeCloseTo(volume, 3);
  expect(errors).toEqual([]);
});
