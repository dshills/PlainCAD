import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addComponent } from "../src/cad/document/components";
import { addArc, addCircleAt, addLine, addPoint, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import type { Sketch } from "../src/cad/document/schema";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
function fixture(arc: boolean) {
  const child = addComponent(createEmptyDocument("Linked source navigation"), "Cover");
  let source: Sketch = createSketchOnPlane("Source outline", "XY");
  if (arc) {
    const center = addPoint(source, "5mm", "7mm"), start = addPoint(center.sketch, "5mm + radius", "7mm"), end = addPoint(start.sketch, "5mm - radius", "7mm");
    const curved = addArc(end.sketch, center.pointId, start.pointId, end.pointId, false);
    source = addLine(curved.sketch, end.pointId, start.pointId).sketch;
  } else source = addCircleAt(source, "5mm", "7mm", "radius");
  const profile = detectProfiles(solveSketch(source, { radius: { value: 3, unit: "mm", dimension: "length" } })).profiles[0];
  const feature = createExtrudeFeature({ name: "Reference cylinder", sketchId: source.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
  const target = { ...createSketchOnPlane("Linked cover", { type: "offset" as const, base: "XY", offset: { expression: "12mm", unit: "mm" } }), componentId: child.component.id };
  const document = upsertSketch(upsertFeature(upsertSketch(upsertParameter(child.document, { id: "linked-radius", name: "radius", expression: "3mm", value: 3, unit: "mm" }), source), feature), target);
  return { document, source, target, feature, arc };
}
async function native(page: Page, radius: number, arc: boolean) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result!.errors).toEqual([]); expect(state.result!.meshes).toHaveLength(1);
    expect(state.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(Math.PI * radius * radius * 8 / (arc ? 2 : 1), 6);
  }).toPass();
}
async function edit(page: Page, id: string) {
  await page.evaluate(async (sketchId) => {
    const storePath = "/src/state/useCadStore.ts", componentPath = "/src/cad/document/components.ts";
    const store = (await import(storePath)).useCadStore.getState();
    store.activateComponent((await import(componentPath)).sketchComponentId(store.history.present, sketchId));
    store.select({ kind: "sketch", id: sketchId, documentId: store.history.present.id });
  }, id);
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
}
async function project(page: Page) {
  await page.getByRole("button", { name: "Project part edges into sketch", exact: true }).click();
  const panel = page.getByRole("region", { name: "Project part edges", exact: true });
  await expect(panel.getByLabel("Source part boundary").locator("option")).toHaveCount(3);
  const end = await panel.getByLabel("Source part boundary").locator("option").evaluateAll(options => options.find(option => option.textContent?.includes("End cap"))?.getAttribute("value"));
  expect(end).toBeTruthy(); await panel.getByLabel("Source part boundary").selectOption(end!);
  await panel.getByRole("button", { name: "Preview projected boundary" }).click();
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply projected boundary" }).click();
}
for (const arc of [false, true]) test(`linked ${arc ? "arc" : "circle"} explains ownership, opens source, repairs and becomes independent with native save/open/STL`, async ({ page }, info) => {
  const model = fixture(arc);
  await test.step("Create an exact linked native boundary", async () => {
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({ name: "source.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
    await native(page, 3, arc); await edit(page, model.target.id); await project(page); await native(page, 3, arc);
  });
  let state = await aiSnapshot(page), link = state.document.sketches[model.target.id].projections![0];
  const curve = link.members.find(member => state.document.sketches[model.target.id].entities[member.targetEntityId].type === (arc ? "arc" : "circle"))!;
  await test.step("Explain the link and open its actual source", async () => {
    await page.getByRole("button", { name: "Draw tool: select", exact: true }).click();
    await page.getByLabel("Selected sketch item", { exact: true }).selectOption(curve.targetEntityId);
    await expect(page.getByLabel("Linked geometry explanation")).toContainText("Source outline");
    await expect(page.locator(`[data-entity-id="${curve.targetEntityId}"]`)).toHaveClass(/canvas-linked/);
    const before = await aiSnapshot(page);
    await page.getByRole("button", { name: "Show source", exact: true }).click();
    await expect(page.getByLabel("Selected sketch item", { exact: true })).toHaveValue(curve.targetEntityId);
    expect((await aiSnapshot(page)).past).toBe(before.past);
    await page.getByRole("button", { name: "Edit source", exact: true }).click();
    await expect.poll(async () => page.evaluate(async () => { const path = "/src/ui/commands/sketchCanvasCommand.ts"; return (await import(path)).useSketchCanvas.getState().active?.sketchId; })).toBe(model.source.id);
    expect((await aiSnapshot(page)).past).toBe(before.past);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  });
  const radius = page.getByRole("textbox", { name: "Parameter radius expression", exact: true });
  await test.step("Edit the source and assert linked coordinates", async () => {
    await radius.fill("4mm"); await radius.press("Enter"); await native(page, 4, arc);
    state = await aiSnapshot(page); const solved = state.result!.solvedSketches![model.target.id];
    const linkedCurve = arc ? solved.arcs[0] : solved.circles[0];
    expect(linkedCurve.center).toMatchObject({ x: 5, y: 7 }); expect(linkedCurve.radius).toBe(4);
    if (arc) expect(solved.arcs[0].sweep).toBeCloseTo(Math.PI, 8);
    expect(state.result!.sketchPlanes![model.target.id].origin.z).toBe(12);
  });
  await test.step("Cancel repair and undo one independence edit", async () => {
    await edit(page, model.target.id);
    const beforeRepair = await aiSnapshot(page);
    await page.getByRole("button", { name: "Repair link", exact: true }).click();
    const repair = page.getByRole("region", { name: "Project part edges", exact: true });
    await expect(repair.getByLabel("Source part boundary")).not.toHaveValue("");
    await repair.getByRole("button", { name: "Preview projected boundary" }).click();
    await expect(repair.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
    await repair.getByRole("button", { name: "Cancel projection" }).click();
    expect((await aiSnapshot(page)).document).toEqual(beforeRepair.document); expect((await aiSnapshot(page)).past).toBe(beforeRepair.past);
    await page.getByRole("button", { name: "Make independent", exact: true }).click(); await native(page, 4, arc);
    expect((await aiSnapshot(page)).past).toBe(beforeRepair.past + 1);
    expect((await aiSnapshot(page)).document.sketches[model.target.id].projections ?? []).toEqual([]);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await native(page, 4, arc);
    expect((await aiSnapshot(page)).document.sketches[model.target.id].projections![0].members).toEqual(link.members);
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await native(page, 4, arc);
  });
  await test.step("Save, reopen, prove independence and export the native source", async () => {
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
    const savedPath = info.outputPath("independent.pcaddoc"); await (await download).saveAs(savedPath);
    const saved = JSON.parse(await readFile(savedPath, "utf8")); expect(saved.sketches[model.target.id].projections ?? []).toEqual([]);
    const savedSession = (await aiSnapshot(page)).session; await page.locator('input[type="file"]').setInputFiles(savedPath);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(savedSession); await native(page, 4, arc);
    await radius.fill("5mm"); await radius.press("Enter"); await native(page, 5, arc);
    const independent = (await aiSnapshot(page)).result!.solvedSketches![model.target.id]; expect((arc ? independent.arcs[0] : independent.circles[0]).radius).toBe(4);
    const exporting = page.waitForEvent("download"); await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stlPath = info.outputPath("native-source.stl"); await (await exporting).saveAs(stlPath);
    // STL facets approximate the exact BRep volume; allow the current tessellation budget.
    expect(Math.abs(stlSignedVolume(await readFile(stlPath)) - Math.PI * 25 * 8 / (arc ? 2 : 1))).toBeLessThan(Math.PI * 25 * 8 * 0.025);
  });
});

test("Edit source preserves incomplete mouse drawing until the user finishes or cancels it", async ({ page }) => {
  const model = fixture(false);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "protected-drawing.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
  await native(page, 3, false);
  await edit(page, model.target.id);
  await project(page);
  await native(page, 3, false);
  const before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Draw tool: circle", exact: true }).click();
  const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await canvas.click({ position: { x: box!.width * 0.75, y: box!.height * 0.75 } });
  await expect(page.getByRole("button", { name: "Cancel drawing", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await expect(page.getByRole("region", { name: "Linked projected boundaries" }).getByRole("alert")).toContainText("Finish or cancel the current drawing gesture");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await expect(page.getByRole("button", { name: "Cancel drawing", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel drawing", exact: true }).click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/ui/commands/sketchCanvasCommand.ts";
    return (await import(path)).useSketchCanvas.getState().active?.sketchId;
  })).toBe(model.source.id);
  expect((await aiSnapshot(page)).past).toBe(before.past);
});
