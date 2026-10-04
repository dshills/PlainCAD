import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
async function ready(page: Page) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}
async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; result: RebuildResult; past: number }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path),
      state = useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      past: state.history.past.length,
    };
  });
}
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}
function signedStlVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * count);
  expect(count).toBeGreaterThanOrEqual(12);
  let volume = 0;
  for (let i = 0; i < count; i++) {
    const values = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + i * 50 + j * 4),
    );
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = values;
    volume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return volume;
}
test("individual sketch hiding filters real viewer overlays while native editing, history, save/open and STL stay intact", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts",
      solverPath = "/src/cad/sketch/SketchSolver.ts";
    const { useCadStore } = await import(storePath),
      { createXySketch, addCornerRectangle, addPoint } = await import(
        modelPath
      ),
      {
        createEmptyDocument,
        upsertSketch,
        upsertFeature,
        createExtrudeFeature,
      } = await import(docPath),
      { detectProfiles } = await import(profilePath),
      { solveSketch } = await import(solverPath);
    const outline = addCornerRectangle(
        createXySketch("Outline"),
        "20mm",
        "10mm",
      ),
      guide = addPoint(createXySketch("Guide"), "50mm", "0mm").sketch;
    const document = upsertSketch(
      upsertFeature(
        upsertSketch(createEmptyDocument("Sketch visibility"), outline),
        createExtrudeFeature({
          name: "Solid",
          sketchId: outline.id,
          profileId: detectProfiles(solveSketch(outline, {})).profiles[0].id,
          direction: "positive",
          operation: "newBody",
          distance: { expression: "10mm", unit: "mm" },
        }),
      ),
      guide,
    );
    useCadStore.getState().setDocument(document);
  });
  await ready(page);
  const before = await snapshot(page);
  expect(before.result.meshes[0].geometrySource).toBe("opencascade");
  expect(before.result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000,
    7,
  );
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(5);
  await page.getByLabel("Show sketch Outline in 3D", { exact: true }).uncheck();
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(1);
  expect((await viewer(page)).meshes[0].visible).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  await page
    .locator(".component-tree .sketch-browser-row .item-card")
    .filter({ hasText: "Outline" })
    .click();
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Sketch canvas", exact: true })
      .locator("[data-point-id]"),
  ).toHaveCount(4);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(1);
  expect(await snapshot(page)).toEqual(before);
  await page
    .locator(".timeline-chip.feature-chip")
    .filter({ hasText: "Solid" })
    .click();
  await page.getByLabel("Distance", { exact: true }).fill("20mm");
  await page.getByLabel("Distance", { exact: true }).press("Enter");
  await ready(page);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(4000, 7);
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(2000, 7);
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(1);
  await page
    .getByLabel("Show component Root Component", { exact: true })
    .uncheck();
  await expect(
    page.getByLabel("Show sketch Outline in 3D", { exact: true }),
  ).toBeDisabled();
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(0);
  await page
    .getByRole("button", { name: "Show all bodies", exact: true })
    .click();
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(1);
  await expect(
    page.getByLabel("Show sketch Outline in 3D", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Show all components", exact: true })
    .click();
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(5);
  await page.getByLabel("Show sketch Outline in 3D", { exact: true }).uncheck();
  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("visible-solid.stl");
  await (await exportDownload).saveAs(stlPath);
  expect(signedStlVolume(await readFile(stlPath))).toBeCloseTo(2000, 5);
  const current = await snapshot(page),
    download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("sketch-visibility.pcaddoc");
  await (await download).saveAs(path);
  expect(await readFile(path, "utf8")).not.toMatch(
    /hiddenSketchIds|hiddenComponentIds|hiddenBodyIds/,
  );
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(current.document.id);
  await ready(page);
  await expect(
    page.getByLabel("Show sketch Outline in 3D", { exact: true }),
  ).toBeChecked();
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(5);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(2000, 7);
});
