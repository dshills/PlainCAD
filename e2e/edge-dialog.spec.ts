import { expect, test, type Page } from "@playwright/test";
import type { ResolvedSketch } from "../src/cad/sketch/SketchSolver";
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
async function open(page: Page, name: "Fillet" | "Chamfer") {
  await page
    .getByRole("button", { name: `${name} extrusion edges`, exact: true })
    .click();
  return page.getByRole("dialog", { name, exact: true });
}
test("native edge drafts cancel cleanly, reject invalid/changed edges, and apply three exact XZ treatments with stable owners and save/open", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  const ids = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts",
      solverPath = "/src/cad/sketch/SketchSolver.ts";
    const { useCadStore } = await import(storePath),
      { createSketchOnPlane, addCornerRectangle } = await import(modelPath),
      { upsertSketch, upsertFeature, createExtrudeFeature } = await import(
        docPath
      ),
      { detectProfiles } = await import(profilePath),
      { solveSketch } = await import(solverPath);
    const sketch = addCornerRectangle(
        createSketchOnPlane("Edge section", "XZ"),
        "20mm",
        "10mm",
      ),
      solved = solveSketch(sketch, {}) as ResolvedSketch;
    const feature = createExtrudeFeature({
      name: "Base",
      sketchId: sketch.id,
      profileId: detectProfiles(solved).profiles[0].id,
      operation: "newBody",
      direction: "positive",
      distance: { expression: "10mm", unit: "mm" },
    });
    useCadStore
      .getState()
      .updateDocument((doc: CadDocument) =>
        upsertFeature(upsertSketch(doc, sketch), feature),
      );
    useCadStore.getState().select({
      kind: "feature",
      id: feature.id,
      documentId: useCadStore.getState().history.present.id,
    });
    return {
      owner: feature.id,
      front: solved.lines.find(
        (line) => line.start.y === 0 && line.end.y === 0,
      )!.id,
      back: solved.lines.find(
        (line) => line.start.y === 10 && line.end.y === 10,
      )!.id,
    };
  });
  await ready(page);
  const before = await snapshot(page),
    corner = 1 - Math.PI / 4;
  let dialog = await open(page, "Fillet");
  await dialog
    .getByLabel("Source edge", { exact: true })
    .selectOption(ids.front);
  await expect(dialog.getByRole("status")).toContainText(
    `${(2000 - 20 * corner).toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open(page, "Fillet");
  await dialog
    .getByLabel("Source edge", { exact: true })
    .selectOption(ids.front);
  await dialog.getByLabel("Fillet radius", { exact: true }).fill("100mm");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply fillet" }),
  ).toBeDisabled();
  await dialog.getByLabel("Fillet radius", { exact: true }).fill("2mm");
  await dialog.getByLabel("Fillet radius", { exact: true }).fill("1mm");
  await expect(dialog.getByRole("status")).toContainText(
    `${(2000 - 20 * corner).toFixed(3)} mm³`,
  );
  await applyModeling(page, "Fillet");
  await ready(page);
  let current = await snapshot(page);
  expect(current.past).toBe(before.past + 1);
  expect(current.result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - 20 * corner,
    7,
  );
  dialog = await open(page, "Chamfer");
  await dialog
    .getByLabel("Source edge", { exact: true })
    .selectOption(ids.front);
  await dialog.getByLabel("Chamfer distance", { exact: true }).fill("0.5mm");
  await expect(dialog.getByRole("status")).toContainText(
    `${(2000 - 20 * corner - 2.5).toFixed(3)} mm³`,
  );
  await applyModeling(page, "Chamfer");
  await ready(page);
  // Both cap roles have been used, but an untouched source edge remains eligible.
  await expect(
    page.getByRole("button", { name: "Fillet extrusion edges", exact: true }),
  ).toBeEnabled();
  dialog = await open(page, "Fillet");
  await expect(dialog.getByRole("alert")).toContainText("lost");
  await expect(
    dialog.getByRole("button", { name: "Apply fillet" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Source edge", { exact: true })
    .selectOption(ids.back);
  await dialog.getByLabel("Fillet radius", { exact: true }).fill("0.5mm");
  const expected = 2000 - 25 * corner - 2.5;
  await expect(dialog.getByRole("status")).toContainText(
    `${expected.toFixed(3)} mm³`,
  );
  await applyModeling(page, "Fillet");
  await ready(page);
  current = await snapshot(page);
  const mesh = current.result.meshes[0];
  expect(current.past).toBe(before.past + 3);
  expect(mesh.bodyId).toBe(`body:${ids.owner}`);
  expect(mesh.kernelOperation).toBe("fillet");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(expected, 7);
  expect(mesh.bounds.min[1]).toBeCloseTo(-10, 6);
  expect(mesh.bounds.max[1]).toBeCloseTo(0, 6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("edge-drafts.pcaddoc");
  await (await download).saveAs(path);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(current.document.id);
  await ready(page);
  expect(
    (await snapshot(page)).result.meshes[0].geometryAssertions!.volume,
  ).toBeCloseTo(expected, 7);
});
