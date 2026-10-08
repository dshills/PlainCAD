import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      expect(state.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
      expect(Math.abs(state.result!.meshes[0].geometryAssertions!.volume / volume - 1)).toBeLessThan(1e-7);
    }
  }).toPass({ timeout: 30000 });
}
async function closedOutlineReady(page: Page, sketchId: string, copied: boolean) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result!.profiles![sketchId]).toHaveLength(1);
    expect(state.result!.profiles![sketchId][0].innerLoops).toHaveLength(copied ? 1 : 0);
  }).toPass({ timeout: 30000 });
}
async function fixture(page: Page, circle: boolean, plane: "XY" | "XZ") {
  await page.goto("/"); await ready(page);
  const ids = await page.evaluate(async ({ circle, plane }) => {
    const docPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", storePath = "/src/state/useCadStore.ts";
    const doc = await import(docPath), model = await import(modelPath), { useCadStore } = await import(storePath);
    const sketch = circle ? model.addCircleAt(model.createSketchOnPlane("Offset circle", plane), "0mm", "0mm", "radius") : model.addCornerRectangle(model.createSketchOnPlane("Offset rectangle", plane), "24mm", "16mm");
    const document = doc.upsertSketch({ ...doc.createEmptyDocument("Outline offset acceptance"), parameters: circle ? {
      radius: { id: "radius_parameter", name: "radius", expression: "10mm", value: 10, unit: "mm" },
      wall: { id: "wall_parameter", name: "wall", expression: "2mm", value: 2, unit: "mm" },
    } : {} }, sketch);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return { sketchId: sketch.id, sourceIds: Object.keys(sketch.entities) };
  }, { circle, plane });
  await ready(page); await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  return ids;
}
async function saveOpenExport(page: Page, info: TestInfo, name: string, volume: number, tolerance: number) {
  const final = await aiSnapshot(page);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath(`${name}.pcaddoc`); await (await saving).saveAs(project);
  await page.locator('input[type="file"]').setInputFiles(project);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(final.session); await ready(page, volume);
  expect((await aiSnapshot(page)).document.sketches).toEqual(final.document.sketches);
  const exporting = page.waitForEvent("download");
  await page.getByRole("navigation", { name: "Main CAD commands", exact: true }).getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath(`${name}.stl`); await (await exporting).saveAs(stl);
  expect(Math.abs(stlSignedVolume(await readFile(stl)) / volume - 1)).toBeLessThan(tolerance);
}
for (const direction of ["inward", "outward"] as const) test(`convex ${direction} outline creates a native ${direction === "inward" ? "XY" : "XZ"} wall and rejects a collapsed copy`, async ({ page }, info) => {
  const plane = direction === "inward" ? "XY" : "XZ", ids = await fixture(page, false, plane), before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  const panel = page.getByRole("region", { name: "Offset sketch outline", exact: true });
  await panel.getByLabel("Outline offset direction").selectOption("inward");
  await panel.getByLabel("Outline offset distance").fill("8mm");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(/collapses|self-intersect/);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await panel.getByLabel("Outline offset direction").selectOption(direction);
  await panel.getByLabel("Outline offset distance").fill("2mm");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply outline offset", exact: true })).toBeEnabled();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await panel.getByRole("button", { name: "Cancel outline offset", exact: true }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  await panel.getByLabel("Outline offset direction").selectOption(direction);
  await panel.getByLabel("Outline offset distance").fill("2mm");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply outline offset", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply outline offset", exact: true }).click();
  await closedOutlineReady(page, ids.sketchId, true);
  const offset = await aiSnapshot(page);
  expect(offset.past).toBe(before.past + 1);
  for (const id of ids.sourceIds) expect(offset.document.sketches[ids.sketchId].entities[id]).toEqual(before.document.sketches[ids.sketchId].entities[id]);
  expect(offset.result!.profiles![ids.sketchId]).toHaveLength(1);
  expect(offset.result!.profiles![ids.sketchId][0].innerLoops).toHaveLength(1);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await closedOutlineReady(page, ids.sketchId, false);
  expect((await aiSnapshot(page)).document.sketches).toEqual(before.document.sketches);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await closedOutlineReady(page, ids.sketchId, true);
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm"); await applyExtrusion(page);
  const volume = direction === "inward" ? 720 : 880; await ready(page, volume);
  const bounds = (await aiSnapshot(page)).result!.meshes[0].bounds;
  const expected = plane === "XY" ? { min: [0, 0, 0], max: [24, 16, 5] } : { min: [-2, -5, -2], max: [26, 0, 18] };
  for (const side of ["min", "max"] as const) expected[side].forEach((value, index) => expect(bounds[side][index]).toBeCloseTo(value, 6));
  await saveOpenExport(page, info, `polygon-${direction}`, volume, 1e-6);
});
for (const direction of ["inward", "outward"] as const) test(`circle ${direction} outline keeps a distance parameter through native rebuild, Undo, save/open and STL`, async ({ page }, info) => {
  const ids = await fixture(page, true, "XY"), before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  const panel = page.getByRole("region", { name: "Offset sketch outline", exact: true });
  await panel.getByLabel("Outline offset direction").selectOption(direction);
  await panel.getByLabel("Outline offset distance").fill("wall");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply outline offset", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply outline offset", exact: true }).click();
  await closedOutlineReady(page, ids.sketchId, true);
  const copied = Object.values((await aiSnapshot(page)).document.sketches[ids.sketchId].entities).find((entity) => entity.type === "circle" && !ids.sourceIds.includes(entity.id));
  expect(copied?.type).toBe("circle");
  if (copied?.type !== "circle") throw new Error("Copied circle missing");
  expect(copied.radius.parameterRefs).toMatchObject({ radius: "radius_parameter", wall: "wall_parameter" });
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm"); await applyExtrusion(page);
  const volume = (direction === "inward" ? 180 : 220) * Math.PI; await ready(page, volume);
  const expression = page.getByLabel("Parameter wall expression", { exact: true });
  await expression.fill("3mm"); await expression.press("Enter");
  const changedVolume = (direction === "inward" ? 255 : 345) * Math.PI; await ready(page, changedVolume);
  const edited = await aiSnapshot(page);
  expect(edited.document.sketches[ids.sketchId].entities[copied.id]).toEqual(copied);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page, volume);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(page, changedVolume);
  if (direction === "inward") {
    await expression.fill("11mm"); await expression.press("Enter");
    await expect(async () => {
      const failed = await aiSnapshot(page); expect(failed.result?.success).toBe(false);
      expect(failed.result!.errors.map((error) => error.message).join(" ")).toMatch(/radius|positive|circle|invalid/i);
    }).toPass();
    await expect(page.getByRole("navigation", { name: "Main CAD commands", exact: true }).getByRole("button", { name: "Export STL", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page, changedVolume);
  }
  const final = await aiSnapshot(page), bounds = final.result!.meshes[0].bounds, radius = direction === "inward" ? 10 : 13;
  expect(final.result!.solvedSketches![ids.sketchId].circles.find((circle) => circle.id === copied.id)?.radius).toBeCloseTo(direction === "inward" ? 7 : 13, 8);
  // Display bounds come from tessellation, whose circle samples need not include
  // exact extrema. Analytic radius and BRep volume above remain exact assertions.
  for (const axis of [0, 1]) {
    expect(Math.abs(bounds.min[axis] + radius)).toBeLessThan(0.05);
    expect(Math.abs(bounds.max[axis] - radius)).toBeLessThan(0.05);
  }
  expect(bounds.min[2]).toBeCloseTo(0, 6); expect(bounds.max[2]).toBeCloseTo(5, 6);
  await saveOpenExport(page, info, `circle-${direction}`, changedVolume, 0.01);
});

