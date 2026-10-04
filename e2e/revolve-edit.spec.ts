import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
test("Edit Revolve previews a parameter-bound cylinder beneath a Cut, rejects axis/angle errors, cancels, and preserves native quarter-sweep geometry through undo/save/open/STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const id = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts";
    const { useCadStore } = await import(storePath),
      docs = await import(docPath),
      model = await import(modelPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath);
    let document = docs.createEmptyDocument("Edit revolve");
    document = {
      ...document,
      parameters: {
        sweep: {
          id: "parameter_sweep",
          name: "sweep",
          expression: "360deg",
          unit: "deg",
          value: 360,
        },
      },
    };
    const section = model.addCornerRectangle(
      model.createSketchOnPlane("Cylinder section", "XY"),
      "5mm",
      "10mm",
    );
    document = docs.upsertSketch(document, section);
    const revolve = {
      id: "feature_cylinder",
      name: "Cylinder",
      type: "revolve",
      sketchId: section.id,
      profileId: detectProfiles(solveSketch(section, {})).profiles[0].id,
      axis: { type: "origin", axis: "Y" },
      operation: "newBody",
      angle: { expression: "sweep", unit: "deg" },
    };
    document = docs.upsertFeature(document, revolve);
    const tool = model.addCircleAt(
      model.createSketchOnPlane("Bore section", "XZ"),
      "0mm",
      "0mm",
      "2mm",
    );
    document = docs.upsertSketch(document, tool);
    document = docs.upsertFeature(
      document,
      docs.createExtrudeFeature({
        name: "Bore",
        sketchId: tool.id,
        profileId: detectProfiles(solveSketch(tool, {})).profiles[0].id,
        operation: "cut",
        direction: "negative",
        distance: { expression: "1mm", unit: "mm" },
        termination: { type: "throughAll" },
        targetBodyIds: [`body:${revolve.id}`],
      }),
    );
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: revolve.id, documentId: document.id });
    return revolve.id;
  });
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(210 * Math.PI, 5);
  const before = await snapshot(page),
    volume = 52.5 * Math.PI;
  const open = async () => {
    await page
      .locator(".timeline-actions")
      .getByRole("button", { name: "Edit Feature", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Edit Revolve", exact: true });
  };
  let dialog = await open();
  await expect(dialog.getByLabel("Revolve angle", { exact: true })).toHaveValue(
    "sweep",
  );
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("90deg");
  await expect(dialog.getByRole("status")).toContainText(
    `${volume.toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open();
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("361deg");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply revolve" }),
  ).toBeDisabled();
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("90deg");
  await dialog
    .getByLabel("Revolve axis", { exact: true })
    .selectOption("origin:Z");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply revolve" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Revolve axis", { exact: true })
    .selectOption("origin:Y");
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("180deg");
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("90deg");
  await expect(dialog.getByRole("status")).toContainText(
    `${volume.toFixed(3)} mm³`,
  );
  await dialog.getByRole("button", { name: "Apply revolve" }).click();
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
    bodyId: `body:${id}`,
    geometrySource: "opencascade",
    kernelOperation: "cut",
    geometryAssertions: { valid: true, solidCount: 1 },
  });
  for (const [axis, expected] of [0, 0, -5].entries())
    expect(state.result.meshes[0].bounds.min[axis]).toBeCloseTo(expected, 5);
  expect(state.result.meshes[0].bounds.max[0]).toBeCloseTo(5, 5);
  expect(state.result.meshes[0].bounds.max[1]).toBeCloseTo(10, 5);
  expect(state.result.meshes[0].bounds.max[2]).toBeCloseTo(0, 5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(210 * Math.PI, 5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  // A failed first modeling operation publishes no body; repair still starts
  // from a fresh native upstream sketch stage rather than requiring its old mesh.
  await page.locator(".feature-chip").filter({ hasText: "Cylinder" }).click();
  await page.getByLabel("Angle", { exact: true }).fill("361deg");
  await page.getByLabel("Angle", { exact: true }).press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  await expect(
    page
      .locator(".timeline-actions")
      .getByRole("button", { name: "Edit Feature", exact: true }),
  ).toBeEnabled();
  dialog = await open();
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("90deg");
  await expect(dialog.getByRole("status")).toContainText(
    `${volume.toFixed(3)} mm³`,
  );
  await dialog.getByRole("button", { name: "Apply revolve" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("edited-revolve.pcaddoc");
  await (await save).saveAs(path);
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
  expect(state.document.features[0].id).toBe(id);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("quarter-bore.stl");
  await (await download).saveAs(stl);
  const bytes = await readFile(stl),
    triangles = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + triangles * 50);
  let signedVolume = 0;
  for (let i = 0; i < triangles; i++) {
    const start = 84 + i * 50 + 12;
    const a = [0, 1, 2].map((axis) => bytes.readFloatLE(start + axis * 4));
    const b = [0, 1, 2].map((axis) => bytes.readFloatLE(start + 12 + axis * 4));
    const c = [0, 1, 2].map((axis) => bytes.readFloatLE(start + 24 + axis * 4));
    signedVolume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  expect(signedVolume).toBeGreaterThan(0);
  expect(Math.abs(signedVolume - volume) / volume).toBeLessThan(0.01);
});
