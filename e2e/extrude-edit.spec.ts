import { test, expect, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function snapshot(page: Page): Promise<{
  document: CadDocument;
  result: RebuildResult;
  past: number;
  session: number;
}> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      past: state.history.past.length,
      session: state.documentSession,
    };
  });
}
test("Edit Extrude verifies native replacement and downstream Cut, cancels, rejects invalid downstream geometry, and preserves identity through undo/save/open/STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const baseId = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      sketchPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts";
    const { useCadStore } = await import(storePath),
      docs = await import(docPath),
      model = await import(sketchPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath);
    let document = docs.createEmptyDocument("Edit extrusion");
    document = {
      ...document,
      parameters: {
        depth: {
          id: "parameter_depth",
          name: "depth",
          expression: "10mm",
          value: 10,
          unit: "mm",
        },
      },
    };
    const sketch = model.addCornerRectangle(
      model.createSketchOnPlane("Base sketch", "XZ"),
      "20mm",
      "10mm",
    );
    document = docs.upsertSketch(document, sketch);
    const base = docs.createExtrudeFeature({
      name: "Base",
      sketchId: sketch.id,
      profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
      operation: "newBody",
      distance: { expression: "depth", unit: "mm" },
      direction: "positive",
      termination: { type: "distance" },
    });
    document = docs.upsertFeature(document, base);
    const tool = model.addCircleAt(
      model.createSketchOnPlane("Drill profile", "XZ"),
      "5mm",
      "5mm",
      "2mm",
    );
    document = docs.upsertSketch(document, tool);
    document = docs.upsertFeature(
      document,
      docs.createExtrudeFeature({
        name: "Drill",
        sketchId: tool.id,
        profileId: detectProfiles(solveSketch(tool, {})).profiles[0].id,
        operation: "cut",
        distance: { expression: "1mm", unit: "mm" },
        direction: "positive",
        termination: { type: "throughAll" },
        targetBodyIds: [`body:${base.id}`],
      }),
    );
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: base.id, documentId: document.id });
    return base.id;
  });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const before = await snapshot(page);
  const open = async () => {
    await page
      .locator(".timeline-actions")
      .getByRole("button", { name: "Edit Feature", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Edit Extrude", exact: true });
  };
  let dialog = await open();
  await expect(
    dialog.getByLabel("Extrude distance", { exact: true }),
  ).toHaveValue("depth");
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("20mm");
  const volume = (200 - 4 * Math.PI) * 20;
  await expect(dialog.getByRole("status")).toContainText(
    `${volume.toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open();
  await dialog
    .getByLabel("Extrude direction", { exact: true })
    .selectOption("negative");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  expect((await snapshot(page)).document).toEqual(before.document);
  await dialog
    .getByLabel("Extrude direction", { exact: true })
    .selectOption("positive");
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("30mm");
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("20mm");
  await expect(dialog.getByRole("status")).toContainText(
    `${volume.toFixed(3)} mm³`,
  );
  await dialog.getByRole("button", { name: "Apply extrusion" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  let state = await snapshot(page);
  expect(state.past).toBe(before.past + 1);
  expect(
    state.document.features.map((feature) => [
      feature.id,
      feature.timelineStep,
    ]),
  ).toEqual(
    before.document.features.map((feature) => [
      feature.id,
      feature.timelineStep,
    ]),
  );
  expect(state.result.meshes[0]).toMatchObject({
    bodyId: `body:${baseId}`,
    geometrySource: "opencascade",
    kernelOperation: "cut",
    geometryAssertions: { valid: true, solidCount: 1 },
  });
  expect(state.result.meshes[0].bounds.min[1]).toBeCloseTo(-20, 5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume / 2, 5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("edited-extrusion.pcaddoc");
  await (await download).saveAs(path);
  const session = (await snapshot(page)).session;
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).session)
    .toBeGreaterThan(session);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  state = await snapshot(page);
  expect(state.document.features[0].id).toBe(baseId);
  const stl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  expect((await stl).suggestedFilename()).toMatch(/\.stl$/);
});
