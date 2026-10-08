import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";

test("timeline build story shows native before/after solids and discards obsolete previews without editing the project", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.evaluate(async () => {
    const tp = "/src/templates/templates.ts", sp = "/src/state/useCadStore.ts", dp = "/src/cad/document/CadDocument.ts", sm = "/src/cad/sketch/SketchModel.ts";
    const { upsertFeature, upsertSketch, createExtrudeFeature } = await import(dp);
    const { addCircleAt, createXySketch } = await import(sm);
    let document = (await import(tp)).createBoxTemplate();
    let sketch = createXySketch("Bore location"); sketch = addCircleAt(sketch, "20mm", "-10mm", "5mm"); document = upsertSketch(document, sketch);
    const circle = (Object.values(sketch.entities) as Array<{ id: string; type: string }>).find(entity => entity.type === "circle")!;
    document = upsertFeature(document, createExtrudeFeature({ name: "Shaft bore", sketchId: sketch.id, profileId: `${sketch.id}:profile:${circle.id}`, operation: "cut", distance: { expression: "20mm", unit: "mm" }, direction: "positive", targetBodyIds: [`body:${document.features[0].id}`] }));
    (await import(sp)).useCadStore.getState().setDocument(document);
  });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const before = await aiSnapshot(page);
  expect(before.result?.meshes[0].geometrySource).toBe("opencascade");
  const initialVolume = before.result!.meshes[0].geometryAssertions!.volume;
  expect(initialVolume).toBeCloseTo(80000 - Math.PI * 25 * 20, 2);
  const positions = before.result!.meshes[0].positions;
  let boreVertices = 0;
  for (let index = 0; index < positions.length; index += 3) if (Math.abs(Math.hypot(positions[index] - 20, positions[index + 1] + 10) - 5) < 0.001) boreVertices++;
  expect(boreVertices).toBeGreaterThan(20);
  const viewer = await page.evaluate(async () => { const vp = "/src/viewer/viewerDiagnostics.ts"; return (await import(vp)).inspectViewer(); });
  const history = page.getByRole("button", { name: "History", exact: true }); if (await history.isVisible()) await history.click();
  const chip = page.getByRole("button", { name: /Shaft bore/ });
  await chip.focus();
  const story = page.getByLabel("Build story: Shaft bore", { exact: true });
  await expect(story).toHaveAttribute("data-native", "true", { timeout: 40000 });
  expect(Number(await story.getAttribute("data-before-volume"))).toBeCloseTo(80000, 2);
  expect(Number(await story.getAttribute("data-after-volume"))).toBeCloseTo(initialVolume, 2);
  await expect(story).toContainText("1 changed part in cyan");
  const images = await story.getByRole("img").evaluateAll(nodes => nodes.map(node => ({ source: (node as HTMLImageElement).src, width: (node as HTMLImageElement).naturalWidth })));
  expect(images).toHaveLength(2); expect(images.every(image => image.width === 208)).toBe(true); expect(images[0].source).not.toBe(images[1].source);
  await page.screenshot({ path: "test-results/timeline-story-native-isometric.png" });
  const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.past).toBe(before.past); expect(after.result).toEqual(before.result);
  const camera = await page.evaluate(async () => { const vp = "/src/viewer/viewerDiagnostics.ts"; const snapshot = (await import(vp)).inspectViewer(); return { position: snapshot?.cameraPosition, target: snapshot?.cameraTarget, up: snapshot?.cameraUp }; });
  for (const [actual, expected] of [[camera.position, viewer?.cameraPosition], [camera.target, viewer?.cameraTarget], [camera.up, viewer?.cameraUp]]) { expect(actual).toHaveLength(3); actual!.forEach((value: number, index: number) => expect(value).toBeCloseTo(expected![index], 8)); }
  await page.evaluate(async () => { const sp = "/src/state/useCadStore.ts"; (await import(sp)).useCadStore.getState().updateParameter("depth", { expression: "25mm" }); });
  await expect(story).toHaveAttribute("data-native", "false");
  await expect(story).toHaveAttribute("data-native", "true", { timeout: 40000 });
  expect(Number(await story.getAttribute("data-before-volume"))).toBeCloseTo(100000, 2);
  await page.screenshot({ path: "test-results/timeline-story.png" });
  expect(errors).toEqual([]);
});
