import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import type { SketchEntity } from "../src/cad/document/schema";
import { applyExtrusion } from "./extrudeWorkflow";

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      expect(state.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
      expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function pick(page: Page, x: number, y: number) {
  const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const client = await canvas.evaluate((element, point) => {
    if (!(element instanceof SVGSVGElement) || !element.getScreenCTM()) throw new Error("Sketch projection unavailable");
    const local = element.createSVGPoint(); local.x = point.x; local.y = -point.y;
    const screen = local.matrixTransform(element.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  await page.mouse.click(client.x, client.y);
}
for (const mode of ["trim", "extend"] as const) test(`analytic ${mode === "trim" ? "circle Trim on XY" : "arc Extend on YZ"} produces native curved volume, Undo, save/open and STL`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/"); await ready(page);
  const ids = await page.evaluate(async (mode) => {
    const docPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", storePath = "/src/state/useCadStore.ts";
    const doc = await import(docPath), model = await import(modelPath), { useCadStore } = await import(storePath);
    let sketch = model.createSketchOnPlane("Analytic curved part", mode === "trim" ? "XY" : "YZ");
    let targetId: string;
    if (mode === "trim") {
      sketch = model.addCircleAt(sketch, "0mm", "0mm", "10mm");
      targetId = (Object.values(sketch.entities) as SketchEntity[]).find((e) => e.type === "circle")!.id;
      const a = model.addPoint(sketch, "-10mm", "0mm"), b = model.addPoint(a.sketch, "10mm", "0mm"), diameter = model.addLine(b.sketch, a.pointId, b.pointId);
      sketch = diameter.sketch;
    } else {
      const center = model.addPoint(sketch, "0mm", "0mm"), start = model.addPoint(center.sketch, "10mm", "0mm"), end = model.addPoint(start.sketch, "7.071067811865mm", "7.071067811865mm");
      const curved = model.addArc(end.sketch, center.pointId, start.pointId, end.pointId);
      sketch = curved.sketch; targetId = curved.arcId;
      const top = model.addPoint(sketch, "0mm", "10mm"), first = model.addLine(top.sketch, center.pointId, top.pointId), second = model.addLine(first.sketch, center.pointId, start.pointId);
      sketch = second.sketch;
    }
    const document = doc.upsertSketch(doc.createEmptyDocument("Analytic curve acceptance"), sketch);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return { sketchId: sketch.id, targetId };
  }, mode);
  await ready(page);
  let fullDiskVolume: number | undefined;
  if (mode === "trim") {
    fullDiskVolume = await page.evaluate(async (ids) => {
      const storePath = "/src/state/useCadStore.ts", docPath = "/src/cad/document/CadDocument.ts", previewPath = "/src/cad/worker/extrudePreviewClient.ts";
      const { useCadStore } = await import(storePath), doc = await import(docPath), { previewModeling } = await import(previewPath);
      const solverPath = "/src/cad/sketch/SketchSolver.ts", profilesPath = "/src/cad/sketch/profileDetection.ts";
      const { solveSketch } = await import(solverPath), { detectProfiles } = await import(profilesPath);
      const source = useCadStore.getState().history.present, sketch = source.sketches[ids.sketchId];
      // A temporary construction diameter keeps the baseline a full disk. The authored source stays unchanged.
      const entities = Object.fromEntries(Object.entries(sketch.entities).map(([id, value]) => {
        const entity = value as SketchEntity;
        return [id, entity.type === "line" ? { ...entity, construction: true } : entity];
      }));
      const baselineSketch = { ...sketch, entities }, baseline = doc.upsertSketch(source, baselineSketch);
      const profile = detectProfiles(solveSketch(baselineSketch, {})).profiles.find((p: { outerLoop: { type: string } }) => p.outerLoop.type === "circle");
      if (!profile) throw new Error("Baseline circle profile unavailable");
      const candidate = doc.upsertFeature(baseline, doc.createExtrudeFeature({ name: "Read-only baseline disk", sketchId: ids.sketchId, profileId: profile.id,
        distance: { expression: "4mm", unit: "mm" }, operation: "newBody", direction: "positive" }));
      const result = await previewModeling(candidate, new AbortController().signal), mesh = result.meshes[0];
      if (!result.success || result.meshes.length !== 1 || mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions.valid || mesh.geometryAssertions.solidCount !== 1)
        throw new Error("Baseline native disk assertions failed");
      if (useCadStore.getState().history.present !== source) throw new Error("Read-only baseline changed the document");
      return mesh.geometryAssertions.volume;
    }, ids);
    expect(fullDiskVolume).toBeCloseTo(400 * Math.PI, 6);
  }
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  const before = await aiSnapshot(page);
  await page.getByRole("button", { name: `${mode === "trim" ? "Trim" : "Extend"} sketch lines`, exact: true }).click();
  const task = page.getByRole("region", { name: `${mode === "trim" ? "Trim" : "Extend"} sketch lines`, exact: true });
  await task.getByLabel("Line to edit").selectOption(ids.targetId);
  await pick(page, mode === "trim" ? 0 : 7, mode === "trim" ? 10 : 7);
  await task.getByRole("button", { name: `Preview ${mode}`, exact: true }).click();
  await expect(task.getByRole("button", { name: `Apply ${mode}`, exact: true })).toBeEnabled();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await task.getByRole("button", { name: `Apply ${mode}`, exact: true }).click();
  await expect(async () => {
    const state = await aiSnapshot(page), arc = state.result?.solvedSketches?.[ids.sketchId]?.arcs.find((a) => a.id === ids.targetId);
    expect(state.status).toBe("succeeded"); expect(arc?.radius).toBeCloseTo(10, 9);
    expect(arc?.sweep).toBeCloseTo(mode === "trim" ? Math.PI : Math.PI / 2, 9);
    expect(state.result!.profiles![ids.sketchId]).toHaveLength(1);
  }).toPass({ timeout: 30000 });
  const edited = await aiSnapshot(page);
  expect(edited.past).toBe(before.past + 1);
  await test.step("Undo and redo restore the solved curve", async () => {
    await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; (await import(path)).useCadStore.getState().undo(); });
    await expect(async () => {
      const state = await aiSnapshot(page), solved = state.result?.solvedSketches?.[ids.sketchId];
      expect(state.status).toBe("succeeded"); expect(state.document).toEqual(before.document);
      if (mode === "trim") { expect(solved?.circles.find((c) => c.id === ids.targetId)?.radius).toBeCloseTo(10, 9); expect(solved?.arcs.find((a) => a.id === ids.targetId)).toBeUndefined(); }
      else expect(solved?.arcs.find((a) => a.id === ids.targetId)?.sweep).toBeCloseTo(Math.PI / 4, 9);
    }).toPass({ timeout: 30000 });
    await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; (await import(path)).useCadStore.getState().redo(); });
    await expect(async () => {
      const state = await aiSnapshot(page), arc = state.result?.solvedSketches?.[ids.sketchId]?.arcs.find((a) => a.id === ids.targetId);
      expect(state.status).toBe("succeeded"); expect(state.document).toEqual(edited.document);
      expect(arc?.sweep).toBeCloseTo(mode === "trim" ? Math.PI : Math.PI / 2, 9);
    }).toPass({ timeout: 30000 });
  });
  const volume = (mode === "trim" ? 200 : 100) * Math.PI;
  await test.step("Extrude an analytic native solid", async () => {
    await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
    await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
    await page.getByLabel("Extrude distance", { exact: true }).fill("4mm"); await applyExtrusion(page);
    await ready(page, volume);
    if (fullDiskVolume !== undefined) expect((await aiSnapshot(page)).result!.meshes[0].geometryAssertions!.volume / fullDiskVolume).toBeCloseTo(0.5, 6);
  });
  // Exact BRep volume excludes replacing the curve with its endpoint chord.
  const final = await aiSnapshot(page), bounds = final.result!.meshes[0].bounds;
  const expected = mode === "trim" ? { min: [-10, -10, 0], max: [10, 0, 4] } : { min: [0, 0, 0], max: [4, 10, 10] };
  for (const side of ["min", "max"] as const) expected[side].forEach((value, i) => expect(bounds[side][i]).toBeCloseTo(value, 6));
  await test.step("Save and open retain geometry and references", async () => {
    const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
    const project = info.outputPath(`${mode}-curves.pcaddoc`); await (await saving).saveAs(project);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(final.session); await ready(page, volume);
    expect((await aiSnapshot(page)).document.sketches[ids.sketchId]).toEqual(final.document.sketches[ids.sketchId]);
  });
  await test.step("Export STL with oriented tessellation volume", async () => {
    const exporting = page.waitForEvent("download"); await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${mode}-curves.stl`); await (await exporting).saveAs(stl);
    expect(Math.abs(stlSignedVolume(await readFile(stl)) / volume - 1)).toBeLessThan(0.005);
  });
  expect(errors).toEqual([]);
});
