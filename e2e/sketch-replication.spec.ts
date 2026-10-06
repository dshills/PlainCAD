import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../src/cad/document/CadDocument";
import { addCornerRectangle, addCircleAt, addPoint, addLine, createXySketch } from "../src/cad/sketch/SketchModel";
import { withCanvasDimension } from "../src/cad/sketch/canvasDimensions";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { evaluateParameters } from "../src/cad/parameters/expressionEvaluator";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";

function replicationFixture() {
  let sketch = addCircleAt(addCornerRectangle(createXySketch("Plate holes"), "24mm", "16mm"), "4mm", "5mm", "1mm");
  const circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  sketch = withCanvasDimension(sketch, { type: "radius", refs: [circle.id], expression: "drillRadius" });
  const start = addPoint(sketch, "12mm", "0mm"), end = addPoint(start.sketch, "12mm", "16mm"), axis = addLine(end.sketch, start.pointId, end.pointId);
  sketch = { ...axis.sketch, solveMode: "driving", entities: { ...axis.sketch.entities, [axis.lineId]: { ...axis.sketch.entities[axis.lineId], construction: true } } };
  let document = upsertSketch({ ...createEmptyDocument("Copied plate holes"), parameters: { drillRadius: { id: "radius_parameter", name: "drillRadius", expression: "1mm", unit: "mm", value: 1 } } }, sketch);
  const profile = detectProfiles(solveSketch(sketch, evaluateParameters(document.parameters).values)).profiles.find((candidate) => candidate.outerLoop.type === "polygon" && candidate.innerLoops.length === 1);
  if (!profile) throw new Error("Replication fixture must have a plate region with one circular hole.");
  document = upsertFeature(document, createExtrudeFeature({ name: "Perforated plate", sketchId: sketch.id, profileId: profile.id, operation: "newBody", distance: { expression: "8mm", unit: "mm" }, direction: "positive" }));
  return { document, sketch, circleId: circle.id, axisId: axis.lineId };
}

