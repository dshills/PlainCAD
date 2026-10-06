import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

test.use({ storageState: { cookies: [], origins: [] } });

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
      expect(state.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function fixture(page: Page, plane: "XY" | "XZ") {
  await page.goto("/");
  await ready(page);
  const sketchId = await page.evaluate(async (plane) => {
    const docsPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts",
      geometryPath = "/src/cad/sketch/canvasGeometry.ts", solverPath = "/src/cad/sketch/SketchSolver.ts",
      storePath = "/src/state/useCadStore.ts";
    const docs = await import(docsPath), { createSketchOnPlane } = await import(modelPath),
      { addCanvasGeometry } = await import(geometryPath), { solveSketch } = await import(solverPath),
      { useCadStore } = await import(storePath);
    let sketch = createSketchOnPlane("Two shapes", plane);
    for (const [start, end] of [[{ x: -10, y: -6 }, { x: 10, y: 6 }], [{ x: 35, y: -4 }, { x: 47, y: 4 }]])
      sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [start, end]).sketch;
    const otherBase = createSketchOnPlane("Unrelated shape", plane);
    const other = addCanvasGeometry(otherBase, solveSketch(otherBase, {}),
      "rectangle", [{ x: 55, y: 0 }, { x: 65, y: 5 }]).sketch;
    const document = docs.upsertSketch(docs.upsertSketch(docs.createEmptyDocument("Handoff proof"), sketch), other);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return sketch.id;
  }, plane);
  await ready(page);
  return sketchId;
}
async function finish(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/ui/commands/commandRegistry.ts";
    (await import(path)).runCommand("sketch.editCanvas");
  });
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect(page.getByRole("region", { name: "Make solid from finished sketch" })).toBeVisible();
}
async function regionPoint(page: Page, sketchId: string) {
  const point = await page.evaluate(async (sketchId) => {
    const statePath = "/src/state/useCadStore.ts", planesPath = "/src/cad/sketch/planes.ts", viewerPath = "/src/viewer/viewerDiagnostics.ts";
    const state = (await import(statePath)).useCadStore.getState();
    const world = (await import(planesPath)).transformPoint(state.rebuild.result.sketchPlanes[sketchId], 41, 0, 0);
    return (await import(viewerPath)).projectViewerPoint([world.x, world.y, world.z]);
  }, sketchId);
  const box = await page.locator(".viewer-canvas canvas").boundingBox();
  if (!point || !box) throw new Error("Profile projection unavailable");
  return { x: box.x + point.x, y: box.y + point.y };
}
for (const plane of ["XY", "XZ"] as const) test(`${plane} Finish Sketch selects an explicit native region before Make solid, Cancel, save/open/STL`, async ({ page }, info) => {
  const sketchId = await fixture(page, plane);
  const before = await aiSnapshot(page);
  await finish(page);
  const handoff = page.getByRole("region", { name: "Make solid from finished sketch" });
  await expect(handoff.getByRole("button", { name: "Make solid", exact: true })).toBeDisabled();
  await expect(handoff.getByRole("group", { name: "Closed sketch regions" }).getByRole("button")).toHaveCount(2);
  await expect(handoff).not.toContainText("Unrelated shape");
  const point = await regionPoint(page, sketchId);
  await page.mouse.click(point.x, point.y);
  await expect(handoff.getByRole("button", { pressed: true })).toHaveCount(1);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await expect(page.getByRole("dialog", { name: "Extrude", exact: true })).toHaveCount(0);
  await handoff.getByRole("button", { name: "Make solid", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await expect(dialog.getByRole("status")).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await finish(page);
  // The cards provide a keyboard alternative to canvas picking.
  const cards = handoff.getByRole("group", { name: "Closed sketch regions" }).getByRole("button");
  const profiles = (await aiSnapshot(page)).result!.profiles![sketchId];
  const targetIndex = profiles.findIndex((profile) => profile.bounds.minX >= 35);
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  await cards.nth(targetIndex).focus();
  await cards.nth(targetIndex).press("Enter");
  await handoff.getByRole("button", { name: "Make solid", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("7mm");
  await applyExtrusion(page);
  await ready(page, 672);
  const final = await aiSnapshot(page);
  expect(final.past).toBe(before.past + 1);
  expect(final.document.features[0]).toMatchObject({ type: "extrude", sketchId, profileId: profiles[targetIndex].id });
  const expected = plane === "XY" ? { min: [35, -4, 0], max: [47, 4, 7] } : { min: [35, -7, -4], max: [47, 0, 4] };
  for (const side of ["min", "max"] as const) expected[side].forEach((value, axis) => expect(final.result!.meshes[0].bounds[side][axis]).toBeCloseTo(value, 6));
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = info.outputPath(`${plane}-handoff.pcaddoc`);
  await (await saving).saveAs(projectPath);
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(final.session);
  await ready(page, 672);
  expect((await aiSnapshot(page)).document.features).toEqual(final.document.features);
  await page.locator(".file-menu > summary").click();
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath(`${plane}-handoff.stl`);
  await (await exporting).saveAs(stlPath);
  expect(stlSignedVolume(await readFile(stlPath))).toBeCloseTo(672, 3);
});

test("a same-ID project replacement rejects an old finished-sketch region callback", async ({ page }) => {
  await fixture(page, "XY");
  await finish(page);
  await expect(page.getByRole("group", { name: "Closed sketch regions" }).getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("group", { name: "Closed sketch regions" }).getByRole("button").first()).toBeEnabled();
  const rejection = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts", operationPath = "/src/ui/commands/operationDropCommand.ts",
      handoffPath = "/src/ui/commands/sketchSolidHandoffCommand.ts";
    const { useCadStore } = await import(storePath), { useOperationDrop, operationDropTargets } = await import(operationPath),
      { chooseSketchSolidRegion } = await import(handoffPath);
    const frame = useOperationDrop.getState().frame;
    const target = operationDropTargets("extrude", useCadStore.getState(), frame?.handoffSketchId)[0];
    if (!frame || !target) throw new Error("Native region frame unavailable");
    useCadStore.getState().setDocument(structuredClone(useCadStore.getState().history.present));
    try { chooseSketchSolidRegion(frame, target.id); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
    return "callback accepted";
  });
  expect(rejection).toContain("sketch or project changed");
  await expect(page.getByRole("region", { name: "Make solid from finished sketch" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Extrude", exact: true })).toHaveCount(0);
  await ready(page);
  expect((await aiSnapshot(page)).document.features).toEqual([]);
});
