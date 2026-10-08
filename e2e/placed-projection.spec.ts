import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addComponent } from "../src/cad/document/components";
import { withComponentPlacement } from "../src/cad/document/componentPlacement";
import { addArc, addCircleAt, addCornerRectangle, addLine, addPoint, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { CURRENT_SCHEMA_VERSION } from "../src/cad/document/schema";
import type { CadDocument, ComponentPlacement, OriginPlane, Sketch } from "../src/cad/document/schema";
import { TESSELLATION_LOD } from "../src/cad/kernel/tessellationCache";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";

function fixture(plane: OriginPlane = "XY", arc = false) {
  const source = addComponent(createEmptyDocument("World linked part"), "Source"), destination = addComponent(source.document, "Destination");
  let sketch: Sketch = { ...createSketchOnPlane("Source boundary", plane), componentId: source.component.id };
  if (arc) {
    const center = addPoint(sketch, "5mm", "7mm"), start = addPoint(center.sketch, "5mm + radius", "7mm"), end = addPoint(start.sketch, "5mm - radius", "7mm");
    const curved = addArc(end.sketch, center.pointId, start.pointId, end.pointId, false);
    sketch = addLine(curved.sketch, end.pointId, start.pointId).sketch;
  } else sketch = addCircleAt(sketch, "5mm", "7mm", "radius");
  const profile = detectProfiles(solveSketch(sketch, { radius: { value: 3, unit: "mm", dimension: "length" } })).profiles[0];
  const feature = createExtrudeFeature({ name: "Source extrusion", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
  const target = { ...createSketchOnPlane("Destination", { type: "offset" as const, base: plane, offset: { expression: "12mm", unit: "mm" } }), componentId: destination.component.id };
  let document = upsertSketch(upsertFeature(upsertSketch(upsertParameter(destination.document, { id: "radius-parameter", name: "radius", expression: "3mm", value: 3, unit: "mm" }), sketch), feature), target);
  document = withComponentPlacement(document, source.component.id, { translation: [50, 20, 10], rotation: arc ? [Math.PI, 0, 0] : [0, 0, 0] });
  document = withComponentPlacement(document, destination.component.id, { translation: [5, 7, 2], rotation: [0, 0, 0] });
  return { document, source: source.component.id, destination: destination.component.id, target, feature, arc };
}
async function native(page: Page, expected: number[]) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result!.errors).toEqual([]); expect(state.result!.meshes).toHaveLength(expected.length);
    state.result!.meshes.forEach((mesh, index) => {
      expect(mesh).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(expected[index], 6);
    });
  }).toPass({ timeout: 30000 });
}
async function edit(page: Page, targetId: string) {
  await page.evaluate(async (id) => {
    const path = "/src/state/useCadStore.ts", store = (await import(path)).useCadStore.getState();
    store.select({ kind: "sketch", id, documentId: store.history.present.id });
  }, targetId);
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
}
async function project(page: Page, choices = 3) {
  await page.getByRole("button", { name: "Project part edges into sketch", exact: true }).click();
  const panel = page.getByRole("region", { name: "Project part edges", exact: true });
  await expect(panel.getByLabel("Source part boundary").locator("option")).toHaveCount(choices);
  const end = await panel.getByLabel("Source part boundary").locator("option").evaluateAll(options => options.find(option => option.textContent?.includes("Source extrusion") && option.textContent?.includes("End cap"))?.getAttribute("value"));
  expect(end).toBeTruthy(); await panel.getByLabel("Source part boundary").selectOption(end!);
  await panel.getByRole("button", { name: "Preview projected boundary" }).click();
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply projected boundary" }).click();
}
async function consumer(page: Page, sketchId: string) {
  await page.evaluate(async (id) => {
    const storePath = "/src/state/useCadStore.ts", helperPath = "/src/cad/document/CadDocument.ts";
    const store = (await import(storePath)).useCadStore.getState(), helpers = await import(helperPath);
    const profile = store.rebuild.result!.profiles![id][0];
    store.updateDocument((document: CadDocument) => helpers.upsertFeature(document, helpers.createExtrudeFeature({ name: "Linked consumer", sketchId: id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "2mm", unit: "mm" } })));
  }, sketchId);
}
async function exportShells(page: Page, path: string, consumerOnly = false) {
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "STL export options", exact: true });
  await expect(panel).toBeVisible(); await panel.getByLabel("Output files").selectOption("shells");
  if (consumerOnly) await panel.getByRole("checkbox", { name: "Export body Source", exact: true }).uncheck();
  const downloading = page.waitForEvent("download"); await panel.getByRole("button", { name: "Generate STL", exact: true }).click();
  await (await downloading).saveAs(path);
}
async function move(page: Page, componentId: string, placement: ComponentPlacement) {
  await page.evaluate(async ({ componentId, placement }) => {
    const storePath = "/src/state/useCadStore.ts", commandPath = "/src/ui/commands/componentPlacementCommand.ts", statePath = "/src/ui/commands/componentPlacementState.ts";
    const store = (await import(storePath)).useCadStore.getState(); store.activateComponent(componentId);
    const command = await import(commandPath); command.beginComponentPlacement(componentId);
    const frame = (await import(statePath)).useComponentPlacement.getState().frame!;
    try {
      const proof = await command.previewComponentPlacement(frame, placement, new AbortController().signal);
      command.applyComponentPlacement(proof, placement);
    } finally { command.cancelComponentPlacement(); }
  }, { componentId, placement });
}

