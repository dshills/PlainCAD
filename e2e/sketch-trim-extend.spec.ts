import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      expect(state.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
      expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function editedLineReady(page: Page, sketchId: string, lineId: string, coordinates: [number, number, number, number]) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result?.success).toBe(true);
    const line = state.result!.solvedSketches?.[sketchId]?.lines.find((candidate) => candidate.id === lineId);
    expect(line).toBeDefined();
    [line!.start.x, line!.start.y, line!.end.x, line!.end.y].forEach((value, index) => expect(value).toBeCloseTo(coordinates[index], 6));
  }).toPass({ timeout: 30000 });
}
async function fixture(page: Page, plane: "XY" | "XZ") {
  await page.goto("/"); await ready(page);
  const ids = await page.evaluate(async (plane) => {
    const docPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", storePath = "/src/state/useCadStore.ts";
    const doc = await import(docPath), model = await import(modelPath), { useCadStore } = await import(storePath);
    let sketch = model.createSketchOnPlane("Trim extend part", plane);
    const ids: string[] = [];
    for (const [x1, y1, x2, y2] of [[-10, 20, 30, 20], [30, 0, 30, 10], [0, 0, 30, 0], [0, 0, 0, 20]]) {
      const a = model.addPoint(sketch, `${x1}mm`, `${y1}mm`), b = model.addPoint(a.sketch, `${x2}mm`, `${y2}mm`), line = model.addLine(b.sketch, a.pointId, b.pointId);
      sketch = line.sketch; ids.push(line.lineId);
    }
    const document = doc.upsertSketch(doc.createEmptyDocument("Trim and extend acceptance"), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return { sketchId: sketch.id, top: ids[0], right: ids[1] };
  }, plane);
  await ready(page);
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  return ids;
}
async function pick(page: Page, x: number, y: number) {
  const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const client = await canvas.evaluate((element, point) => {
    if (!(element instanceof SVGSVGElement)) throw new Error("Sketch SVG unavailable");
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error("Sketch coordinate projection unavailable");
    const local = element.createSVGPoint(); local.x = point.x; local.y = -point.y;
    const screen = local.matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  await page.mouse.click(client.x, client.y);
}
for (const plane of ["XY", "XZ"] as const) test(`line trim and extend close a non-template ${plane} sketch with native solid, save/open and STL`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const ids = await fixture(page, plane), before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Trim sketch lines", exact: true }).click();
  const trim = page.getByRole("region", { name: "Trim sketch lines", exact: true });
  await trim.getByLabel("Line to edit").selectOption(ids.top);
  await pick(page, -5, 20);
  await trim.getByRole("button", { name: "Preview trim", exact: true }).click();
  await expect(trim.getByRole("button", { name: "Apply trim", exact: true })).toBeEnabled();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await trim.getByRole("button", { name: "Cancel trim", exact: true }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.getByRole("button", { name: "Trim sketch lines", exact: true }).click();
  await trim.getByLabel("Line to edit").selectOption(ids.top);
  await pick(page, -5, 20);
  await trim.getByRole("button", { name: "Preview trim", exact: true }).click();
  await expect(trim.getByRole("button", { name: "Apply trim", exact: true })).toBeEnabled();
  await trim.getByRole("button", { name: "Apply trim", exact: true }).click();
  await editedLineReady(page, ids.sketchId, ids.top, [0, 20, 30, 20]);
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Extend sketch lines", exact: true }).click();
  const extend = page.getByRole("region", { name: "Extend sketch lines", exact: true });
  await extend.getByLabel("Line to edit").selectOption(ids.right);
  await pick(page, 30, 9);
  await extend.getByRole("button", { name: "Preview extend", exact: true }).click();
  await expect(extend.getByRole("button", { name: "Apply extend", exact: true })).toBeEnabled();
  await extend.getByRole("button", { name: "Apply extend", exact: true }).click();
  await editedLineReady(page, ids.sketchId, ids.right, [30, 0, 30, 20]);
  const closed = await aiSnapshot(page);
  expect(closed.past).toBe(before.past + 2);
  expect(closed.result!.profiles![ids.sketchId]).toHaveLength(1);
  expect(closed.result!.profiles![ids.sketchId][0].bounds).toMatchObject({ minX: 0, maxX: 30, minY: 0, maxY: 20 });
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("6mm");
  await applyExtrusion(page); await ready(page, 3600);
  const final = await aiSnapshot(page), bounds = final.result!.meshes[0].bounds;
  const expected = plane === "XY" ? { min: [0, 0, 0], max: [30, 20, 6] } : { min: [0, -6, 0], max: [30, 0, 20] };
  for (const side of ["min", "max"] as const) expected[side].forEach((value, i) => expect(bounds[side][i]).toBeCloseTo(value, 6));
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath(`${plane}-trim-extend.pcaddoc`); await (await saving).saveAs(project);
  await page.locator('input[type="file"]').setInputFiles(project);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(final.session); await ready(page, 3600);
  expect((await aiSnapshot(page)).document.sketches[ids.sketchId]).toEqual(final.document.sketches[ids.sketchId]);
  const exporting = page.waitForEvent("download"); await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath(`${plane}-trim-extend.stl`); await (await exporting).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(3600, 3);
  expect(errors).toEqual([]);
});
