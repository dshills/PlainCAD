import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

async function ready(page: Page) {
  await expect(async () => {
    const state = await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      const s = (await import(path)).useCadStore.getState();
      return {
        status: s.rebuild.status,
        result: s.rebuild.result,
        documentId: s.history.present.id,
      };
    });
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.documentId);
    expect(state.result?.success).toBe(true);
    expect(
      state.result?.meshes.every(
        (mesh: { geometrySource: string }) =>
          mesh.geometrySource === "opencascade",
      ),
    ).toBe(true);
  }).toPass({ timeout: 20000 });
}
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}
function stl(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * count);
  let volume = 0,
    minX = Infinity,
    maxX = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + i * 50 + j * 4),
    );
    minX = Math.min(minX, p[0], p[3], p[6]);
    maxX = Math.max(maxX, p[0], p[3], p[6]);
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return { volume, minX, maxX };
}
test("body visibility, visible fit/picking, explicit subset STL and selected native union", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      sketches = await import(kp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp);
    let doc = ops.createEmptyDocument("Body scope");
    for (const [i, x] of [0, 15, 100].entries()) {
      let sketch = sketches.addCornerRectangle(
        sketches.createXySketch(),
        "20mm",
        "10mm",
      );
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? {
                  ...e,
                  x: { ...e.x, expression: `(${e.x.expression}) + ${x}mm` },
                }
              : e,
          ]),
        ),
      };
      doc = ops.upsertSketch(doc, sketch);
      doc = ops.upsertFeature(
        doc,
        ops.createExtrudeFeature({
          name: ["First", "Second", "Far"][i],
          sketchId: sketch.id,
          profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
          operation: "newBody",
          direction: "positive",
          distance: { expression: "10mm", unit: "mm" },
        }),
      );
    }
    (await import(sp)).useCadStore.getState().setDocument(doc);
  });
  await ready(page);
  await expect(page.getByText("3 bodies", { exact: true })).toBeVisible();
  await page.getByLabel("Show body Far", { exact: true }).uncheck();
  await page.getByLabel("Show body Second", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  await expect
    .poll(async () => (await viewer(page)).cameraTarget)
    .toEqual([10, 5, 5]);
  expect((await viewer(page)).meshes.map((m) => m.visible)).toEqual([
    true,
    false,
    false,
  ]);
  await page.getByRole("button", { name: "First", exact: true }).click();
  await page.getByLabel("Show body First", { exact: true }).uncheck();
  const canvas = page.locator("canvas.viewer-canvas");
  await canvas.click({
    position: {
      x: (await canvas.boundingBox())!.width / 2,
      y: (await canvas.boundingBox())!.height / 2,
    },
  });
  await expect(
    page.getByRole("button", { name: "Export selected body", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Show all bodies", exact: true })
    .click();
  await expect
    .poll(async () => (await viewer(page)).meshes.every((m) => m.visible))
    .toBe(true);
  await page.getByLabel("Show body Far", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "STL export options" });
  await expect(
    panel.getByLabel("Export body Far", { exact: true }),
  ).toBeChecked();
  await panel
    .getByRole("button", { name: "Clear body selection", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Generate STL", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel("Export body Far", { exact: true }).check();
  let download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Generate STL", exact: true })
    .click();
  let path = info.outputPath("far.stl");
  await (await download).saveAs(path);
  expect(stl(await readFile(path))).toMatchObject({
    volume: expect.closeTo(2000, 5),
    minX: 100,
    maxX: 120,
  });
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  await panel
    .getByRole("button", { name: "Select visible bodies", exact: true })
    .click();
  await expect(
    panel.getByLabel("Export body Far", { exact: true }),
  ).not.toBeChecked();
  await panel.getByLabel("STL mode").selectOption("merged");
  download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Generate STL", exact: true })
    .click();
  path = info.outputPath("subset-union.stl");
  await (await download).saveAs(path);
  expect(stl(await readFile(path))).toMatchObject({
    volume: expect.closeTo(3500, 5),
    minX: 0,
    maxX: 35,
  });
  await page.getByRole("button", { name: "Far", exact: true }).click();
  download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export selected body", exact: true })
    .click();
  path = info.outputPath("selected.stl");
  await (await download).saveAs(path);
  expect(stl(await readFile(path))).toMatchObject({
    volume: expect.closeTo(2000, 5),
    minX: 100,
    maxX: 120,
  });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  path = info.outputPath("body-scope.pcaddoc");
  await (await download).saveAs(path);
  expect(await readFile(path, "utf8")).not.toMatch(
    /hiddenBodyIds|exportBodyIds|documentSession/,
  );
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  await page.evaluate(async () => {
    const p = "/src/state/useCadStore.ts";
    const s = (await import(p)).useCadStore.getState();
    s.setDocument(s.history.present as CadDocument);
  });
  await ready(page);
  await expect(panel.getByRole("alert")).toContainText("Project replaced");
  await expect(
    panel.getByRole("button", { name: "Generate STL", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Close export", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page);
  await expect
    .poll(async () => (await viewer(page)).meshes.every((m) => m.visible))
    .toBe(true);
});