for (const plane of ["XY", "XZ", "YZ"] as const) test(`native placed ${plane} circle links preserve analytic geometry and export orientation`, async ({ page }, info) => {
  const f = fixture(plane); await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: `placed-${plane}.pcaddoc`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(f.document)) });
  await native(page, [Math.PI * 72]); await edit(page, f.target.id); await project(page); await native(page, [Math.PI * 72]);
  const linked = await aiSnapshot(page), circle = linked.result!.solvedSketches![f.target.id].circles[0];
  const delta = plane === "XY" ? [45, 13] : plane === "XZ" ? [45, 8] : [13, 8];
  expect(circle.center.x).toBeCloseTo(5 + delta[0], 8); expect(circle.center.y).toBeCloseTo(7 + delta[1], 8); expect(circle.radius).toBe(3);
  expect(linked.document.sketches[f.target.id].projections![0].coordinateSpace).toBe("world");
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click(); await consumer(page, f.target.id); await native(page, [Math.PI * 72, Math.PI * 18]);
  const mesh = (await aiSnapshot(page)).result!.meshes[1];
  const expected = plane === "XY" ? { min: [52, 24, 14], max: [58, 30, 16] } : plane === "XZ" ? { min: [52, -7, 14], max: [58, -5, 20] } : { min: [17, 22, 14], max: [19, 28, 20] };
  // Curved mesh extrema are tessellated samples, not an analytic BRep box.
  // Verify their bounded approximation, then every native side-wall vertex and
  // normal against the exact expected circle in independently chosen world axes.
  const minimumRadialNormal = circle.radius * Math.cos(TESSELLATION_LOD.default.angularDeflection / 2);
  const curveSampleTolerance = circle.radius - minimumRadialNormal + 1e-7;
  mesh.bounds.min.forEach((value, axis) => expect(Math.abs(value - expected.min[axis])).toBeLessThan(curveSampleTolerance));
  mesh.bounds.max.forEach((value, axis) => expect(Math.abs(value - expected.max[axis])).toBeLessThan(curveSampleTolerance));
  const normalAxis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0;
  const radialAxes = plane === "XY" ? [0, 1] : plane === "XZ" ? [0, 2] : [1, 2];
  const center = plane === "XY" ? [55, 27, 15] : plane === "XZ" ? [55, -6, 17] : [18, 25, 17];
  let wallVertices = 0; const quadrants = new Set<string>();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.abs(mesh.normals[i + normalAxis]) > 1e-7) continue;
    const a = mesh.positions[i + radialAxes[0]] - center[radialAxes[0]], b = mesh.positions[i + radialAxes[1]] - center[radialAxes[1]];
    expect(Math.hypot(a, b)).toBeCloseTo(3, 7);
    // Render normals are triangle-facet normals, bounded near the outward radial direction.
    expect(a * mesh.normals[i + radialAxes[0]] + b * mesh.normals[i + radialAxes[1]]).toBeGreaterThan(minimumRadialNormal - 1e-7);
    expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBeCloseTo(1, 8);
    expect(Math.min(Math.abs(mesh.positions[i + normalAxis] - expected.min[normalAxis]), Math.abs(mesh.positions[i + normalAxis] - expected.max[normalAxis]))).toBeLessThan(1e-7);
    quadrants.add(`${a >= 0}:${b >= 0}`); wallVertices++;
  }
  expect(wallVertices).toBeGreaterThan(8); expect(quadrants.size).toBe(4);
  const path = info.outputPath(`placed-${plane}.stl`); await exportShells(page, path, true);
  expect(stlSignedVolume(await readFile(path))).toBeCloseTo(Math.PI * 18, 0);
});

