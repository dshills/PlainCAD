import { test, expect, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import { applyExtrusion } from "./extrudeWorkflow";

// Circle tool area × 1e-7 mm overshoot is 1.26e-6 mm³; allow 2e-6.
const VOLUME_TOLERANCE = 2e-6;

async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; result: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path),
      state = useCadStore.getState();
    return { document: state.history.present, result: state.rebuild.result };
  });
}
async function ready(page: Page) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}
async function seed(page: Page) {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts",
      solverPath = "/src/cad/sketch/SketchSolver.ts";
    const { useCadStore } = await import(storePath),
      { createSketchOnPlane, addCenterRectangle, addCircleAt } = await import(
        modelPath
      ),
      { upsertSketch, upsertFeature, createExtrudeFeature } = await import(
        docPath
      ),
      { detectProfiles } = await import(profilePath),
      { solveSketch } = await import(solverPath);
    const base = addCenterRectangle(
        createSketchOnPlane("Base sketch", "XZ"),
        "10mm",
        "10mm",
      ),
      tool = addCircleAt(
        createSketchOnPlane("Tool sketch", "XZ"),
        "0mm",
        "0mm",
        "2mm",
      );
    useCadStore.getState().updateDocument((doc: CadDocument) =>
      upsertSketch(
        upsertFeature(
          upsertSketch(doc, base),
          createExtrudeFeature({
            name: "Base",
            sketchId: base.id,
            profileId: detectProfiles(solveSketch(base, {})).profiles[0].id,
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
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Extrude", exact: true });
}

test("Through All creation rejects wrong-side targets and follows native XZ target depth through edits and save/open", async ({
  page,
}, info) => {
  const dialog = await seed(page),
    before = await snapshot(page);
  await expect(dialog.locator('option[value="throughAll"]')).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(
    dialog.getByLabel("Extrude profile", { exact: true }),
  ).toBeFocused();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("0mm");
  await dialog
    .getByLabel("Extrude operation", { exact: true })
    .selectOption("cut");
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("throughAll");
  await expect(dialog.getByRole("status")).toContainText(
    "Choose at least one target",
  );
  await dialog.getByLabel("Base", { exact: true }).check();
  await dialog
    .getByLabel("Extrude direction", { exact: true })
    .selectOption("negative");
  await expect(dialog.getByRole("alert")).toContainText(
    "negative extrusion direction",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
  await dialog
    .getByLabel("Extrude direction", { exact: true })
    .selectOption("positive");
  await expect(dialog.getByRole("status")).toContainText(
    `${(1000 - Math.PI * 4 * 10).toFixed(3)} mm³`,
  );
  await dialog.getByLabel("Extrude termination", { exact: true }).focus();
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("distance");
  await expect(
    dialog.getByLabel("Extrude termination", { exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("throughAll");
  await applyExtrusion(page);
  await ready(page);
  let current = await snapshot(page);
  expect(current.document.features[1]).toMatchObject({
    termination: { type: "throughAll" },
    targetBodyIds: [before.result.meshes[0].bodyId],
  });
  expect(current.result.meshes[0].geometryAssertions).toMatchObject({
    valid: true,
    solidCount: 1,
  });
  // Through All deliberately extends 1e-7 mm beyond the bounds; OCCT's
  // tolerance can retain that tiny overcut in its exact mass calculation.
  expect(
    Math.abs(
      current.result.meshes[0].geometryAssertions!.volume -
        (1000 - Math.PI * 4 * 10),
    ),
  ).toBeLessThan(VOLUME_TOLERANCE);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path);
    useCadStore.getState().updateDocument((doc: CadDocument) => ({
      ...doc,
      features: doc.features.map((f) =>
        f.type === "extrude" && f.name === "Base"
          ? { ...f, distance: { ...f.distance, expression: "25mm" } }
          : f,
      ),
    }));
  });
  await ready(page);
  current = await snapshot(page);
  expect(
    Math.abs(
      current.result.meshes[0].geometryAssertions!.volume -
        (2500 - Math.PI * 4 * 25),
    ),
  ).toBeLessThan(VOLUME_TOLERANCE);
  for (const [axis, min, max] of [
    [0, -5, 5],
    [1, -25, 0],
    [2, -5, 5],
  ]) {
    expect(
      Math.abs(current.result.meshes[0].bounds.min[axis] - min),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(current.result.meshes[0].bounds.max[axis] - max),
    ).toBeLessThan(1e-6);
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("through-all.pcaddoc");
  await (await download).saveAs(path);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(current.document.id);
  await ready(page);
  expect(
    Math.abs(
      (await snapshot(page)).result.meshes[0].geometryAssertions!.volume -
        (2500 - Math.PI * 4 * 25),
    ),
  ).toBeLessThan(VOLUME_TOLERANCE);
});

test("To Face creation requires a covering native face and follows its owner through XZ edits and save/open", async ({
  page,
}, info) => {
  let dialog = await seed(page);
  const before = await snapshot(page),
    owner = before.document.features[0];
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("0mm");
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("toFace");
  await expect(dialog.getByRole("status")).toContainText(
    "Choose a covering planar target face",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await expect(dialog.locator('option[value="negative"]')).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(dialog.locator('option[value="symmetric"]')).toHaveAttribute(
    "disabled",
    "",
  );
  await dialog
    .getByLabel("Extrude target face", { exact: true })
    .selectOption(`extrude:${owner.id}:startCap`);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Extrude target face", { exact: true })
    .selectOption(`extrude:${owner.id}:endCap`);
  await expect(dialog.getByRole("status")).toContainText(
    `${(1000 + Math.PI * 4 * 10).toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("toFace");
  await dialog
    .getByLabel("Extrude target face", { exact: true })
    .selectOption(`extrude:${owner.id}:endCap`);
  await applyExtrusion(page);
  await ready(page);
  let current = await snapshot(page),
    feature = current.document.features[1];
  expect(feature).toMatchObject({
    termination: {
      type: "toFace",
      faceRef: {
        featureId: owner.id,
        stableHint: `extrude:${owner.id}:endCap`,
      },
    },
  });
  const body = () =>
    current.result.meshes.find((mesh) => mesh.bodyId === `body:${feature.id}`)!;
  expect(body().geometryAssertions).toMatchObject({
    valid: true,
    solidCount: 1,
  });
  expect(body().geometryAssertions!.volume).toBeCloseTo(Math.PI * 4 * 10, 7);
  await page.locator(".timeline-chip.feature-chip").filter({ hasText: "Base" }).click();
  await page.getByLabel("Distance", { exact: true }).fill("25mm");
  await page.getByLabel("Distance", { exact: true }).press("Enter");
  await ready(page);
  current = await snapshot(page);
  expect(body().geometryAssertions!.volume).toBeCloseTo(Math.PI * 4 * 25, 7);
  expect(body().bounds.min[1]).toBeCloseTo(-25, 6);
  expect(body().bounds.max[1]).toBeCloseTo(0, 6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("to-face.pcaddoc");
  await (await download).saveAs(path);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(current.document.id);
  await ready(page);
  current = await snapshot(page);
  expect(body().geometryAssertions!.volume).toBeCloseTo(Math.PI * 4 * 25, 7);
});