for (const kind of ["concaveXY", "capsuleXZ", "capsuleYZ"] as const) test(`analytic ${kind} outline copies exact geometry through native extrusion, Undo, save/open and STL`, async ({ page }, info) => {
  await page.goto("/"); await ready(page);
  const ids = await page.evaluate(async (kind) => {
    const docPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", storePath = "/src/state/useCadStore.ts";
    const doc = await import(docPath), model = await import(modelPath), { useCadStore } = await import(storePath);
    let sketch = model.createSketchOnPlane("Analytic offset acceptance", kind === "concaveXY" ? "XY" : kind === "capsuleXZ" ? "XZ" : "YZ");
    const vertices = kind === "concaveXY" ? [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20]] : [[-10, -5], [10, -5], [10, 5], [-10, 5], [10, 0], [-10, 0]];
    const pointIds: string[] = [];
    for (const [x, y] of vertices) { const added = model.addPoint(sketch, `${x}mm`, `${y}mm`); sketch = added.sketch; pointIds.push(added.pointId); }
    if (kind === "concaveXY") for (let i = 0; i < pointIds.length; i++) sketch = model.addLine(sketch, pointIds[i], pointIds[(i + 1) % pointIds.length]).sketch;
    else {
      sketch = model.addLine(sketch, pointIds[0], pointIds[1]).sketch;
      sketch = model.addArc(sketch, pointIds[4], pointIds[1], pointIds[2]).sketch;
      sketch = model.addLine(sketch, pointIds[2], pointIds[3]).sketch;
      sketch = model.addArc(sketch, pointIds[5], pointIds[3], pointIds[0]).sketch;
    }
    const document = doc.upsertSketch(doc.createEmptyDocument("General offset acceptance"), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return { sketchId: sketch.id, sourceIds: Object.keys(sketch.entities) };
  }, kind);
  await ready(page); await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  const before = await aiSnapshot(page), direction = kind === "capsuleYZ" ? "inward" : "outward";
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  const panel = page.getByRole("region", { name: "Offset sketch outline", exact: true });
  await panel.getByLabel("Outline offset direction").selectOption("inward");
  await panel.getByLabel("Outline offset distance").fill(kind === "concaveXY" ? "3mm" : "5mm");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(/collapses|self-intersect/);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await panel.getByLabel("Outline offset direction").selectOption(direction);
  await panel.getByLabel("Outline offset distance").fill("1mm");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply outline offset", exact: true })).toBeEnabled();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await panel.getByRole("button", { name: "Cancel outline offset", exact: true }).click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  await panel.getByLabel("Outline offset direction").selectOption(direction);
  await panel.getByLabel("Outline offset distance").fill("1mm");
  await panel.getByRole("button", { name: "Preview outline offset", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply outline offset", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply outline offset", exact: true }).click();
  await closedOutlineReady(page, ids.sketchId, true);
  const applied = await aiSnapshot(page); expect(applied.past).toBe(before.past + 1);
  for (const id of ids.sourceIds) expect(applied.document.sketches[ids.sketchId].entities[id]).toEqual(before.document.sketches[ids.sketchId].entities[id]);
  if (kind !== "concaveXY") {
    const arcs = applied.result!.solvedSketches![ids.sketchId].arcs.filter((arc) => !ids.sourceIds.includes(arc.id));
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) { expect(arc.radius).toBeCloseTo(direction === "inward" ? 4 : 6, 12); expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI, 12); }
    expect(Object.values(applied.document.sketches[ids.sketchId].entities).filter((entity) => entity.type === "arc")).toHaveLength(4);
  }
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await closedOutlineReady(page, ids.sketchId, false);
  expect((await aiSnapshot(page)).document.sketches).toEqual(before.document.sketches);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await closedOutlineReady(page, ids.sketchId, true);
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm"); await applyExtrusion(page);
  // L areas: 175 → 259 mm². Capsule area: 40r + πr², r: 5 → 6 or 4 mm.
  // Extrude the difference between the two nested boundaries by 5 mm.
  const volume = kind === "concaveXY" ? (259 - 175) * 5 : (40 + (direction === "outward" ? 11 : 9) * Math.PI) * 5;
  await ready(page, volume);
  const bounds = (await aiSnapshot(page)).result!.meshes[0].bounds;
  const expected = kind === "concaveXY" ? { min: [-1, -1, 0], max: [21, 21, 5] } : kind === "capsuleXZ" ? { min: [-16, -5, -6], max: [16, 0, 6] } : { min: [0, -15, -5], max: [5, 15, 5] };
  for (const side of ["min", "max"] as const) expected[side].forEach((value, index) => expect(Math.abs(bounds[side][index] - value)).toBeLessThan(kind === "concaveXY" ? 1e-6 : 0.05));
  await saveOpenExport(page, info, kind, volume, kind === "concaveXY" ? 1e-6 : 0.01);
});