test("opposite-normal linked arcs follow source and target motion, undo/save/open, native parameter rebuild and stale preview rejection", async ({ page }, info) => {
  const f = fixture("XY", true); await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "placed-arc.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(f.document)) });
  await native(page, [Math.PI * 36]); await edit(page, f.target.id); const before = await aiSnapshot(page); await project(page); await native(page, [Math.PI * 36]);
  const applied = await aiSnapshot(page), arc = applied.result!.solvedSketches![f.target.id].arcs[0], link = applied.document.sketches[f.target.id].projections![0];
  expect(applied.past).toBe(before.past + 1); expect(arc.center).toMatchObject({ x: 50, y: 6 }); expect(arc.radius).toBe(3); expect(arc.sweep).toBeCloseTo(-Math.PI, 9);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click(); await consumer(page, f.target.id); await native(page, [Math.PI * 36, Math.PI * 9]);
  await move(page, f.source, { translation: [62, 20, 10], rotation: [Math.PI, 0, 0] }); await native(page, [Math.PI * 36, Math.PI * 9]);
  let state = await aiSnapshot(page); expect(state.result!.meshes[1].bounds.min[0]).toBeCloseTo(64, 6); expect(state.result!.solvedSketches![f.target.id].arcs[0].center.x).toBeCloseTo(62, 8);
  await move(page, f.destination, { translation: [11, 12, 3], rotation: [0, 0, Math.PI / 2] }); await native(page, [Math.PI * 36, Math.PI * 9]);
  state = await aiSnapshot(page); expect(state.result!.meshes[1].bounds.min[0]).toBeCloseTo(64, 6); expect(state.result!.meshes[1].bounds.min[2]).toBeCloseTo(15, 6);
  expect(state.result!.solvedSketches![f.target.id].arcs[0].center).toMatchObject({ x: 1, y: -56 });
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await native(page, [Math.PI * 36, Math.PI * 9]); expect((await aiSnapshot(page)).document.components[f.destination].placement).toEqual(f.document.components[f.destination].placement);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await native(page, [Math.PI * 36, Math.PI * 9]);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const path = info.outputPath("placed-link.pcaddoc"); await (await saving).saveAs(path);
  const saved = JSON.parse(await readFile(path, "utf8")); expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(saved.sketches[f.target.id].projections![0]).toEqual(link);
  const previousSession = (await aiSnapshot(page)).session; await page.locator('input[type="file"]').setInputFiles(path);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(previousSession); await native(page, [Math.PI * 36, Math.PI * 9]);
  const radius = page.getByRole("textbox", { name: "Parameter radius expression", exact: true }); await radius.fill("4mm"); await radius.press("Enter"); await native(page, [Math.PI * 64, Math.PI * 16]);
  expect((await aiSnapshot(page)).result!.solvedSketches![f.target.id].arcs[0].radius).toBe(4);
  const stl = info.outputPath("placed-arc.stl"); await exportShells(page, stl); expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(Math.PI * 80, 0);
  await edit(page, f.target.id);
  // Capture a real native candidate, move the source after it finishes, then
  // attempt Apply. A proof from the old relative pose must never commit.
  const stale = await page.evaluate(async ({ targetId, featureId, sourceId }) => {
    const commandPath = "/src/ui/commands/sketchProjectionCommand.ts", storePath = "/src/state/useCadStore.ts", plannerPath = "/src/cad/sketch/sketchProjection.ts", placementPath = "/src/cad/document/componentPlacement.ts";
    const command = await import(commandPath), store = (await import(storePath)).useCadStore;
    command.openSketchProjection(); const frame = command.useSketchProjection.getState().frame!;
    const sources = await command.loadSketchProjectionSources(frame, new AbortController().signal);
    const plan = (await import(plannerPath)).planSketchProjection(frame.document, targetId, featureId, "startCapPerimeter", true, sources.proof);
    const proof = await command.previewSketchProjection(frame, plan, new AbortController().signal);
    const placements = await import(placementPath); store.getState().updateDocument((document: CadDocument) => placements.withComponentPlacement(document, sourceId, { translation: [63, 20, 10], rotation: [Math.PI, 0, 0] }));
    let message = ""; try { command.applySketchProjection(frame, plan, proof.result); } catch (error) { message = String(error); }
    command.cancelSketchProjection(); return message;
  }, { targetId: f.target.id, featureId: f.feature.id, sourceId: f.source });
  expect(stale).toContain("old projection"); await native(page, [Math.PI * 64, Math.PI * 16]); expect((await aiSnapshot(page)).document.sketches[f.target.id].projections).toHaveLength(1);
  // Incompatible relative rotations diagnose, remain recoverable with Undo and
  // never substitute an elliptical/polyline approximation for the authored arc.
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.evaluate(async (id) => { const sp = "/src/state/useCadStore.ts", pp = "/src/cad/document/componentPlacement.ts", placements = await import(pp); (await import(sp)).useCadStore.getState().updateDocument((document: CadDocument) => placements.withComponentPlacement(document, id, { translation: [63, 20, 10], rotation: [Math.PI - 0.2, 0, 0] })); }, f.source);
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("failed");
  const failed = await aiSnapshot(page); expect(failed.result!.errors.some(error => error.sourceId === f.target.id && error.message.includes("parallel planes"))).toBe(true); await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await native(page, [Math.PI * 64, Math.PI * 16]);
});


