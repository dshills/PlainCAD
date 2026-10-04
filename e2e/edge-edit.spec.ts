import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { ResolvedSketch } from "../src/cad/sketch/SketchSolver";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function snapshot(
  page: Page,
): Promise<{
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
test("Edit Fillet/Chamfer preserves multiple authored refs, validates downstream geometry, cancels invalid settings and retains native volume through undo/save/open/STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const ids = await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts",
      refsPath = "/src/cad/features/topologyRefs.ts";
    const { useCadStore } = await import(storePath),
      docs = await import(docPath),
      model = await import(modelPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath),
      { createExtrudeEdgeRef } = await import(refsPath);
    let document = docs.createEmptyDocument("Edit edges");
    document = {
      ...document,
      parameters: {
        round: {
          id: "parameter_round",
          name: "round",
          expression: "1mm",
          unit: "mm",
          value: 1,
        },
      },
    };
    const sketch = model.addCornerRectangle(
      model.createSketchOnPlane("Edge section", "XZ"),
      "20mm",
      "10mm",
    );
    const solved = solveSketch(sketch, {}) as ResolvedSketch;
    document = docs.upsertSketch(document, sketch);
    const base = docs.createExtrudeFeature({
      name: "Base",
      sketchId: sketch.id,
      profileId: detectProfiles(solved).profiles[0].id,
      operation: "newBody",
      direction: "positive",
      distance: { expression: "10mm", unit: "mm" },
    });
    document = docs.upsertFeature(document, base);
    const front = solved.lines.find(
      (line) => line.start.y === 0 && line.end.y === 0,
    )!.id;
    const back = solved.lines.find(
      (line) => line.start.y === 10 && line.end.y === 10,
    )!.id;
    const fillet = {
      id: "feature_round",
      name: "Rounds",
      type: "fillet",
      radius: { expression: "round", unit: "mm" },
      targetEdgeRefs: [
        createExtrudeEdgeRef(base.id, "endCapPerimeter", front),
        createExtrudeEdgeRef(base.id, "endCapPerimeter", back),
      ],
    };
    document = docs.upsertFeature(document, fillet);
    const chamfer = {
      id: "feature_bevel",
      name: "Bevel",
      type: "chamfer",
      distance: { expression: "0.5mm", unit: "mm" },
      targetEdgeRefs: [
        createExtrudeEdgeRef(base.id, "startCapPerimeter", front),
      ],
    };
    document = docs.upsertFeature(document, chamfer);
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: fillet.id, documentId: document.id });
    return { owner: base.id, front, back };
  });
  const corner = 1 - Math.PI / 4;
  const initial = 2000 - 40 * corner - 2.5,
    rounded = 2000 - 10 * corner - 2.5,
    final = 2000 - 10 * corner - 10;
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(initial, 5);
  const before = await snapshot(page);
  const open = async (type: "Fillet" | "Chamfer") => {
    await page
      .locator(".timeline-actions")
      .getByRole("button", { name: "Edit Feature", exact: true })
      .click();
    return page.getByRole("dialog", { name: `Edit ${type}`, exact: true });
  };
  const settings = async (dialog: ReturnType<Page["getByRole"]>) => {
    await dialog.getByLabel("Fillet radius", { exact: true }).fill("0.5mm");
    await dialog
      .getByLabel("Edge reference", { exact: true })
      .selectOption("1");
    await expect(dialog.getByLabel("Source edge", { exact: true })).toHaveValue(
      ids.back,
    );
    await dialog
      .getByLabel("Edge role", { exact: true })
      .selectOption("startCapPerimeter");
    await expect(dialog.getByLabel("Source edge", { exact: true })).toHaveValue(
      ids.back,
    );
  };
  let dialog = await open("Fillet");
  await settings(dialog);
  await expect(dialog.getByRole("status")).toContainText(
    `${rounded.toFixed(3)} mm³`,
  );
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open("Fillet");
  await dialog.getByLabel("Fillet radius", { exact: true }).fill("100mm");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply fillet" }),
  ).toBeDisabled();
  expect((await snapshot(page)).document).toEqual(before.document);
  await settings(dialog);
  await expect(dialog.getByRole("status")).toContainText(
    `${rounded.toFixed(3)} mm³`,
  );
  await dialog.getByRole("button", { name: "Apply fillet" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(rounded, 5);
  let state = await snapshot(page);
  expect(state.past).toBe(before.past + 1);
  const fillet = state.document.features.find(
    (feature) => feature.type === "fillet",
  )!;
  expect(fillet.targetEdgeRefs).toHaveLength(2);
  expect(fillet.targetEdgeRefs[0]).toEqual(
    before.document.features.find((feature) => feature.type === "fillet")!
      .targetEdgeRefs[0],
  );
  expect(fillet.targetEdgeRefs[1]).toMatchObject({
    role: "startCapPerimeter",
    sourceEntityId: ids.back,
  });
  await page.locator(".feature-chip").filter({ hasText: "Bevel" }).click();
  dialog = await open("Chamfer");
  await dialog.getByLabel("Chamfer distance", { exact: true }).fill("100mm");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply chamfer" }),
  ).toBeDisabled();
  await dialog.getByLabel("Chamfer distance", { exact: true }).fill("1mm");
  await expect(dialog.getByRole("status")).toContainText(
    `${final.toFixed(3)} mm³`,
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await snapshot(page)).document).toEqual(state.document);
  dialog = await open("Chamfer");
  await dialog.getByLabel("Chamfer distance", { exact: true }).fill("1mm");
  await expect(dialog.getByRole("status")).toContainText(
    `${final.toFixed(3)} mm³`,
  );
  await dialog.getByRole("button", { name: "Apply chamfer" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(final, 5);
  state = await snapshot(page);
  expect(state.past).toBe(before.past + 2);
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
    bodyId: `body:${ids.owner}`,
    geometrySource: "opencascade",
    kernelOperation: "chamfer",
    geometryAssertions: { valid: true, solidCount: 1 },
  });
  for (const [axis, value] of [0, -10, 0].entries())
    expect(state.result.meshes[0].bounds.min[axis]).toBeCloseTo(value, 5);
  for (const [axis, value] of [20, 0, 10].entries())
    expect(state.result.meshes[0].bounds.max[axis]).toBeCloseTo(value, 5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(rounded, 5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(final, 5);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("edited-edges.pcaddoc");
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
    .toBeCloseTo(final, 5);
  const stl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("edited-edges.stl");
  await (await stl).saveAs(stlPath);
  const bytes = await readFile(stlPath);
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
});
