import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument, OriginPlane } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(page: Page): Promise<{ document: CadDocument; status: string; result: RebuildResult; past: number }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", state = (await import(path)).useCadStore.getState();
    return { document: state.history.present, status: state.rebuild.status, result: state.rebuild.result, past: state.history.past.length };
  });
}
async function nativeVolume(page: Page, expected: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result.success).toBe(true);
    expect(state.result.errors).toEqual([]);
    expect(state.result.metrics?.disposalFailures).toBe(0);
    expect(state.result.meshes).toHaveLength(1);
    const mesh = state.result.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    // OCC's exact BRep integration has finite floating precision; compare at
    // 1e-8 relative tolerance (far below the volume of any omitted instance).
    expect(Math.abs(mesh.geometryAssertions!.volume - expected) / expected).toBeLessThan(1e-8);
  }).toPass({ timeout: 25000 });
}
async function fixture(page: Page, mode: "hole" | "pocket" = "hole", plane: OriginPlane = "XY") {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  return page.evaluate(async ({ mode, plane }) => {
    const storePath = "/src/state/useCadStore.ts", docPath = "/src/cad/document/CadDocument.ts", sketchPath = "/src/cad/sketch/SketchModel.ts", solverPath = "/src/cad/sketch/SketchSolver.ts", profilesPath = "/src/cad/sketch/profileDetection.ts", bindingsPath = "/src/cad/parameters/expressionBindings.ts";
    const { useCadStore } = await import(storePath), ops = await import(docPath), sketches = await import(sketchPath), { solveSketch } = await import(solverPath), { detectProfiles } = await import(profilesPath), { bindDocumentExpressions } = await import(bindingsPath);
    let document = ops.createEmptyDocument("Pattern test part");
    for (const [name, expression, unit] of [["drill", "4mm", "mm"], ["copies", "3", ""]]) document = ops.upsertParameter(document, { id: `${name}-param`, name, expression, unit, authoredUnit: unit, value: 0 });
    const baseSketch = sketches.addCenterRectangle(sketches.createSketchOnPlane("Base", plane), "80mm", "50mm"),
      base = ops.createExtrudeFeature({ name: "Base solid", sketchId: baseSketch.id, profileId: detectProfiles(solveSketch(baseSketch, {})).profiles[0].id, operation: "newBody", distance: { expression: "20mm", unit: "mm" }, direction: "positive" });
    document = ops.upsertFeature(ops.upsertSketch(document, baseSketch), base);
    let seed;
    if (mode === "hole") {
      const center = sketches.addPoint(sketches.createSketchOnPlane("Seed center", plane), "-20mm", "0mm");
      document = ops.upsertSketch(document, center.sketch);
      seed = { id: "pattern-seed", type: "hole", name: "Seed hole", sketchId: center.sketch.id, centerPointIds: [center.pointId], targetBodyIds: [`body:${base.id}`], diameter: { expression: "drill", unit: "mm" }, depth: "throughAll" };
    } else {
      const profile = sketches.addCenterRectangle(sketches.createSketchOnPlane("Pocket profile", plane), "4mm", "4mm");
      profile.entities = Object.fromEntries(Object.entries(profile.entities).map(([id, entity]: [string, any]) => [id, entity.type === "point" ? { ...entity, x: { ...entity.x, expression: `(${entity.x.expression}) + 12mm` } } : entity]));
      document = ops.upsertSketch(document, profile);
      seed = { id: "pattern-seed", type: "extrude", name: "Seed pocket", sketchId: profile.id, profileId: detectProfiles(solveSketch(profile, {})).profiles[0].id, operation: "cut", targetBodyIds: [`body:${base.id}`], distance: { expression: "5mm", unit: "mm" }, direction: "positive" };
    }
    document = bindDocumentExpressions(ops.upsertFeature(document, seed));
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "feature", id: seed.id, documentId: document.id });
    return { id: document.id, baseId: base.id, seedId: seed.id };
  }, { mode, plane });
}
async function openPattern(page: Page) {
  await page.getByRole("button", { name: "Repeat selected hole or pocket", exact: true }).click();
  return page.getByRole("dialog", { name: "Create feature pattern" });
}
test("linked linear holes survive parameter edits, undo, save/open and STL export", async ({ page }, info) => {
  const ids = await fixture(page);
  await nativeVolume(page, 80000 - Math.PI * 4 * 20);
  const dialog = await openPattern(page);
  await dialog.getByLabel("Pattern count", { exact: true }).fill("copies");
  await dialog.getByLabel("Pattern spacing", { exact: true }).fill("20mm");
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Apply pattern", exact: true }).click();
  await nativeVolume(page, 80000 - 3 * Math.PI * 4 * 20);
  const authored = await snapshot(page), patternId = authored.document.features.at(-1)!.id;
  expect(authored.document.features.at(-1)).toMatchObject({ type: "pattern", sourceFeatureId: ids.seedId, pattern: { count: { parameterRefs: { copies: "copies-param" } } } });
  expect(authored.past).toBe(1);
  const drill = page.getByLabel("Parameter drill expression", { exact: true });
  await drill.fill("6mm"); await drill.press("Enter");
  await nativeVolume(page, 80000 - 3 * Math.PI * 9 * 20);
  const copies = page.getByLabel("Parameter copies expression", { exact: true });
  await copies.fill("2"); await copies.press("Enter");
  await nativeVolume(page, 80000 - 2 * Math.PI * 9 * 20);
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("history.undo"); });
  await nativeVolume(page, 80000 - 3 * Math.PI * 9 * 20);
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("history.redo"); });
  await nativeVolume(page, 80000 - 2 * Math.PI * 9 * 20);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = info.outputPath("pattern.pcaddoc"); await (await saving).saveAs(saved);
  const text = await readFile(saved, "utf8");
  expect(JSON.parse(text).features.at(-1).id).toBe(patternId);
  expect(text).not.toMatch(/kernelHandle|geometrySource|positions/);
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await nativeVolume(page, 80000);
  await page.locator('input[type="file"]').setInputFiles(saved);
  await nativeVolume(page, 80000 - 2 * Math.PI * 9 * 20);
  const exporting = page.waitForEvent("download");
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("file.exportStl"); });
  const stl = await exporting, stlPath = info.outputPath("pattern.stl"); await stl.saveAs(stlPath);
  const bytes = await readFile(stlPath);
  expect(bytes.length).toBeGreaterThan(84);
  expect(bytes.readUInt32LE(80)).toBe((await snapshot(page)).result.meshes[0].indices.length / 3);
});
test("circular pocket patterns use the source YZ coordinate frame and editable sweep", async ({ page }) => {
  await fixture(page, "pocket", "YZ");
  await nativeVolume(page, 80000 - 80);
  const dialog = await openPattern(page);
  await dialog.getByLabel("Pattern type", { exact: true }).selectOption("circular");
  await dialog.getByLabel("Pattern count", { exact: true }).fill("4");
  await expect(dialog.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Apply pattern", exact: true }).click();
  await nativeVolume(page, 80000 - 320);
  const state = await snapshot(page), mesh = state.result.meshes[0];
  mesh.bounds.min.forEach((value, axis) => expect(value).toBeCloseTo([0, -40, -25][axis], 5));
  mesh.bounds.max.forEach((value, axis) => expect(value).toBeCloseTo([20, 40, 25][axis], 5));
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("feature.edit"); });
  const edit = page.getByRole("dialog", { name: "Edit feature pattern" });
  await edit.getByLabel("Pattern count", { exact: true }).fill("3");
  await edit.getByLabel("Pattern sweep angle", { exact: true }).fill("180deg");
  await expect(edit.getByRole("status", { name: "Pattern preview status" })).toContainText("Native preview ready");
  await edit.getByRole("button", { name: "Apply pattern", exact: true }).click();
  await nativeVolume(page, 80000 - 240);
  expect((await snapshot(page)).document.features.at(-1)!.id).toBe(state.document.features.at(-1)!.id);
});
test("overlapping and off-body copies diagnose failure and leave the document unchanged", async ({ page }) => {
  await fixture(page);
  await nativeVolume(page, 80000 - Math.PI * 4 * 20);
  const before = await snapshot(page), dialog = await openPattern(page);
  await dialog.getByLabel("Pattern spacing", { exact: true }).fill("1mm");
  await expect(dialog.getByRole("alert")).toContainText("overlaps instance");
  await expect(dialog.getByRole("button", { name: "Apply pattern", exact: true })).toBeDisabled();
  await dialog.getByLabel("Pattern spacing", { exact: true }).fill("100mm");
  await expect(dialog.getByRole("alert")).toContainText("does not remove new material");
  await expect(dialog.getByRole("button", { name: "Apply pattern", exact: true })).toBeDisabled();
  expect((await snapshot(page)).document).toEqual(before.document);
  expect((await snapshot(page)).past).toBe(before.past);
  await dialog.getByRole("button", { name: "Cancel pattern", exact: true }).click();
  await nativeVolume(page, 80000 - Math.PI * 4 * 20);
});
