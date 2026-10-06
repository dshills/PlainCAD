import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
async function ready(page: Page, volume: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
    expect(state.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    const actual = state.result!.meshes[0].geometryAssertions!.volume;
    expect(Math.abs(actual - volume), `Native volume ${actual} must match expected ${volume}`).toBeLessThan(Math.max(1e-6, Math.abs(volume) * 1e-7));
  }).toPass({ timeout: 30000 });
}
async function seedAiPlate(page: Page, plane: "XY" | "XZ" | "YZ") {
  return await page.evaluate(async (plane) => {
      const docsPath = "/src/cad/document/CadDocument.ts", modelPath = "/src/cad/sketch/SketchModel.ts", geomPath = "/src/cad/sketch/canvasGeometry.ts", solverPath = "/src/cad/sketch/SketchSolver.ts", profilePath = "/src/cad/sketch/profileDetection.ts", statePath = "/src/state/useCadStore.ts";
      const docs = await import(docsPath), models = await import(modelPath), geom = await import(geomPath), solver = await import(solverPath), profiles = await import(profilePath), state = await import(statePath);
      const base = models.createSketchOnPlane("AI plate outline", plane), sketch = geom.addCanvasGeometry(base, solver.solveSketch(base, {}), "rectangle", [{ x: 0, y: 0 }, { x: 40, y: 30 }]).sketch;
      let document = docs.upsertSketch(docs.createEmptyDocument("Existing feature AI part"), sketch);
      document = docs.upsertParameter(document, { id: "holeSize", name: "holeSize", expression: "3mm", value: 3, unit: "mm" });
      const feature = docs.createExtrudeFeature({ name: "AI target plate", sketchId: sketch.id, profileId: profiles.detectProfiles(solver.solveSketch(sketch, {})).profiles[0].id, direction: "positive", operation: "newBody", distance: { expression: "10mm", unit: "mm" } });
      state.useCadStore.getState().setDocument(docs.upsertFeature(document, feature)); return feature.id;
    }, plane);
}
for (const [provider, plane] of [["anthropic", "XY"], ["openai", "XZ"], ["google", "YZ"]] as const) {
  test(`${provider} adds native face holes and pocket on ${plane} in one explicit Apply with cancellation, bindings and durable STL`, async ({ page }, info) => {
    test.setTimeout(180000);
    const requests: Array<Record<string, unknown>> = [];
    let count = 0;
    const held: { release?: () => void } = {};
    const actions = [
      { kind: "holes", centers: [{ x: "5mm", y: "5mm" }, { x: "35mm", y: "5mm" }, { x: "5mm", y: "25mm" }, { x: "35mm", y: "25mm" }], diameter: "holeSize", depth: "throughAll" },
      { kind: "pocket", profile: { type: "rectangle", x: "15mm", y: "10mm", width: "10mm", height: "10mm" }, depth: "2mm" },
    ];
    await page.route("**/api/ai/status", (route) => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map((id) => ({ id, label: id, available: true, model: "test-model" })) } }));
    await page.route("**/api/ai/features", async (route) => {
      requests.push(route.request().postDataJSON()); count++;
      if (count === 1) { await route.fulfill({ json: { proposal: { summary: "Which coordinates and sizes?", warnings: [], actions: [] } } }); return; }
      if (count === 2) await new Promise<void>((resolve) => { held.release = resolve; });
      await route.fulfill({ json: { proposal: { summary: "Four mounting holes and a shallow pocket", warnings: ["New holes reference shared holeSize."], actions } } });
    });
    await page.goto("/");
    const ownerId = await seedAiPlate(page, plane);
    await ready(page, 12000);
    await page.getByRole("button", { name: "Open AI drawer", exact: true }).click();
    await page.getByRole("button", { name: "Add features to this part", exact: true }).click();
    const panel = page.getByLabel("AI feature additions", { exact: true });
    await panel.getByLabel("Feature target face").selectOption(`extrude:${ownerId}:endCap`);
    await panel.getByLabel("Feature AI provider").selectOption(provider);
    const prompt = panel.getByLabel("Feature request"), generate = panel.getByRole("button", { name: "Generate AI feature preview" });
    await prompt.fill("Add four mounting holes and a pocket"); await expect(generate).toBeDisabled(); expect(requests).toHaveLength(0);
    await panel.getByRole("checkbox").check(); const before = await aiSnapshot(page);
    await generate.click(); await expect(panel.getByRole("status")).toContainText("clarification");
    expect((await aiSnapshot(page)).document).toEqual(before.document);
    await page.getByRole("button", { name: "Describe or edit a part", exact: true }).click();
    await page.getByRole("button", { name: "Add features to this part", exact: true }).click();
    await expect(prompt).toHaveValue("Add four mounting holes and a pocket");
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
    await panel.getByRole("checkbox").check();
    await prompt.fill("Use four holeSize holes at (5,5), (35,5), (5,25), (35,25), through all; rectangle pocket at (15,10), 10 by 10, depth 2 mm");
    await generate.click(); await expect.poll(() => requests.length).toBe(2);
    await panel.getByRole("button", { name: "Cancel AI feature proposal" }).click();
    if (!held.release) throw new Error("Expected held provider response");
    held.release();
    await expect(panel.getByRole("status")).toContainText("canceled");
    await expect(panel.getByRole("button", { name: "Apply AI feature plan" })).toHaveCount(0);
    expect((await aiSnapshot(page)).past).toBe(before.past);
    await generate.click(); await expect(panel.getByRole("status")).toContainText("Native feature preview ready", { timeout: 60000 });
    expect(requests[2].provider).toBe(provider); expect(requests[2].history).toHaveLength(2);
    expect(JSON.stringify(requests[2])).not.toMatch(/schemaVersion|meshes|positions|API_KEY/);
    expect((await aiSnapshot(page)).document).toEqual(before.document);
    await panel.getByRole("button", { name: "Apply AI feature plan" }).click();
    const expected = 12000 - 4 * Math.PI * 1.5 ** 2 * 10 - 200; await ready(page, expected);
    const after = await aiSnapshot(page); expect(after.past).toBe(before.past + 1); expect(after.document.features).toHaveLength(3);
    expect(after.document.features[0]).toEqual(before.document.features[0]); expect(after.document.parameters.holeSize).toEqual(before.document.parameters.holeSize);
    const hole = after.document.features.find((feature) => feature.type === "hole")!;
    if (hole.type !== "hole") throw new Error("Expected Hole");
    expect(hole.diameter.expression).toBe("holeSize"); expect(hole.direction).toBe("negative"); expect(hole.targetBodyIds).toEqual([`body:${ownerId}`]);
    const bounds = after.result!.meshes[0].bounds;
    const expectedBounds = plane === "XY" ? { min: [0, 0, 0], max: [40, 30, 10] } : plane === "XZ" ? { min: [0, -10, 0], max: [40, 0, 30] } : { min: [0, 0, 0], max: [10, 40, 30] };
    for (const side of ["min", "max"] as const) expectedBounds[side].forEach((value, axis) => expect(bounds[side][axis]).toBeCloseTo(value, 6));
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page, 12000);
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(page, expected);
    const param = page.getByRole("textbox", { name: "Parameter holeSize expression", exact: true }); await param.fill("4mm"); await param.press("Enter");
    const editedVolume = 12000 - 4 * Math.PI * 2 ** 2 * 10 - 200; await ready(page, editedVolume);
    const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
    const path = info.outputPath(`${provider}-feature-plan.pcaddoc`); await (await saving).saveAs(path);
    await page.locator('input[type="file"]').setInputFiles(path); await ready(page, editedVolume);
    const exporting = page.waitForEvent("download"); await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${provider}-feature-plan.stl`); await (await exporting).saveAs(stl);
    expect(Math.abs(stlSignedVolume(await readFile(stl)) - editedVolume) / editedVolume).toBeLessThan(0.0025);
  });
}

test("AI adds one authored cap chamfer through a native private preview, cancel and one Apply", async ({ page }) => {
  const selected: { edge?: { id: string; sourceEntityId: string } } = {};
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map((id) => ({ id, label: id, available: true, model: "test-model" })) } }));
  await page.route("**/api/ai/features", async (route) => {
    const context = route.request().postDataJSON().featureContext;
    selected.edge = context.edges.find((edge: { role: string; sourceEntityId?: string }) => edge.role === "endCapPerimeter" && edge.sourceEntityId);
    if (!selected.edge) { await route.fulfill({ status: 400, json: { error: "Expected individual supported cap edge in shared context" } }); return; }
    await route.fulfill({ json: { proposal: { summary: "One 1 mm cap-edge chamfer", warnings: [], actions: [{ kind: "chamfer", edgeIds: [selected.edge.id], size: "1mm" }] } } });
  });
  await page.goto("/");
  const ownerId = await seedAiPlate(page, "XY"); await ready(page, 12000);
  await page.getByRole("button", { name: "Open AI drawer", exact: true }).click();
  await page.getByRole("button", { name: "Add features to this part", exact: true }).click();
  const panel = page.getByLabel("AI feature additions", { exact: true });
  await panel.getByLabel("Feature target face").selectOption(`extrude:${ownerId}:endCap`);
  await panel.getByLabel("Feature AI provider").selectOption("anthropic");
  await panel.getByLabel("Feature request").fill("Chamfer one supported end cap edge by 1 mm");
  await panel.getByRole("checkbox").check(); const before = await aiSnapshot(page);
  const generate = panel.getByRole("button", { name: "Generate AI feature preview" });
  await generate.click(); await expect(panel.getByRole("status")).toContainText("Native feature preview ready", { timeout: 60000 });
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await panel.getByRole("button", { name: "Cancel AI feature proposal" }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await generate.click(); await expect(panel.getByRole("status")).toContainText("Native feature preview ready", { timeout: 60000 });
  if (!selected.edge) throw new Error("Expected chosen cap edge");
  const edgeId = selected.edge.sourceEntityId;
  const source = Object.values(before.document.sketches).find((sketch) => sketch.entities[edgeId]);
  const line = source?.entities[edgeId];
  if (!source || line?.type !== "line") throw new Error("Expected authored source line");
  const a = source.entities[line.startPointId], b = source.entities[line.endPointId];
  if (a.type !== "point" || b.type !== "point") throw new Error("Expected source line endpoints");
  const length = Math.hypot(parseFloat(a.x.expression) - parseFloat(b.x.expression), parseFloat(a.y.expression) - parseFloat(b.y.expression));
  await panel.getByRole("button", { name: "Apply AI feature plan" }).click(); await ready(page, 12000 - length / 2);
  const after = await aiSnapshot(page), feature = after.document.features.at(-1);
  expect(after.past).toBe(before.past + 1);
  if (feature?.type !== "chamfer") throw new Error("Expected real added chamfer");
  expect(feature.targetEdgeRefs).toHaveLength(1); expect(feature.targetEdgeRefs[0].sourceEntityId).toBe(edgeId);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page, 12000);
});
