import { expect, test, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import { applyModeling } from "./modelingWorkflow";
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
    .getByRole("button", { name: "Revolve selected sketch", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Revolve", exact: true });
}
test("Revolve previews a construction-axis torus, diagnoses axis/angle errors, cancels, and saves only the latest native quarter sweep", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  const lineId = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts";
    const { useCadStore } = await import(storePath),
      { createXySketch, addCircleAt, addPoint, addLine, setConstruction } =
        await import(modelPath),
      { upsertSketch } = await import(docPath);
    const circle = addCircleAt(
        createXySketch("Torus section"),
        "10mm",
        "0mm",
        "2mm",
      ),
      a = addPoint(circle, "5mm", "-5mm"),
      b = addPoint(a.sketch, "5mm", "5mm"),
      line = addLine(b.sketch, a.pointId, b.pointId);
    useCadStore
      .getState()
      .updateDocument((doc: CadDocument) =>
        upsertSketch(doc, setConstruction(line.sketch, line.lineId, true)),
      );
    useCadStore
      .getState()
      .select({
        kind: "sketch",
        id: circle.id,
        documentId: useCadStore.getState().history.present.id,
      });
    return line.lineId;
  });
  await ready(page);
  const before = await snapshot(page);
  let dialog = await open(page);
  await expect(dialog.getByLabel("Rotation axis", { exact: true })).toHaveValue(
    `line:${lineId}`,
  );
  await expect(dialog.getByRole("status")).toContainText(
    `${(40 * Math.PI ** 2).toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open(page);
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("361deg");
  await expect(dialog.getByRole("alert")).toContainText("360");
  await expect(
    dialog.getByRole("button", { name: "Apply revolve" }),
  ).toBeDisabled();
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("90deg");
  await dialog
    .getByLabel("Rotation axis", { exact: true })
    .selectOption("origin:X");
  await expect(dialog.getByRole("alert")).toContainText("must not cross");
  await dialog
    .getByLabel("Rotation axis", { exact: true })
    .selectOption(`line:${lineId}`);
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("180deg");
  await dialog.getByLabel("Revolve angle", { exact: true }).fill("90deg");
  await expect(dialog.getByRole("status")).toContainText(
    `${(10 * Math.PI ** 2).toFixed(3)} mm³`,
  );
  await applyModeling(page, "Revolve");
  await ready(page);
  let current = await snapshot(page),
    mesh = current.result.meshes[0];
  expect(current.past).toBe(before.past + 1);
  expect(current.document.features).toHaveLength(1);
  expect(current.document.features[0]).toMatchObject({
    type: "revolve",
    angle: { expression: "90deg" },
    axis: { type: "sketchLine", lineId },
  });
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(10 * Math.PI ** 2, 7);
  for (const [axis, min, max] of [
    [0, 5, 12],
    [1, -2, 2],
    [2, -7, 0],
  ]) {
    expect(Math.abs(mesh.bounds.min[axis] - min)).toBeLessThan(0.01);
    expect(Math.abs(mesh.bounds.max[axis] - max)).toBeLessThan(0.01);
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("revolve.pcaddoc");
  await (await download).saveAs(path);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(current.document.id);
  await ready(page);
  current = await snapshot(page);
  mesh = current.result.meshes[0];
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(10 * Math.PI ** 2, 7);
});
test("Revolve creation requires explicit native Cut/Join targets and preserves document state until Apply", async ({
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
      { createXySketch, addCornerRectangle } = await import(modelPath),
      { upsertSketch, upsertFeature, createExtrudeFeature } = await import(
        docPath
      ),
      { detectProfiles } = await import(profilePath),
      { solveSketch } = await import(solverPath);
    const base = addCornerRectangle(
        createXySketch("Base sketch"),
        "20mm",
        "20mm",
      ),
      tool = addCornerRectangle(createXySketch("Revolve tool"), "5mm", "10mm");
    useCadStore
      .getState()
      .updateDocument((doc: CadDocument) =>
        upsertSketch(
          upsertFeature(
            upsertSketch(doc, base),
            createExtrudeFeature({
              name: "Base",
              sketchId: base.id,
              profileId: detectProfiles(solveSketch(base, {})).profiles[0].id,
              operation: "newBody",
              direction: "positive",
              distance: { expression: "10mm", unit: "mm" },
            }),
          ),
          tool,
        ),
      );
    useCadStore
      .getState()
      .select({
        kind: "sketch",
        id: tool.id,
        documentId: useCadStore.getState().history.present.id,
      });
  });
  await ready(page);
  const before = await snapshot(page);
  let dialog = await open(page);
  await dialog
    .getByLabel("Revolve operation", { exact: true })
    .selectOption("join");
  await expect(dialog.getByRole("status")).toContainText(
    "Choose at least one target",
  );
  await dialog.getByLabel("Base", { exact: true }).check();
  await expect(dialog.getByRole("status")).toContainText(
    `${(4000 + 187.5 * Math.PI).toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  dialog = await open(page);
  await dialog
    .getByLabel("Revolve operation", { exact: true })
    .selectOption("cut");
  await dialog.getByLabel("Base", { exact: true }).check();
  await expect(dialog.getByRole("status")).toContainText(
    `${(4000 - 62.5 * Math.PI).toFixed(3)} mm³`,
  );
  await applyModeling(page, "Revolve");
  await ready(page);
  const current = await snapshot(page),
    mesh = current.result.meshes[0];
  expect(mesh.bodyId).toBe(before.result.meshes[0].bodyId);
  expect(mesh.kernelOperation).toBe("cut");
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(4000 - 62.5 * Math.PI, 7);
  expect(current.document.features[1]).toMatchObject({
    type: "revolve",
    operation: "cut",
    targetBodyIds: [mesh.bodyId],
  });
});
