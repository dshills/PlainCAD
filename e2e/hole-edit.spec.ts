import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(page: Page): Promise<{
  document: CadDocument;
  result?: RebuildResult;
  past: number;
  session: number;
  status: string;
}> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      past: state.history.past.length,
      session: state.documentSession,
      status: state.rebuild.status,
    };
  });
}
async function load(page: Page, downstream = true, lost = false) {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  return page.evaluate(
    async ({ downstream, lost }) => {
      const docPath = "/src/cad/document/CadDocument.ts",
        modelPath = "/src/cad/sketch/SketchModel.ts",
        solvePath = "/src/cad/sketch/SketchSolver.ts",
        profilesPath = "/src/cad/sketch/profileDetection.ts",
        storePath = "/src/state/useCadStore.ts",
        refsPath = "/src/cad/features/topologyRefs.ts";
      const docs = await import(docPath),
        model = await import(modelPath),
        { solveSketch } = await import(solvePath),
        { detectProfiles } = await import(profilesPath),
        { useCadStore } = await import(storePath),
        { createExtrudeEdgeRef } = await import(refsPath);
      let document = docs.upsertParameter(
        docs.createEmptyDocument("Hole editing"),
        {
          id: "parameter_drill",
          name: "drill",
          expression: "4mm",
          value: 4,
          unit: "mm",
        },
      );
      const section = model.addCornerRectangle(
          model.createSketchOnPlane("Base section", "XY"),
          "20mm",
          "10mm",
        ),
        solved = solveSketch(section, {});
      document = docs.upsertSketch(document, section);
      const base = docs.createExtrudeFeature({
        name: "Base",
        sketchId: section.id,
        profileId: detectProfiles(solved).profiles[0].id,
        operation: "newBody",
        distance: { expression: "10mm", unit: "mm" },
        direction: "positive",
      });
      document = docs.upsertFeature(document, base);
      const first = model.addPoint(
          model.createSketchOnPlane("Centers", "XY"),
          "5mm",
          "5mm",
        ),
        second = model.addPoint(first.sketch, "15mm", "5mm");
      document = docs.upsertSketch(document, second.sketch);
      const hole = {
        id: "feature_drill",
        name: "Drill",
        type: "hole",
        sketchId: lost ? "lost-sketch" : second.sketch.id,
        centerPointIds: lost
          ? ["lost-center"]
          : [first.pointId, second.pointId],
        targetBodyIds: [lost ? "body:lost" : `body:${base.id}`],
        diameter: { expression: "drill", unit: "mm" },
        depth: "throughAll",
      };
      document = docs.upsertFeature(document, hole);
      if (downstream) {
        const circle = model.addCircleAt(
          model.createSketchOnPlane("Counterbore section", "XY"),
          "5mm",
          "5mm",
          "3mm",
        );
        document = docs.upsertSketch(document, circle);
        document = docs.upsertFeature(
          document,
          docs.createExtrudeFeature({
            name: "Counterbore",
            sketchId: circle.id,
            profileId: detectProfiles(solveSketch(circle, {})).profiles[0].id,
            operation: "cut",
            targetBodyIds: [`body:${base.id}`],
            distance: { expression: "1mm", unit: "mm" },
            direction: "positive",
          }),
        );
        const front = solved.lines.find(
          (line: { start: { y: number }; end: { y: number } }) =>
            line.start.y === 0 && line.end.y === 0,
        )!.id;
        document = docs.upsertFeature(document, {
          id: "feature_bevel",
          name: "Bevel",
          type: "chamfer",
          distance: { expression: "0.5mm", unit: "mm" },
          targetEdgeRefs: [
            createExtrudeEdgeRef(base.id, "startCapPerimeter", front),
          ],
        });
      }
      useCadStore.getState().setDocument(document);
      useCadStore
        .getState()
        .select({ kind: "feature", id: hole.id, documentId: document.id });
      return {
        holeId: hole.id,
        bodyId: `body:${base.id}`,
        sketchId: second.sketch.id,
        first: first.pointId,
        second: second.pointId,
      };
    },
    { downstream, lost },
  );
}
async function ready(page: Page, volume: number, operation?: string) {
  await expect(async () => {
    const state = await snapshot(page),
      mesh = state.result?.meshes[0];
    expect(state.status).toBe("succeeded");
    expect(mesh).toMatchObject({
      geometrySource: "opencascade",
      geometryAssertions: { valid: true, solidCount: 1 },
    });
    expect(
      Math.abs(mesh!.geometryAssertions!.volume / volume - 1),
    ).toBeLessThan(1e-8);
    if (operation) expect(mesh!.kernelOperation).toBe(operation);
  }).toPass();
}
async function open(page: Page) {
  await page
    .locator(".timeline-actions")
    .getByRole("button", { name: "Edit Feature", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Edit Hole", exact: true });
}
test("Edit Hole verifies the operation and downstream chamfer, cancels, rejects no-op downstream cuts, and preserves native geometry/IDs through undo/save/open/STL", async ({
  page,
}, info) => {
  const ids = await load(page),
    initial = 2000 - 85 * Math.PI - 2.5,
    final = 2000 - 40.25 * Math.PI - 2.5;
  await ready(page, initial, "chamfer");
  const before = await snapshot(page);
  let dialog = await open(page);
  await expect(dialog.getByLabel("Hole diameter", { exact: true })).toHaveValue(
    "drill",
  );
  await expect(
    dialog.getByLabel("Hole center at 5.000, 5.000 mm", { exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByLabel("Hole center at 15.000, 5.000 mm", { exact: true }),
  ).toBeChecked();
  await dialog.getByLabel("Hole diameter", { exact: true }).fill("5mm");
  await expect(
    dialog.getByRole("status", { name: "Hole preview status" }),
  ).toContainText(`${(2000 - 127.75 * Math.PI - 2.5).toFixed(3)} mm³`);
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel hole" }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await open(page);
  await dialog.getByLabel("Hole diameter", { exact: true }).fill("8mm");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply hole edits" }),
  ).toBeDisabled();
  expect((await snapshot(page)).document).toEqual(before.document);
  await dialog.getByLabel("Hole diameter", { exact: true }).fill("5mm");
  await dialog
    .getByLabel("Hole termination", { exact: true })
    .selectOption("distance");
  await dialog.getByLabel("Hole depth", { exact: true }).fill("3mm");
  await expect(
    dialog.getByRole("status", { name: "Hole preview status" }),
  ).toContainText(`${final.toFixed(3)} mm³`);
  await dialog.getByRole("button", { name: "Apply hole edits" }).click();
  await ready(page, final, "chamfer");
  let after = await snapshot(page);
  expect(after.past).toBe(before.past + 1);
  expect(
    after.document.features.map((feature) => [
      feature.id,
      feature.timelineStep,
      feature.componentId,
    ]),
  ).toEqual(
    before.document.features.map((feature) => [
      feature.id,
      feature.timelineStep,
      feature.componentId,
    ]),
  );
  expect(
    after.document.features.find((feature) => feature.id === ids.holeId),
  ).toMatchObject({
    sketchId: ids.sketchId,
    centerPointIds: [ids.first, ids.second],
    targetBodyIds: [ids.bodyId],
    diameter: { expression: "5mm" },
    depth: { expression: "3mm" },
  });
  expect(after.result!.meshes[0].bodyId).toBe(ids.bodyId);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, initial, "chamfer");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page, final, "chamfer");
  const download = page.waitForEvent("download"),
    path = info.outputPath("edited-hole.pcaddoc");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await (await download).saveAs(path);
  const session = (await snapshot(page)).session;
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).session)
    .toBeGreaterThan(session);
  await ready(page, final, "chamfer");
  after = await snapshot(page);
  expect(
    after.document.features.find((feature) => feature.id === ids.holeId)?.id,
  ).toBe(ids.holeId);
  const exported = page.waitForEvent("download"),
    stl = info.outputPath("edited-hole.stl");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  await (await exported).saveAs(stl);
  const bytes = await readFile(stl),
    triangles = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + triangles * 50);
  let volume = 0;
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + i * 50 + 12;
    const a = [0, 1, 2].map((axis) => bytes.readFloatLE(offset + axis * 4)),
      b = [0, 1, 2].map((axis) => bytes.readFloatLE(offset + 12 + axis * 4)),
      c = [0, 1, 2].map((axis) => bytes.readFloatLE(offset + 24 + axis * 4));
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  expect(volume).toBeGreaterThan(0);
  expect(Math.abs(volume / final - 1)).toBeLessThan(0.01);
});
test("failed Hole references can be repaired against the native upstream stage; same-ID replacement rejects a pending edit", async ({
  page,
}) => {
  const ids = await load(page, false, true);
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  let dialog = await open(page);
  await expect(
    dialog.getByLabel("Lost hole center lost-center", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Hole source sketch", { exact: true })
    .selectOption(ids.sketchId);
  await expect(
    dialog.getByLabel("Include hole target Base Body", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Include hole target Lost target body:lost", { exact: true })
    .click();
  await expect(
    dialog.getByLabel("Include hole target Lost target body:lost", {
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Include hole target Base Body", { exact: true })
    .check();
  await dialog
    .getByLabel("Hole center at 5.000, 5.000 mm", { exact: true })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Apply hole edits" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply hole edits" }).click();
  const volume = 2000 - 40 * Math.PI;
  await ready(page, volume, "cut");
  const before = await snapshot(page);
  expect(
    before.document.features.find((feature) => feature.id === ids.holeId),
  ).toMatchObject({
    diameter: {
      expression: "drill",
      parameterRefs: { drill: "parameter_drill" },
    },
  });
  dialog = await open(page);
  await dialog.getByLabel("Hole diameter", { exact: true }).fill("6mm");
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      store = (await import(path)).useCadStore;
    store
      .getState()
      .setDocument(structuredClone(store.getState().history.present));
  });
  await expect(
    dialog.getByRole("button", { name: "Apply hole edits" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("status", { name: "Hole preview status" }),
  ).toContainText("changed");
  await dialog.getByRole("button", { name: "Cancel hole" }).click();
  await ready(page, volume, "cut");
  expect((await snapshot(page)).document.features).toEqual(
    before.document.features,
  );
});
