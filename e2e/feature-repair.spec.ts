import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; status: string; result: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      status: state.rebuild.status,
      result: state.rebuild.result,
    };
  });
}
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result.errors).toEqual([]);
    if (volume !== undefined) {
      const mesh = state.result.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 5);
    }
  }).toPass();
}

test("repair lost sketch/profile/body references, validated timeline moves, undo and save/open preserve native geometry", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  const fixture = await page.evaluate(async () => {
    const docPath = "/src/cad/document/CadDocument.ts",
      sketchPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts";
    const ops = await import(docPath),
      sketches = await import(sketchPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath);
    let document = ops.createEmptyDocument("Reference repair");
    const base = sketches.addCornerRectangle(
      sketches.createXySketch("Base section"),
      "20mm",
      "10mm",
    );
    document = ops.upsertSketch(document, base);
    const owner = ops.createExtrudeFeature({
      name: "Base solid",
      sketchId: base.id,
      profileId: detectProfiles(solveSketch(base, {})).profiles[0].id,
      operation: "newBody",
      distance: { expression: "10mm", unit: "mm" },
      direction: "positive",
    });
    document = ops.upsertFeature(document, owner);
    const spare = sketches.createXySketch("Independent sketch");
    document = ops.upsertSketch(document, spare);
    const cut = sketches.addCircleAt(
      sketches.createXySketch("Cut section"),
      "5mm",
      "5mm",
      "2mm",
    );
    document = ops.upsertSketch(document, cut);
    const feature = ops.createExtrudeFeature({
      name: "Repair cut",
      sketchId: "lost-sketch",
      profileId: "lost-profile",
      operation: "cut",
      targetBodyIds: ["body:missing"],
      distance: { expression: "10mm", unit: "mm" },
      termination: { type: "throughAll" },
      direction: "positive",
    });
    document = ops.upsertFeature(document, feature);
    return {
      document,
      ownerId: owner.id,
      featureId: feature.id,
      sketchId: cut.id,
      profileId: detectProfiles(solveSketch(cut, {})).profiles[0].id,
    };
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "lost.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture.document)),
  });
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(fixture.document.id);
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await page
    .getByRole("button", { name: /references a missing sketch/ })
    .click();
  await expect(page.getByLabel("Source sketch")).toHaveValue("lost-sketch");
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Source sketch").selectOption(fixture.sketchId);
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(
    page.getByRole("combobox", { name: "Profile", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Profile", exact: true }),
  ).toHaveValue("lost-profile");
  await expect(
    page.getByRole("combobox", { name: "Target body", exact: true }),
  ).toHaveValue("body:missing");
  await page
    .getByRole("combobox", { name: "Target body", exact: true })
    .selectOption(`body:${fixture.ownerId}`);
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(
    page.getByRole("combobox", { name: "Profile", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Profile", exact: true })
    .selectOption(fixture.profileId);
  const volume = 2000 - Math.PI * 4 * 10;
  await ready(page, volume);
  const repaired = await snapshot(page);
  expect(
    repaired.document.features.find((f) => f.id === fixture.featureId),
  ).toMatchObject({
    sketchId: fixture.sketchId,
    profileId: fixture.profileId,
    targetBodyIds: [`body:${fixture.ownerId}`],
  });
  expect(repaired.document.sketches[fixture.sketchId].entities).toEqual(
    fixture.document.sketches[fixture.sketchId].entities,
  );
  // Move the source sketch before an independent sketch, then move the feature across it.
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button", { name: /Cut section/ })
    .click();
  await page.getByRole("button", { name: "Move earlier", exact: true }).click();
  await ready(page, volume);
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button", { name: /Repair cut/ })
    .click();
  await page.getByRole("button", { name: "Move earlier", exact: true }).click();
  await ready(page, volume);
  await expect(
    page.getByRole("button", { name: "Move earlier", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Cannot move earlier:.*required sketch/),
  ).toBeVisible();
  const moved = await snapshot(page);
  expect(
    moved.document.features.find((f) => f.id === fixture.featureId)
      ?.timelineStep,
  ).toBe(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, volume);
  expect(
    (await snapshot(page)).document.features.find(
      (f) => f.id === fixture.featureId,
    )?.timelineStep,
  ).toBe(5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page, volume);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = info.outputPath("repaired.pcaddoc");
  await (await download).saveAs(file);
  const saved = JSON.parse(await readFile(file, "utf8"));
  expect(
    saved.features.find((f: { id: string }) => f.id === fixture.featureId)
      .timelineStep,
  ).toBe(4);
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(fixture.document.id);
  await ready(page, volume);
  const stl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlFile = info.outputPath("repaired.stl");
  await (await stl).saveAs(stlFile);
  const bytes = await readFile(stlFile);
  expect(bytes.readUInt32LE(80)).toBeGreaterThan(12);
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
  expect(errors).toEqual([]);
});
