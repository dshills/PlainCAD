import { openNewPartMenu } from "./newPartWorkflow";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

test.use({ storageState: { cookies: [], origins: [] } });

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      const mesh = state.result!.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30_000 });
}
async function local(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await svg.scrollIntoViewIfNeeded();
  const bounds = await svg.boundingBox();
  const view = (await svg.getAttribute("viewBox"))!.trim().split(/[\s,]+/).map(Number);
  if (!bounds || view.length !== 4 || view.some((value) => !Number.isFinite(value)))
    throw new Error("Sketch canvas unavailable.");
  return {
    x: bounds.x + (x - view[0]) / view[2] * bounds.width,
    y: bounds.y + (-y - view[1]) / view[3] * bounds.height,
  };
}
for (const mode of ["corner", "center"] as const) {
  test(`${mode} Rectangle mode and uncluttered editable dimensions preserve native geometry, history, save/open and STL`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    await openNewPartMenu(page);
    await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
    await page.getByRole("button", { name: "Sketch on Top (XY) plane", exact: true }).click();
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await page.getByRole("button", { name: "Draw rectangle", exact: true }).click();
    await page.getByLabel("Rectangle creation mode", { exact: true }).selectOption(mode);
    const anchor = await local(page, 20, 10);
    await page.mouse.click(anchor.x, anchor.y);
    const canvasBounds = await page.getByRole("group", { name: "Sketch drawing canvas", exact: true }).boundingBox();
    const sizeBounds = await page.getByRole("form", { name: "Draft shape size", exact: true }).boundingBox();
    expect(canvasBounds).not.toBeNull();
    expect(sizeBounds).not.toBeNull();
    expect(sizeBounds!.x >= canvasBounds!.x + canvasBounds!.width || sizeBounds!.y >= canvasBounds!.y + canvasBounds!.height).toBe(true);
    await page.getByLabel("Draft width", { exact: true }).fill("24mm");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Draft height", { exact: true })).toBeFocused();
    await page.keyboard.type("12mm");
    await page.keyboard.press("Enter");
    await ready(page);
    const drawn = await aiSnapshot(page);
    const sketch = Object.values(drawn.document.sketches)[0];
    expect(sketch.dimensions).toHaveLength(2);
    await expect(page.locator(".canvas-driving-dimension")).toHaveCount(2);
    await expect(page.locator(".canvas-reference-dimension")).toHaveCount(0);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
    await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
    await applyExtrusion(page);
    await ready(page, 1440);
    const mesh = (await aiSnapshot(page)).result!.meshes[0];
    const expected = mode === "center"
      ? { min: [8, 4, 0], max: [32, 16, 5] }
      : { min: [20, 10, 0], max: [44, 22, 5] };
    for (const key of ["min", "max"] as const)
      for (let axis = 0; axis < 3; axis++) expect(mesh.bounds[key][axis]).toBeCloseTo(expected[key][axis], 6);
    await page.getByRole("button", { name: sketch.name, exact: true }).dblclick();
    const widthDimension = sketch.dimensions.find((dimension) => sketch.constraints.some((c) => c.type === "horizontal" && c.entityIds.some((id) => dimension.entityIds.includes(id))));
    if (!widthDimension) throw new Error("Rectangle width dimension is unavailable.");
    const dimension = page.locator(`[data-dimension-id="${widthDimension.id}"]`);
    await dimension.press("Enter");
    await page.getByLabel("Sketch size expression", { exact: true }).fill("30mm");
    await page.keyboard.press("Enter");
    await ready(page, 1800);
    const resized = await aiSnapshot(page);
    // Center intent fixes placement; free Corner rectangles constrain size, not translation.
    const resizedBounds = mode === "center"
      ? { min: [5, 4, 0], max: [35, 16, 5] }
      : resized.result!.meshes[0].bounds;
    const resizedMesh = resized.result!.meshes[0];
    for (const [axis, span] of [30, 12, 5].entries())
      expect(resizedMesh.bounds.max[axis] - resizedMesh.bounds.min[axis]).toBeCloseTo(span, 6);
    if (mode === "center")
      for (const key of ["min", "max"] as const)
        for (let axis = 0; axis < 3; axis++)
          expect(resizedMesh.bounds[key][axis]).toBeCloseTo(resizedBounds[key][axis], 6);
    if (mode === "center") {
      expect(resized.document.sketches[sketch.id].constraints.filter((c) => c.type === "midpoint")).toHaveLength(1);
      expect(Object.values(resized.document.sketches[sketch.id].entities).filter((e) => e.type === "line" && e.construction)).toHaveLength(1);
    }
    const line = Object.values(resized.document.sketches[sketch.id].entities).find(
      (entity) => entity.type === "line" && !entity.construction && !sketch.dimensions.some((d) => d.entityIds.includes(entity.id)),
    )!;
    await page.getByRole("button", { name: "Draw tool: select", exact: true }).click();
    await page.getByLabel("Selected sketch item", { exact: true }).selectOption(line.id);
    await expect(page.locator(".canvas-reference-dimension")).toHaveCount(1);
    await page.getByLabel("Selected sketch item", { exact: true }).selectOption("");
    await expect(page.locator(".canvas-reference-dimension")).toHaveCount(0);
    expect((await aiSnapshot(page)).document).toEqual(resized.document);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, 1440);
    expect((await aiSnapshot(page)).document.sketches[sketch.id]).toEqual(sketch);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, 1800);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const project = info.outputPath(`${mode}-rectangle.pcaddoc`);
    await (await saving).saveAs(project);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(resized.session);
    await ready(page, 1800);
    const reopened = await aiSnapshot(page);
    expect(reopened.document.sketches[sketch.id]).toEqual(resized.document.sketches[sketch.id]);
    for (const key of ["min", "max"] as const)
      for (let axis = 0; axis < 3; axis++)
        expect(reopened.result!.meshes[0].bounds[key][axis]).toBeCloseTo(resizedBounds[key][axis], 6);
    const exporting = page.waitForEvent("download");
    await page.locator(".file-menu > summary").click();
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${mode}-rectangle.stl`);
    await (await exporting).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1800, 3);
    expect(errors).toEqual([]);
  });
}

for (const plane of ["XY", "XZ"] as const) {
  test(`${plane} associative center rectangle parameters preserve native orientation, history, save/open and STL`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    const sketchId = await page.evaluate(async (plane) => {
      const documentPath = "/src/cad/document/CadDocument.ts", sketchPath = "/src/cad/sketch/SketchModel.ts",
        solverPath = "/src/cad/sketch/SketchSolver.ts", sizedPath = "/src/cad/sketch/sizedCanvasGeometry.ts",
        profilePath = "/src/cad/sketch/profileDetection.ts", evaluationPath = "/src/cad/parameters/expressionEvaluator.ts",
        storePath = "/src/state/useCadStore.ts";
      const docs = await import(documentPath), sketches = await import(sketchPath), { solveSketch } = await import(solverPath),
        { addSizedCanvasGeometry } = await import(sizedPath), { detectProfiles } = await import(profilePath),
        { useCadStore } = await import(storePath);
      let document = docs.createEmptyDocument("Associative rectangle");
      for (const [name, expression] of [["width", "30mm"], ["height", "10mm"], ["centerX", "10mm"], ["centerY", "5mm"]])
        document = docs.upsertParameter(document, { id: `parameter_${name}`, name, expression, unit: "mm", value: Number.parseFloat(expression) });
      const evaluationModule = await import(evaluationPath);
      const parameters = evaluationModule.evaluateParameters(document.parameters).values;
      const center = sketches.addPoint(sketches.createSketchOnPlane("Centered sketch", plane), "centerX", "centerY");
      const sketch = addSizedCanvasGeometry(center.sketch, solveSketch(center.sketch, parameters), "rectangle",
        [{ x: 10, y: 5, pointId: center.pointId }, { x: 15, y: 8 }], false, false,
        { rectangleMode: "center", width: "width", height: "height" }, parameters, "mm").sketch;
      const profileId = detectProfiles(solveSketch(sketch, parameters)).profiles[0].id;
      document = docs.upsertSketch(document, sketch);
      document = docs.upsertFeature(document, docs.createExtrudeFeature({
        name: "Centered solid", sketchId: sketch.id, profileId, operation: "newBody", direction: "positive", distance: { expression: "5mm", unit: "mm" },
      }));
      useCadStore.getState().setDocument(document);
      return sketch.id;
    }, plane);
    await ready(page, 1500);
    const before = await aiSnapshot(page);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      const store = (await import(path)).useCadStore.getState();
      store.updateParameter("width", { expression: "40mm" });
      store.updateParameter("height", { expression: "20mm" });
    });
    await ready(page, 4000);
    const assertBounds = async (centerX: number, centerY: number) => {
      const mesh = (await aiSnapshot(page)).result!.meshes[0];
      const expected = plane === "XY"
        ? { min: [centerX - 20, centerY - 10, 0], max: [centerX + 20, centerY + 10, 5] }
        : { min: [centerX - 20, -5, centerY - 10], max: [centerX + 20, 0, centerY + 10] };
      for (const key of ["min", "max"] as const)
        for (let axis = 0; axis < 3; axis++) expect(mesh.bounds[key][axis]).toBeCloseTo(expected[key][axis], 6);
    };
    await assertBounds(10, 5);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      (await import(path)).useCadStore.getState().updateParameter("centerX", { expression: "20mm" });
    });
    await ready(page, 4000);
    await assertBounds(20, 5);
    const edited = await aiSnapshot(page);
    expect(edited.past).toBe(before.past + 3);
    expect(edited.document.sketches[sketchId]).toEqual(before.document.sketches[sketchId]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, 4000);
    await assertBounds(10, 5);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, 4000);
    await assertBounds(20, 5);
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const project = info.outputPath(`${plane}-associative-center.pcaddoc`);
    await (await saving).saveAs(project);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(edited.session);
    await ready(page, 4000);
    await assertBounds(20, 5);
    expect((await aiSnapshot(page)).document.sketches[sketchId]).toEqual(edited.document.sketches[sketchId]);
    const exporting = page.waitForEvent("download");
    await page.locator(".file-menu > summary").click();
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${plane}-associative-center.stl`);
    await (await exporting).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(4000, 3);
    expect(errors).toEqual([]);
  });
}
