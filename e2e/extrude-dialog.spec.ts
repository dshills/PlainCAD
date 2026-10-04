import { test, expect, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
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
async function ready(page: Page) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Extrude", exact: true });
}
async function previewReady(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeEnabled();
  await expect(
    dialog
      .getByRole("img", { name: "Native extrusion geometry preview" })
      .locator("canvas"),
  ).toBeVisible();
}
test("profile choice and negative XZ native preview cancel cleanly and apply only current settings", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts";
    const { useCadStore } = await import(storePath),
      { createSketchOnPlane, addCircleAt } = await import(modelPath),
      { upsertSketch } = await import(docPath);
    const sketch = addCircleAt(
      addCircleAt(
        createSketchOnPlane("Two circular profiles", "XZ"),
        "0mm",
        "0mm",
        "2mm",
      ),
      "15mm",
      "0mm",
      "3mm",
    );
    useCadStore
      .getState()
      .updateDocument((doc: CadDocument) => upsertSketch(doc, sketch));
    useCadStore.getState().select({
      kind: "sketch",
      id: sketch.id,
      documentId: useCadStore.getState().history.present.id,
    });
  });
  await ready(page);
  const before = await snapshot(page),
    sketchId = Object.keys(before.document.sketches)[0];
  const profile = before.result.profiles![sketchId].find(
    (profile) => profile.bounds.minX > 10,
  )!;
  let dialog = await open(page);
  await dialog
    .getByLabel("Extrude profile", { exact: true })
    .selectOption(profile.id);
  await dialog
    .getByLabel("Extrude direction", { exact: true })
    .selectOption("negative");
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("7mm");
  await previewReady(page);
  await expect(dialog.getByRole("status")).toContainText(
    `${(Math.PI * 9 * 7).toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open(page);
  await dialog
    .getByLabel("Extrude profile", { exact: true })
    .selectOption(profile.id);
  await dialog
    .getByLabel("Extrude direction", { exact: true })
    .selectOption("negative");
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("0mm");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("23mm");
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("7mm");
  await previewReady(page);
  await expect(dialog.getByRole("status")).toContainText(
    `${(Math.PI * 9 * 7).toFixed(3)} mm³`,
  );
  await page.screenshot({ path: info.outputPath("extrude-preview.png") });
  await dialog.getByRole("button", { name: "Apply extrusion" }).click();
  await ready(page);
  const after = await snapshot(page),
    mesh = after.result.meshes[0];
  expect(after.past).toBe(before.past + 1);
  expect(after.document.features).toHaveLength(1);
  expect(after.document.features[0]).toMatchObject({
    profileId: profile.id,
    direction: "negative",
    distance: { expression: "7mm" },
  });
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(Math.PI * 9 * 7, 7);
  // RenderMesh bounds come from tessellated circles (linear deflection), not analytic extrema.
  // Keep the sweep axis exact and bound circular tessellation error to 0.01 mm.
  for (const [axis, min, max] of [
    [0, 12, 18],
    [1, 0, 7],
    [2, -3, 3],
  ]) {
    expect(Math.abs(mesh.bounds.min[axis] - min)).toBeLessThan(
      axis === 1 ? 1e-6 : 0.01,
    );
    expect(Math.abs(mesh.bounds.max[axis] - max)).toBeLessThan(
      axis === 1 ? 1e-6 : 0.01,
    );
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  expect((await snapshot(page)).document.features).toHaveLength(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  expect(
    (await snapshot(page)).result.meshes[0].geometryAssertions!.volume,
  ).toBeCloseTo(Math.PI * 9 * 7, 7);
});
test("explicit join/cut targets preview exact volume and reject unchanged modeling", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts",
      solverPath = "/src/cad/sketch/SketchSolver.ts";
    const { useCadStore } = await import(storePath),
      { createXySketch, addCenterRectangle } = await import(modelPath),
      { upsertSketch, upsertFeature, createExtrudeFeature } = await import(
        docPath
      ),
      { detectProfiles } = await import(profilePath),
      { solveSketch } = await import(solverPath);
    const base = addCenterRectangle(createXySketch(), "10mm", "10mm"),
      tool = addCenterRectangle(createXySketch(), "5mm", "5mm"),
      profile = detectProfiles(solveSketch(base, {})).profiles[0];
    useCadStore.getState().updateDocument((doc: CadDocument) =>
      upsertSketch(
        upsertFeature(
          upsertSketch(doc, base),
          createExtrudeFeature({
            name: "Base",
            sketchId: base.id,
            profileId: profile.id,
            distance: { expression: "10mm", unit: "mm" },
            direction: "positive",
            operation: "newBody",
          }),
        ),
        tool,
      ),
    );
    useCadStore.getState().select({
      kind: "sketch",
      id: tool.id,
      documentId: useCadStore.getState().history.present.id,
    });
  });
  await ready(page);
  const before = await snapshot(page);
  let dialog = await open(page);
  await dialog
    .getByLabel("Extrude operation", { exact: true })
    .selectOption("join");
  await expect(dialog.getByRole("status")).toContainText(
    "Choose at least one target",
  );
  await dialog.getByLabel("Base", { exact: true }).check();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("12mm");
  await previewReady(page);
  await expect(dialog.getByRole("status")).toContainText("1050.000 mm³");
  await dialog.getByRole("button", { name: "Apply extrusion" }).click();
  await ready(page);
  expect(
    (await snapshot(page)).result.meshes[0].geometryAssertions!.volume,
  ).toBeCloseTo(1050, 7);
  const toolId = Object.keys(before.document.sketches)[1];
  await page.evaluate(
    async ({ toolId }) => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().select({
        kind: "sketch",
        id: toolId,
        documentId: useCadStore.getState().history.present.id,
      });
    },
    { toolId },
  );
  dialog = await open(page);
  await dialog
    .getByLabel("Extrude operation", { exact: true })
    .selectOption("cut");
  await dialog.getByLabel("Base", { exact: true }).check();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("12mm");
  await previewReady(page);
  await expect(dialog.getByRole("status")).toContainText("750.000 mm³");
  await dialog.getByRole("button", { name: "Apply extrusion" }).click();
  await ready(page);
  const cut = await snapshot(page);
  expect(cut.result.meshes).toHaveLength(1);
  expect(cut.result.meshes[0].kernelOperation).toBe("cut");
  expect(cut.result.meshes[0].geometryAssertions!.volume).toBeCloseTo(750, 7);
  expect(cut.document.features[2]).toMatchObject({
    operation: "cut",
    targetBodyIds: [before.result.meshes[0].bodyId],
  });
});
