import { test, expect } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { inspectPngDownload } from "./pngDownload";

test("native project/isolated part and dimensioned sketch download real PNG pixels without changing the design or camera", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const sketchId = await page.evaluate(async () => {
    const dp = "/src/cad/document/CadDocument.ts", kp = "/src/cad/sketch/SketchModel.ts", sp = "/src/state/useCadStore.ts", pp = "/src/cad/sketch/profileDetection.ts", rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp), model = await import(kp), { solveSketch } = await import(rp), { detectProfiles } = await import(pp);
    let document = ops.createEmptyDocument("PNG assembly"), first = "";
    for (const [index, x] of [0, 100].entries()) {
      const sketch = model.addCircleAt(model.createXySketch(`Drawing ${index + 1}`), `${x}mm`, "15mm", "10mm");
      first ||= sketch.id;
      document = ops.upsertSketch(document, sketch);
      document = ops.upsertFeature(document, ops.createExtrudeFeature({ name: `Part ${index + 1}`, sketchId: sketch.id, profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id, operation: "newBody", direction: "positive", distance: { expression: "12mm", unit: "mm" } }));
    }
    (await import(sp)).useCadStore.getState().setDocument(document);
    return first;
  });
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.meshes).toHaveLength(2);
    for (const mesh of state.result!.meshes) {
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(Math.PI * 100 * 12, 5);
    }
  }).toPass();
  const before = await aiSnapshot(page);
  const inspect = () => page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).inspectViewer(); });
  await expect(async () => expect((await inspect()).meshes).toHaveLength(2)).toPass();
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project view PNG", exact: true }).click();
  await inspectPngDownload(page, await download, info.outputPath("project.png"));
  await page.getByRole("button", { name: "Part 1", exact: true }).click();
  await page.getByLabel("Show body Part 1", { exact: true }).uncheck();
  await page.evaluate(async () => { const cp = "/src/state/sectionState.ts", sp = "/src/state/useCadStore.ts"; (await import(cp)).useSectionState.getState().setSection((await import(sp)).useCadStore.getState().documentSession, "X", 50, true); });
  await expect(async () => expect((await inspect()).meshes.every((mesh: { clippingEnabled: boolean }) => mesh.clippingEnabled)).toBe(true)).toPass();
  const priorView = await inspect();
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected part PNG", exact: true }).click();
  const part = await inspectPngDownload(page, await download, info.outputPath("part.png"));
  expect(part.pixels.foreground / part.pixels.opaque).toBeGreaterThan(0.05);
  const afterView = await inspect();
  afterView.cameraPosition.forEach((value: number, index: number) => expect(value).toBeCloseTo(priorView.cameraPosition[index], 9));
  expect(afterView.cameraTarget).toEqual(priorView.cameraTarget);
  expect(afterView.meshes).toEqual(priorView.meshes);
  expect(afterView.sectionPlane).toEqual(priorView.sectionPlane);
  await page.evaluate(async (id) => { const sp = "/src/state/useCadStore.ts", cp = "/src/ui/commands/sketchCanvasCommand.ts"; const state = (await import(sp)).useCadStore.getState(); state.select({ kind: "sketch", id, documentId: state.history.present.id }); (await import(cp)).beginSketchCanvas(id); }, sketchId);
  const svg = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  await expect(svg.locator(".canvas-dimensions text")).toContainText(["R 10.0000 mm"]);
  download = page.waitForEvent("download");
  // The sketch workspace and the full ribbon both expose this command.
  await page.getByRole("button", { name: "Download sketch PNG", exact: true }).last().click();
  const drawing = await inspectPngDownload(page, await download, info.outputPath("sketch-dimensions.png"));
  await page.getByLabel("Show drawing dimensions", { exact: true }).uncheck();
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sketch PNG", exact: true }).last().click();
  const plain = await inspectPngDownload(page, await download, info.outputPath("sketch-plain.png"));
  expect(drawing.bytes.equals(plain.bytes)).toBe(false);
  expect(drawing.pixels.foreground).toBeGreaterThan(plain.pixels.foreground);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(before.document);
  expect(after.past).toBe(before.past);
  expect(after.result).toEqual(before.result);
  expect(errors).toEqual([]);
});

test("ORBIT opens without used sketch dots and exports clean PNG pixels even when overlays are explicitly shown", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const file = "docs/examples/orbit-drive-housing.pcaddoc";
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.document.name).toBe("ORBIT drive housing");
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(272452.36918433453, 4);
  }).toPass();
  const inspect = () => page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
  await expect.poll(async () => (await inspect()).sketchPoints.length).toBe(0);
  await expect.poll(async () => (await inspect()).sketchCircles.length).toBe(0);
  await expect(page.getByRole("checkbox", { name: /^Show sketch .* in 3D$/ }).first()).not.toBeChecked();
  const capture = async (name: string) => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download project view PNG", exact: true }).click();
    return inspectPngDownload(page, await download, info.outputPath(name));
  };
  const clean = await capture("orbit-clean.png");
  const original = await aiSnapshot(page);
  await page.getByRole("button", { name: "Show all components", exact: true }).click();
  await expect.poll(async () => (await inspect()).sketchPoints.length).toBeGreaterThan(50);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", state = (await import(path)).useCadStore.getState();
    state.select({ kind: "body", id: state.rebuild.result.bodies[0].id, documentId: state.history.present.id });
  });
  const beforeCapture = await inspect();
  const shown = await capture("orbit-overlays-omitted.png");
  // Identical pixels prove the real WebGL capture excludes both sketch dots/lines
  // and body selection, while retaining the same solid, camera and grid.
  expect(shown.bytes.equals(clean.bytes)).toBe(true);
  const afterCapture = await inspect();
  afterCapture.cameraPosition.forEach((value: number, index: number) => expect(value).toBeCloseTo(beforeCapture.cameraPosition[index], 9));
  expect(afterCapture.cameraTarget).toEqual(beforeCapture.cameraTarget);
  expect(afterCapture.sketchPoints).toEqual(beforeCapture.sketchPoints);
  expect(afterCapture.meshes).toEqual(beforeCapture.meshes);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(original.document);
  expect(after.past).toBe(original.past);
  expect(after.result).toEqual(original.result);
  const session = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().documentSession;
  });
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().documentSession;
  })).toBe(session + 1);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect.poll(async () => (await inspect()).sketchPoints.length).toBe(0);
  await page.screenshot({ path: info.outputPath("orbit-open-clean.png"), fullPage: true });
});