test("moving a projected cut changes only its traced native consumer volume and rejects no-op motion", async ({ page }) => {
  const f = fixture();
  const sourceSketch = f.document.sketches[f.feature.sketchId], baseSketch = { ...addCornerRectangle(createSketchOnPlane("Target base", "XY"), "30mm", "20mm"), componentId: f.destination };
  const baseProfile = detectProfiles(solveSketch(baseSketch, {})).profiles[0];
  const base = createExtrudeFeature({ name: "Target block", sketchId: baseSketch.id, profileId: baseProfile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } });
  let document: CadDocument = { ...f.document, sketches: { [sourceSketch.id]: sourceSketch }, features: f.document.features.filter(feature => feature.id === f.feature.id) };
  document = upsertFeature(upsertSketch(document, baseSketch), base);
  const cutSketch = { ...createSketchOnPlane("Linked cutting circle", "XY"), componentId: f.destination };
  document = upsertSketch(document, cutSketch);
  document = withComponentPlacement(document, f.source, { translation: [15, 0, 10], rotation: [0, 0, 0] });
  document = withComponentPlacement(document, f.destination, { translation: [0, 0, 0], rotation: [0, 0, 0] });
  await page.goto("/"); await page.locator('input[type="file"]').setInputFiles({ name: "world-cut.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await native(page, [Math.PI * 72, 4800]); await edit(page, cutSketch.id); await project(page, 5); await native(page, [Math.PI * 72, 4800]);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.evaluate(async ({ sketchId, bodyId }) => {
    const sp = "/src/state/useCadStore.ts", hp = "/src/cad/document/CadDocument.ts", helpers = await import(hp), store = (await import(sp)).useCadStore.getState();
    store.updateDocument((document: CadDocument) => helpers.upsertFeature(document, helpers.createExtrudeFeature({ name: "Linked cut", sketchId, profileId: store.rebuild.result!.profiles![sketchId][0].id, operation: "cut", targetBodyIds: [bodyId], direction: "positive", distance: { expression: "8mm", unit: "mm" } })));
  }, { sketchId: cutSketch.id, bodyId: `body:${base.id}` });
  await native(page, [Math.PI * 72, 4800 - Math.PI * 72]); const before = await aiSnapshot(page);
  await move(page, f.source, { translation: [23, 0, 10], rotation: [0, 0, 0] });
  const circularCap = 9 * Math.acos(2 / 3) - 2 * Math.sqrt(5), remaining = 4800 - 8 * (Math.PI * 9 - circularCap);
  await native(page, [Math.PI * 72, remaining]); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  const rejected = await page.evaluate(async (componentId) => {
    const sp = "/src/state/useCadStore.ts", cp = "/src/ui/commands/componentPlacementCommand.ts", fp = "/src/ui/commands/componentPlacementState.ts";
    const store = (await import(sp)).useCadStore.getState(), command = await import(cp); store.activateComponent(componentId); command.beginComponentPlacement(componentId);
    const frame = (await import(fp)).useComponentPlacement.getState().frame!;
    let message = ""; try { await command.previewComponentPlacement(frame, { translation: [100, 0, 10], rotation: [0, 0, 0] }, new AbortController().signal); } catch (error) { message = String(error); }
    command.cancelComponentPlacement(); return message;
  }, f.source);
  expect(rejected).toContain("Boolean cut removed no volume. Move the tool into the target body."); await native(page, [Math.PI * 72, remaining]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await native(page, [Math.PI * 72, 4800 - Math.PI * 72]);
});
