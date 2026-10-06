import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument, OriginPlane } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; status: string; result: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
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
async function commit(page: Page, label: string, value: string) {
  const input = page.getByRole("textbox", { name: label, exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function loadFixture(
  page: Page,
  plane: OriginPlane = "XY",
  holes = false,
) {
  const fixture = await page.evaluate(
    async ({ plane, holes }) => {
      const docPath = "/src/cad/document/CadDocument.ts",
        sketchPath = "/src/cad/sketch/SketchModel.ts",
        solvePath = "/src/cad/sketch/SketchSolver.ts",
        profilePath = "/src/cad/sketch/profileDetection.ts";
      const ops = await import(docPath),
        sketches = await import(sketchPath),
        { solveSketch } = await import(solvePath),
        { detectProfiles } = await import(profilePath);
      let document = ops.createEmptyDocument("Directional part");
      document = ops.upsertParameter(document, {
        id: "span-param",
        name: "span",
        expression: "10mm",
        value: 10,
        unit: "mm",
      });
      document = ops.upsertParameter(document, {
        id: "drill-param",
        name: "drill",
        expression: "4mm",
        value: 4,
        unit: "mm",
      });
      const sketch = sketches.addCornerRectangle(
        sketches.createSketchOnPlane("Base section", plane),
        "20mm",
        "10mm",
      );
      document = ops.upsertSketch(document, sketch);
      const feature = ops.createExtrudeFeature({
        name: "Base solid",
        sketchId: sketch.id,
        profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
        operation: "newBody",
        distance: { expression: "span", unit: "mm" },
        direction: "positive",
      });
      document = ops.upsertFeature(document, feature);
      const center = sketches.addPoint(
        sketches.createSketchOnPlane("Hole centers", plane),
        "5mm",
        "5mm",
      );
      if (holes) document = ops.upsertSketch(document, center.sketch);
      return {
        document,
        featureId: feature.id,
        sketchId: center.sketch.id,
        pointId: center.pointId,
      };
    },
    { plane, holes },
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "direction.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture.document)),
  });
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(fixture.document.id);
  await ready(page, 2000);
  return fixture;
}
async function saveOpen(page: Page, file: string, id: string, volume: number) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await (await download).saveAs(file);
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect.poll(async () => (await snapshot(page)).document.id).toBe(id);
  await ready(page, volume);
}
for (const plane of ["XY", "XZ", "YZ"] as const)
  test(`${plane}: native negative/symmetric coordinate extents, parameter edits, save/open and STL winding`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    const fixture = await loadFixture(page, plane);
    await page
      .getByRole("list", { name: "Sketch and feature history" })
      .getByRole("button", { name: /Base solid/ })
      .click();
    const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0;
    await page
      .getByRole("combobox", { name: "Direction", exact: true })
      .selectOption("negative");
    await ready(page, 2000);
    let mesh = (await snapshot(page)).result.meshes[0];
    expect(mesh.bounds.min[axis]).toBeCloseTo(plane === "XZ" ? 0 : -10);
    expect(mesh.bounds.max[axis]).toBeCloseTo(plane === "XZ" ? 10 : 0);
    await page
      .getByRole("combobox", { name: "Direction", exact: true })
      .selectOption("symmetric");
    await ready(page, 2000);
    mesh = (await snapshot(page)).result.meshes[0];
    expect(mesh.bounds.min[axis]).toBeCloseTo(-5);
    expect(mesh.bounds.max[axis]).toBeCloseTo(5);
    await commit(page, "Parameter span expression", "14mm");
    await ready(page, 2800);
    mesh = (await snapshot(page)).result.meshes[0];
    expect(mesh.bounds.min[axis]).toBeCloseTo(-7);
    expect(mesh.bounds.max[axis]).toBeCloseTo(7);
    await saveOpen(
      page,
      info.outputPath("direction.pcaddoc"),
      fixture.document.id,
      2800,
    );
    expect((await snapshot(page)).document.features[0]).toMatchObject({
      id: fixture.featureId,
      direction: "symmetric",
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const file = info.outputPath("direction.stl");
    await (await download).saveAs(file);
    const bytes = await readFile(file);
    let signed = 0,
      min = Infinity,
      max = -Infinity;
    for (let i = 0; i < bytes.readUInt32LE(80); i++) {
      const offset = 84 + i * 50;
      const vertices = [12, 24, 36].map((start) =>
        [0, 1, 2].map((a) => bytes.readFloatLE(offset + start + a * 4)),
      );
      for (const v of vertices) {
        min = Math.min(min, v[axis]);
        max = Math.max(max, v[axis]);
      }
      const [a, b, c] = vertices;
      signed +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) -
          a[1] * (b[0] * c[2] - b[2] * c[0]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
    expect(min).toBeCloseTo(-7);
    expect(max).toBeCloseTo(7);
    expect(signed).toBeCloseTo(2800, 3);
    expect(errors).toEqual([]);
  });
test("negative and symmetric through-all tools cut the real target and reject a direction with no target extent", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const fixture = await loadFixture(page);
  const cutId = await page.evaluate(async (ownerId) => {
    const storePath = "/src/state/useCadStore.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      sketchPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts";
    const { useCadStore } = await import(storePath),
      ops = await import(docPath),
      sketches = await import(sketchPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath);
    const sketch = sketches.addCircleAt(
      sketches.createSketchOnPlane("Upper tool", {
        type: "offset",
        base: "XY",
        offset: { expression: "10mm", unit: "mm" },
      }),
      "5mm",
      "5mm",
      "2mm",
    );
    const feature = ops.createExtrudeFeature({
      name: "Directional cut",
      sketchId: sketch.id,
      profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
      operation: "cut",
      targetBodyIds: [`body:${ownerId}`],
      distance: { expression: "10mm", unit: "mm" },
      termination: { type: "throughAll" },
      direction: "negative",
    });
    useCadStore
      .getState()
      .updateDocument((d: CadDocument) =>
        ops.upsertFeature(ops.upsertSketch(d, sketch), feature),
      );
    return feature.id;
  }, fixture.featureId);
  const volume = 2000 - Math.PI * 4 * 10;
  await ready(page, volume);
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button", { name: /Directional cut/ })
    .click();
  await page
    .getByRole("combobox", { name: "Direction", exact: true })
    .selectOption("symmetric");
  await ready(page, volume);
  expect(
    (await snapshot(page)).document.features.find((f) => f.id === cutId),
  ).toMatchObject({ direction: "symmetric" });
  await page
    .getByRole("combobox", { name: "Direction", exact: true })
    .selectOption("positive");
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(
    page.getByRole("button", { name: /target body to extend in the positive/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, volume);
});

test("native hole dialog requires explicit centers/target; blind/through edits, parameter changes and empty-center recovery", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  const fixture = await loadFixture(page, "XY", true);
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button", { name: /Hole centers/ })
    .click();
  await page
    .getByRole("button", { name: "Hole from selected sketch", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create hole", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply hole" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Include hole target Base solid Body", { exact: true })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Apply hole" }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", {
      name: "Hole center at 5.000, 5.000 mm",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("textbox", { name: "Hole diameter", exact: true })
    .fill("-1mm");
  await expect(dialog.getByRole("status", { name: "Hole preview status" })).toContainText("Hole diameter must be a positive length");
  await expect(dialog.getByRole("button", { name: "Apply hole" })).toBeDisabled();
  expect((await snapshot(page)).document.features).toHaveLength(1);
  await dialog
    .getByRole("textbox", { name: "Hole diameter", exact: true })
    .fill("drill");
  await expect(dialog.getByRole("alert")).not.toBeVisible();
  await expect(dialog.getByRole("status", { name: "Hole preview status" })).toContainText("Native preview ready");
  const beforeApply = await snapshot(page);
  await dialog.getByRole("button", { name: "Cancel hole" }).click();
  expect((await snapshot(page)).document).toEqual(beforeApply.document);
  await page.getByRole("button", { name: "Hole from selected sketch", exact: true }).click();
  await dialog.getByLabel("Include hole target Base solid Body", { exact: true }).check();
  await dialog.getByLabel("Hole center at 5.000, 5.000 mm", { exact: true }).check();
  await dialog.getByLabel("Hole diameter", { exact: true }).fill("drill");
  await expect(dialog.getByRole("status", { name: "Hole preview status" })).toContainText("Native preview ready");
  await dialog.getByRole("button", { name: "Apply hole" }).click();
  await expect(dialog).not.toBeVisible();
  const full = 2000 - Math.PI * 4 * 10;
  await ready(page, full);
  const holeId = (await snapshot(page)).document.features.find(
    (f) => f.type === "hole",
  )!.id;
  await page
    .getByRole("combobox", { name: "Hole termination", exact: true })
    .selectOption("distance");
  await commit(page, "Hole depth", "3mm");
  await ready(page, 2000 - Math.PI * 4 * 3);
  await page
    .getByRole("combobox", { name: "Hole termination", exact: true })
    .selectOption("throughAll");
  await ready(page, full);
  await page
    .getByRole("checkbox", {
      name: "Hole center at 5mm, 5mm",
      exact: true,
    })
    .uncheck();
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: /Hole requires at least one explicit center/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, full);
  await commit(page, "Parameter drill expression", "5mm");
  const edited = 2000 - Math.PI * 6.25 * 10;
  await ready(page, edited);
  await saveOpen(
    page,
    info.outputPath("hole.pcaddoc"),
    fixture.document.id,
    edited,
  );
  expect(
    (await snapshot(page)).document.features.find((f) => f.id === holeId),
  ).toMatchObject({
    targetBodyIds: [`body:${fixture.featureId}`],
    centerPointIds: [fixture.pointId],
    diameter: { expression: "drill", parameterRefs: { drill: "drill-param" } },
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const file = info.outputPath("hole.stl");
  await (await download).saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
  expect(bytes.readUInt32LE(80)).toBeGreaterThan(12);
  expect(errors).toEqual([]);
});
