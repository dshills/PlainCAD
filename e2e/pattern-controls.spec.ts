import { expect, test, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function state(page: Page): Promise<{ document: CadDocument; result: RebuildResult; status: string; past: number }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", value = (await import(path)).useCadStore.getState();
    return { document: value.history.present, result: value.rebuild.result, status: value.rebuild.status, past: value.history.past.length };
  });
}
async function native(page: Page, expectedVolume: number) {
  await expect(async () => {
    const snapshot = await state(page);
    expect(snapshot.status).toBe("succeeded"); expect(snapshot.result.success).toBe(true); expect(snapshot.result.errors).toEqual([]);
    expect(snapshot.result.meshes).toHaveLength(1);
    expect(snapshot.result.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(Math.abs(snapshot.result.meshes[0].geometryAssertions!.volume - expectedVolume) / expectedVolume).toBeLessThan(1e-8);
  }).toPass({ timeout: 25000 });
}
async function setup(page: Page, plane: "XY" | "YZ", x: string) {
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.evaluate(async ({ plane, x }) => {
    const path = "/src/state/useCadStore.ts", docPath = "/src/cad/document/CadDocument.ts", sketchesPath = "/src/cad/sketch/SketchModel.ts", solverPath = "/src/cad/sketch/SketchSolver.ts", profilesPath = "/src/cad/sketch/profileDetection.ts";
    const { useCadStore } = await import(path), ops = await import(docPath), sketches = await import(sketchesPath), { solveSketch } = await import(solverPath), { detectProfiles } = await import(profilesPath);
    let document = ops.createEmptyDocument("Mouse pattern test");
    document = ops.upsertParameter(document, { id: "pitch-id", name: "pitch", expression: "10mm", value: 10, unit: "mm", authoredUnit: "mm" });
    const profile = sketches.addCenterRectangle(sketches.createSketchOnPlane("Base", plane), "80mm", "50mm"), base = ops.createExtrudeFeature({ name: "Base", sketchId: profile.id, profileId: detectProfiles(solveSketch(profile, {})).profiles[0].id, operation: "newBody", distance: { expression: "20mm", unit: "mm" }, direction: "positive" });
    document = ops.upsertFeature(ops.upsertSketch(document, profile), base);
    const center = sketches.addPoint(sketches.createSketchOnPlane("Seed", plane), x, "0mm");
    document = ops.upsertFeature(ops.upsertSketch(document, center.sketch), { id: "seed", type: "hole", name: "Seed", sketchId: center.sketch.id, centerPointIds: [center.pointId], diameter: { expression: "4mm", unit: "mm" }, depth: "throughAll", targetBodyIds: [`body:${base.id}`] });
    useCadStore.getState().setDocument(document); useCadStore.getState().select({ kind: "feature", id: "seed", documentId: document.id });
  }, { plane, x });
  await native(page, 80000 - Math.PI * 4 * 20);
  await page.getByRole("button", { name: "Repeat selected hole or pocket", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create feature pattern" });
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  return dialog;
}
async function dragPoint(page: Page, dialog: Locator, handleName: string, x: number, y: number, cancel = false, verifyPending = false) {
  const svg = dialog.getByRole("img", { name: "Pattern arrangement plan" }), handle = dialog.getByRole("img", { name: handleName });
  const target = await handle.boundingBox();
  expect(target).toBeTruthy();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2); await page.mouse.down();
  const destination = await svg.evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("Pattern arrangement screen transform is unavailable.");
    const target = new DOMPoint(point.x, -point.y).matrixTransform(matrix);
    return { x: target.x, y: target.y };
  }, { x, y });
  await page.mouse.move(destination.x, destination.y, { steps: 6 });
  if (verifyPending) {
    await expect(dialog.getByRole("button", { name: "Apply pattern", exact: true })).toBeDisabled();
    await expect(dialog.getByText("Showing the last validated native preview. It does not yet match the current arrangement.")).toBeVisible();
  }
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
function hasVertex(result: RebuildResult, target: number[]) {
  const values = result.meshes[0].positions;
  for (let i = 0; i < values.length; i += 3) if (target.every((value, axis) => Math.abs(values[i + axis] - value) < 1e-4)) return true;
  return false;
}
test("mouse spacing protects formulas, cancels drag, and saves real native copies", async ({ page }, info) => {
  const dialog = await setup(page, "XY", "-20mm"), before = await state(page);
  await dialog.getByLabel("Pattern spacing", { exact: true }).fill("pitch * 2");
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await dragPoint(page, dialog, "Drag pattern spacing", 5, 0);
  await expect(dialog.getByLabel("Pattern spacing", { exact: true })).toHaveValue("pitch * 2");
  await dialog.getByRole("checkbox", { name: "Allow dragging to replace formulas with literal values" }).check();
  await dragPoint(page, dialog, "Drag pattern spacing", 5, 0, true);
  await expect(dialog.getByLabel("Pattern spacing", { exact: true })).toHaveValue("pitch * 2");
  expect((await state(page)).document).toEqual(before.document);
  await dragPoint(page, dialog, "Drag pattern spacing", -2, 0);
  const spacingExpression = await dialog.getByLabel("Pattern spacing", { exact: true }).inputValue();
  expect(spacingExpression).toMatch(/mm$/);
  expect(Number.parseFloat(spacingExpression)).toBeCloseTo(18, 4);
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Apply pattern", exact: true }).click();
  await native(page, 80000 - 3 * Math.PI * 4 * 20);
  const finished = await state(page);
  expect(finished.past).toBe(before.past + 1);
  for (const x of [-20, -2, 16]) expect(hasVertex(finished.result, [x + 2, 0, 20])).toBe(true);
  const save = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const filename = info.outputPath("mouse-pattern.pcaddoc"); await (await save).saveAs(filename);
  expect(JSON.parse(await readFile(filename, "utf8")).features.at(-1).pattern.spacing.expression).toBe(spacingExpression);
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click(); await native(page, 80000);
  await page.locator('input[type="file"]').setInputFiles(filename); await native(page, 80000 - 3 * Math.PI * 4 * 20);
  for (const x of [-20, -2, 16]) expect(hasVertex((await state(page)).result, [x + 2, 0, 20])).toBe(true);
});
test("circular mouse center and signed sweep use YZ coordinates with stale Apply blocked", async ({ page }) => {
  const dialog = await setup(page, "YZ", "12mm");
  await dialog.getByLabel("Pattern type", { exact: true }).selectOption("circular");
  await dialog.getByLabel("Pattern sweep angle", { exact: true }).fill("-180deg");
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await dragPoint(page, dialog, "Drag pattern center", 0, 2);
  expect(Number.parseFloat(await dialog.getByLabel("Pattern center Y", { exact: true }).inputValue())).toBeCloseTo(2, 4);
  await dragPoint(page, dialog, "Drag pattern center", 0, 0);
  await dragPoint(page, dialog, "Drag pattern sweep", 0, -12, false, true);
  // Browser pointer coordinates have finite precision; verify the intended angle
  // without requiring a pixel-derived literal to be mathematically exact.
  const sweepExpression = await dialog.getByLabel("Pattern sweep angle", { exact: true }).inputValue();
  expect(sweepExpression).toMatch(/deg$/);
  expect(Number.parseFloat(sweepExpression)).toBeCloseTo(-90, 4);
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Apply pattern", exact: true }).click();
  await native(page, 80000 - 3 * Math.PI * 4 * 20);
  const result = (await state(page)).result;
  result.meshes[0].bounds.min.forEach((value, axis) => expect(value).toBeCloseTo([0, -40, -25][axis], 5));
  result.meshes[0].bounds.max.forEach((value, axis) => expect(value).toBeCloseTo([20, 40, 25][axis], 5));
  // Native cylindrical-wall vertices prove each hole's center and radius,
  // independently of where OpenCascade chooses the circle tessellation seam.
  for (const [cy, cz] of [[12, 0], [12 / Math.sqrt(2), -12 / Math.sqrt(2)], [0, -12]]) {
    const rim: Array<[number, number]> = [];
    const mesh = result.meshes[0];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      const dy = y - cy, dz = z - cz;
      if (Math.abs(x - 20) < 1e-4 && Math.abs(Math.hypot(dy, dz) - 2) < 1e-4 && Math.abs(mesh.normals[i]) < 1e-4 && dy * mesh.normals[i + 1] + dz * mesh.normals[i + 2] < -1.9) rim.push([dy, dz]);
    }
    expect(rim.length, `Native hole rim at Y=${cy}, Z=${cz}`).toBeGreaterThan(16);
    for (const axis of [0, 1]) {
      expect(Math.max(...rim.map(point => point[axis]))).toBeGreaterThan(1.9);
      expect(Math.min(...rim.map(point => point[axis]))).toBeLessThan(-1.9);
    }
  }
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("feature.edit"); });
  const edit = page.getByRole("dialog", { name: "Edit feature pattern" });
  await edit.getByLabel("Pattern count", { exact: true }).fill("4");
  await edit.getByRole("button", { name: "Cancel pattern", exact: true }).click();
  await native(page, 80000 - 3 * Math.PI * 4 * 20);
  expect((await state(page)).document.features.at(-1)).toMatchObject({ pattern: { count: { expression: "3" }, angle: { expression: sweepExpression } } });
});