for (const mode of ["mirror", "linear"] as const) {
  test(`${mode} sketch copies preserve dimensions, native holes, one Undo, shared parameter edit, save/open and STL`, async ({ page }, info) => {
    const fixture = replicationFixture(), copies = mode === "mirror" ? 2 : 3;
    const volume = (radius: number, count = copies) => 24 * 16 * 8 - count * Math.PI * radius ** 2 * 8;
    const assertGeometry = async (expected: number) => expect(async () => {
      const state = await aiSnapshot(page);
      expect(state.status).toBe("succeeded");
      expect(state.result?.errors).toEqual([]);
      expect(state.result?.meshes).toHaveLength(1);
      const mesh = state.result!.meshes[0];
      expect(mesh).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
      expect(Math.abs(mesh.geometryAssertions!.volume / expected - 1), `Native BRep volume ${mesh.geometryAssertions!.volume} mm³; expected ${expected} mm³ (relative tolerance 1e-7)`).toBeLessThan(1e-7);
      expect(mesh.bounds.min).toEqual([0, 0, 0]);
      expect(mesh.bounds.max).toEqual([24, 16, 8]);
    }).toPass({ timeout: 30000 });
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({ name: "holes.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture.document)) });
    await assertGeometry(volume(1, 1));
    await page.getByRole("button", { name: `Plate holes XY plane, ${Object.keys(fixture.sketch.entities).length} entities`, exact: true }).click();
    await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
    await page.getByRole("button", { name: "Draw tool: select", exact: true }).click();
    await page.getByLabel("Selected sketch item", { exact: true }).selectOption(fixture.circleId);
    const opener = page.getByRole("button", { name: mode === "mirror" ? "Mirror selected sketch geometry" : "Linear pattern selected sketch geometry", exact: true });
    const panel = page.getByRole("region", { name: mode === "mirror" ? "Mirror sketch geometry" : "Linear sketch pattern", exact: true });
    const configure = async () => {
      await opener.click();
      if (mode === "mirror") await panel.getByRole("combobox", { name: "Mirror axis", exact: true }).selectOption(fixture.axisId);
      else {
        await panel.getByLabel("Total instance count (including source)", { exact: true }).fill("3");
        await panel.getByLabel("Pattern spacing", { exact: true }).fill("6mm");
        await panel.getByRole("combobox", { name: "Pattern direction", exact: true }).selectOption("X");
      }
    };
    const source = await aiSnapshot(page);
    await configure();
    await panel.getByRole("button", { name: "Preview copies", exact: true }).click();
    await expect(panel.getByLabel("Sketch copy status")).toContainText("Native copy preview ready");
    await expect(panel).toContainText(`${volume(1).toFixed(3)} mm³`);
    expect((await aiSnapshot(page)).document).toEqual(source.document);
    await panel.getByRole("button", { name: "Cancel copies", exact: true }).click();
    expect((await aiSnapshot(page)).past).toBe(source.past);
    await configure();
    await panel.getByRole("button", { name: "Preview copies", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Apply copies", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Apply copies", exact: true }).click();
    await assertGeometry(volume(1));
    const applied = await aiSnapshot(page), sketch = applied.document.sketches[fixture.sketch.id];
    expect(applied.past).toBe(source.past + 1);
    expect(applied.document.features[0].id).toBe(source.document.features[0].id);
    expect(applied.document.features[0]).not.toEqual(source.document.features[0]); // exact profile signature is repaired
    for (const [id, entity] of Object.entries(fixture.sketch.entities)) expect(sketch.entities[id]).toEqual(entity);
    expect(new Set(Object.keys(sketch.entities)).size).toBe(Object.keys(sketch.entities).length);
    expect(sketch.dimensions).toHaveLength(copies);
    expect(new Set(sketch.dimensions.map((dimension) => dimension.id)).size).toBe(copies);
    expect(sketch.dimensions.every((dimension) => dimension.expression.expression === "drillRadius")).toBe(true);
    const solved = applied.result!.solvedSketches![fixture.sketch.id];
    expect(solved.circles.map((circle) => circle.center.x).sort((a, b) => a - b)).toEqual(mode === "mirror" ? [4, 20] : [4, 10, 16]);
    expect(solved.circles.every((circle) => Math.abs(circle.center.y - 5) < 1e-7)).toBe(true);
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await assertGeometry(volume(1, 1));
    expect((await aiSnapshot(page)).document.sketches[fixture.sketch.id]).toEqual(source.document.sketches[fixture.sketch.id]);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await assertGeometry(volume(1));
    const radius = page.getByLabel("Parameter drillRadius expression", { exact: true });
    await radius.fill("1.5mm"); await radius.press("Enter");
    await assertGeometry(volume(1.5));
    expect((await aiSnapshot(page)).result!.solvedSketches![fixture.sketch.id].circles.every((circle) => Math.abs(circle.radius - 1.5) < 1e-7)).toBe(true);
    const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
    const path = info.outputPath(`${mode}.pcaddoc`); await (await saving).saveAs(path);
    const saved = JSON.parse(await readFile(path, "utf8")), beforeOpen = await aiSnapshot(page);
    await page.locator('input[type="file"]').setInputFiles(path);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(beforeOpen.session);
    await assertGeometry(volume(1.5));
    expect((await aiSnapshot(page)).document.sketches).toEqual(saved.sketches);
    const exporting = page.waitForEvent("download");
    await page.getByRole("navigation", { name: "Main CAD commands", exact: true }).getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${mode}.stl`); await (await exporting).saveAs(stl);
    // STL is faceted: allow 0.1% tessellation error while native BRep volume above remains strict.
    const exportedVolume = stlSignedVolume(await readFile(stl));
    expect(Math.abs(exportedVolume / volume(1.5) - 1), `Faceted STL volume ${exportedVolume} mm³; expected ${volume(1.5)} mm³ (relative tolerance 0.1%)`).toBeLessThan(0.001);
  });
}
