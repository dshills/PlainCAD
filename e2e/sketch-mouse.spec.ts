import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const s = await aiSnapshot(page);
    expect(s.status).toBe("succeeded");
    expect(s.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(s.result!.meshes).toHaveLength(1);
      expect(s.result!.meshes[0].geometrySource).toBe("opencascade");
      expect(s.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(s.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function client(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) throw new Error("Sketch canvas unavailable");
  const view = (await svg.getAttribute("viewBox"))?.trim().split(/[\s,]+/).map(Number);
  if (!view || view.length !== 4 || view.some((value) => !Number.isFinite(value)) || view[2] <= 0 || view[3] <= 0)
    throw new Error("Sketch canvas viewBox is unavailable or invalid.");
  return { x: box.x + (x - view[0]) / view[2] * box.width, y: box.y + (-y - view[1]) / view[3] * box.height };
}
async function fixture(page: Page, plane: "XY" | "XZ") {
  await page.goto("/");
  await ready(page);
  const id = await page.evaluate(async (plane) => {
    const docsPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", solvePath = "/src/cad/sketch/SketchSolver.ts", geometryPath = "/src/cad/sketch/canvasGeometry.ts", storePath = "/src/state/useCadStore.ts";
    const docs = await import(docsPath), model = await import(modelPath), { solveSketch } = await import(solvePath), { addCanvasGeometry } = await import(geometryPath), { useCadStore } = await import(storePath);
    let sketch = model.createSketchOnPlane("Mouse part", plane);
    for (const points of [
      [{ x: -8, y: 0 }, { x: 26, y: 0 }],
      [{ x: 0, y: -8 }, { x: 0, y: 22 }],
      [{ x: -8, y: 10 }, { x: 26, y: 10 }],
      [{ x: 20, y: -8 }, { x: 20, y: 22 }],
    ]) sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "line", points, true).sketch;
    sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "circle", [{ x: -20, y: 20 }, { x: -15, y: 20 }], true).sketch;
    const document = docs.upsertSketch(docs.createEmptyDocument("Direct mouse model"), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return sketch.id;
  }, plane);
  await ready(page);
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  return id;
}
for (const plane of ["XY", "XZ"] as const) test(`mouse pan, finite intersection/tangent snaps and bounded translation preserve native ${plane} geometry`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sketchId = await fixture(page, plane);
  const svg = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  const before = await aiSnapshot(page), view = await svg.getAttribute("viewBox");
  await svg.focus();
  const center = await client(page, 5, 5);
  await page.keyboard.down("Space");
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 30, { steps: 4 });
  await expect(svg).not.toHaveAttribute("viewBox", view!);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(svg).toHaveAttribute("viewBox", view!);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(center.x + 30, center.y - 20, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await expect(svg).not.toHaveAttribute("viewBox", view!);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.getByRole("button", { name: "Fit sketch", exact: true }).click();
  // The drawing anchor and curve are construction geometry; tangent is analytic,
  // with no automatically authored constraint.
  await page.getByRole("button", { name: "Draw tool: line", exact: true }).click();
  await page.getByLabel("Construction", { exact: true }).check();
  const anchor = await client(page, -10, 20);
  await page.mouse.click(anchor.x, anchor.y);
  const tangent = await client(page, -17.5, 20 + Math.sqrt(18.75));
  await page.mouse.move(tangent.x + 2, tangent.y + 1);
  await expect(page.getByRole("img", { name: "Tangent snap", exact: true })).toBeVisible();
  await page.mouse.click(tangent.x + 2, tangent.y + 1);
  await ready(page);
  const tangentSketch = (await aiSnapshot(page)).document.sketches[sketchId];
  const newPoints = Object.values(tangentSketch.entities).filter((e) => e.type === "point" && !before.document.sketches[sketchId].entities[e.id]);
  expect(newPoints).toHaveLength(2);
  const end = newPoints.find((e) => e.type === "point" && Math.abs(Number.parseFloat(e.x.expression) + 17.5) < 1e-6);
  expect(end).toBeDefined();
  if (!end || end.type !== "point") throw new Error("Analytic tangent endpoint was not authored.");
  expect(Number.parseFloat(end.y.expression)).toBeCloseTo(20 + Math.sqrt(18.75), 8);
  await page.keyboard.press("Escape");
  await page.getByLabel("Construction", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Draw tool: rectangle", exact: true }).click();
  const a = await client(page, 0, 0), b = await client(page, 20, 10);
  await page.mouse.move(a.x + 2, a.y + 2);
  await expect(page.getByRole("img", { name: "Intersection snap", exact: true })).toBeVisible();
  await page.keyboard.down("Alt");
  await page.mouse.move(a.x + 3, a.y + 3);
  await expect(page.locator("[data-snap-kind]")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Sketch navigation status" })).toContainText("Snapping paused");
  await page.keyboard.up("Alt");
  await page.mouse.click(a.x + 2, a.y + 2);
  await page.mouse.click(b.x + 2, b.y + 2);
  await ready(page);
  const drawn = await aiSnapshot(page);
  expect(drawn.document.sketches[sketchId].constraints).toEqual(before.document.sketches[sketchId].constraints);
  expect(drawn.past).toBe(before.past + 2);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await ready(page, 1000);
  await page.locator(".sketch-chip").first().click();
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  await page.getByRole("button", { name: "Draw tool: translate", exact: true }).click();
  const movingBefore = await aiSnapshot(page), original = movingBefore.document.sketches[sketchId];
  const start = await client(page, 0, 0), target = await client(page, 5, -3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await expect(page.getByLabel("Group translation preview", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture")));
  await page.mouse.up();
  expect((await aiSnapshot(page)).document).toEqual(movingBefore.document);
  expect((await aiSnapshot(page)).past).toBe(movingBefore.past);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
  await ready(page, 1000);
  const moved = await aiSnapshot(page);
  expect(moved.past).toBe(movingBefore.past + 1);
  expect(Object.keys(moved.document.sketches[sketchId].entities)).toEqual(Object.keys(original.entities));
  expect(moved.document.sketches[sketchId].constraints).toEqual(original.constraints);
  expect(moved.document.sketches[sketchId].dimensions).toEqual(original.dimensions);
  const mesh = moved.result!.meshes[0];
  const expected = plane === "XY" ? { min: [5, -3, 0], max: [25, 7, 5] } : { min: [5, -5, -3], max: [25, 0, 7] };
  for (const key of ["min", "max"] as const) for (let axis = 0; axis < 3; axis++) expect(mesh.bounds[key][axis]).toBeCloseTo(expected[key][axis], 6);
  await page.getByRole("button", { name: "Undo canvas edit", exact: true }).click();
  await ready(page, 1000);
  expect((await aiSnapshot(page)).document.sketches[sketchId]).toEqual(original);
  await page.getByRole("button", { name: "Redo canvas edit", exact: true }).click();
  await ready(page, 1000);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath(`${plane}-mouse.pcaddoc`);
  await (await saving).saveAs(project);
  await page.locator('input[type="file"]').setInputFiles(project);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(moved.session);
  await ready(page, 1000);
  expect((await aiSnapshot(page)).document.sketches[sketchId]).toEqual(moved.document.sketches[sketchId]);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath(`${plane}-mouse.stl`);
  await (await exporting).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1000, 3);
  expect(errors).toEqual([]);
});
