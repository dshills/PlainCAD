import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";

async function nativeReady(page: Page, distance = 10) {
  await expect(async () => {
    const snapshot = await aiSnapshot(page);
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.result?.success).toBe(true);
    expect(snapshot.result?.documentId).toBe(snapshot.document.id);
    expect(snapshot.result?.errors).toEqual([]);
    expect(snapshot.result?.meshes).toHaveLength(2);
    for (const mesh of snapshot.result!.meshes) {
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(200 * distance, 6);
      expect(mesh.bounds.min[2]).toBeCloseTo(0, 6);
      expect(mesh.bounds.max[2]).toBeCloseTo(distance, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function assembly(page: Page) {
  await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      sketches = await import(kp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp);
    let doc = ops.createEmptyDocument("Guided export parts");
    doc = ops.upsertParameter(doc, {
      id: "depth",
      name: "depth",
      expression: "10mm",
      value: 10,
      unit: "mm",
    });
    for (const [i, x] of [0, 100].entries()) {
      let sketch = sketches.addCornerRectangle(
        sketches.createXySketch(),
        "20mm",
        "10mm",
      );
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? {
                  ...e,
                  x: { ...e.x, expression: `(${e.x.expression}) + ${x}mm` },
                }
              : e,
          ]),
        ),
      };
      doc = ops.upsertFeature(
        ops.upsertSketch(doc, sketch),
        ops.createExtrudeFeature({
          name: ["Near", "Far"][i],
          sketchId: sketch.id,
          profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
          operation: "newBody",
          direction: "positive",
          distance: { expression: "depth", unit: "mm" },
        }),
      );
    }
    (await import(sp)).useCadStore.getState().setDocument(doc);
  });
}
function unpack(bytes: Buffer) {
  const files: { name: string; data: Buffer }[] = [];
  let i = 0;
  while (bytes.readUInt32LE(i) === 0x04034b50) {
    expect(bytes.readUInt16LE(i + 8)).toBe(0);
    const length = bytes.readUInt32LE(i + 18),
      size = bytes.readUInt16LE(i + 26),
      extra = bytes.readUInt16LE(i + 28),
      start = i + 30 + size + extra;
    files.push({
      name: bytes.subarray(i + 30, i + 30 + size).toString(),
      data: bytes.subarray(start, start + length),
    });
    i = start + length;
  }
  expect(bytes.readUInt32LE(i)).toBe(0x02014b50);
  return files;
}
function xBounds(bytes: Buffer) {
  const count = bytes.readUInt32LE(80),
    x: number[] = [];
  for (let i = 0; i < count; i++)
    for (let j = 0; j < 3; j++) x.push(bytes.readFloatLE(96 + i * 50 + j * 12));
  return [Math.min(...x), Math.max(...x)];
}
test("guided editable save/open and explicit native body export retain dimensions and world positions", async ({
  page,
}, info) => {
  await page.goto("/");
  await assembly(page);
  await nativeReady(page);
  await page
    .getByRole("button", { name: "Save or export", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Save or export",
    exact: true,
  });
  await expect(
    dialog.getByRole("radio", { name: /Save editable project/ }),
  ).toBeChecked();
  await expect(dialog.getByLabel("Output files")).toHaveCount(0);
  let pending = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Save editable project", exact: true })
    .click();
  const project = info.outputPath("guided.pcaddoc");
  await (await pending).saveAs(project);
  await expect(dialog).toBeHidden();
  const saved = JSON.parse(await readFile(project, "utf8"));
  expect(saved.parameters.depth.expression).toBe("10mm");
  expect(await readFile(project, "utf8")).not.toMatch(
    /exportBodyIds|GuidedExportTask|geometryAssertions/,
  );
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateDocument((doc: any) => ({
      ...doc,
      parameters: {
        ...doc.parameters,
        depth: { ...doc.parameters.depth, expression: "12mm" },
      },
    }));
  });
  await nativeReady(page, 12);
  await page.locator('input[type="file"]').setInputFiles(project);
  await nativeReady(page);
  await page.getByLabel("Show body Far", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Far", exact: true }).click();
  await page
    .getByRole("button", { name: "Save or export", exact: true })
    .click();
  await dialog.getByRole("radio", { name: /Export for printing/ }).check();
  await expect(
    dialog.getByLabel("Export body Far", { exact: true }),
  ).toBeChecked();
  await expect(dialog.getByLabel("STL output summary")).toContainText(
    "2 bodies selected",
  );
  await expect(dialog.getByLabel("Output files")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Use selected body", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Export body Near", { exact: true }),
  ).not.toBeChecked();
  pending = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Generate STL", exact: true })
    .click();
  const stlPath = info.outputPath("far.stl");
  await (await pending).saveAs(stlPath);
  const stl = await readFile(stlPath);
  expect(stlSignedVolume(stl)).toBeCloseTo(2000, 5);
  expect(xBounds(stl)).toEqual([100, 120]);
  await page
    .getByRole("button", { name: "Save or export", exact: true })
    .click();
  await dialog.getByRole("radio", { name: /Export for printing/ }).check();
  pending = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Generate STL", exact: true })
    .click();
  const zipPath = info.outputPath("both.zip");
  await (await pending).saveAs(zipPath);
  const files = unpack(await readFile(zipPath));
  expect(files.map((f) => f.name)).toEqual(["Near.stl", "Far.stl"]);
  for (const file of files)
    expect(stlSignedVolume(file.data)).toBeCloseTo(2000, 5);
  expect(files.map((f) => xBounds(f.data))).toEqual([
    [0, 20],
    [100, 120],
  ]);
  await nativeReady(page);
});
test("guided export never downloads a same-ID replacement or edited draft", async ({
  page,
}) => {
  await page.goto("/");
  await assembly(page);
  await nativeReady(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  const dialog = page.getByRole("dialog", {
    name: "Save or export",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Save or export", exact: true })
    .click();
  await dialog.getByRole("radio", { name: /Export for printing/ }).check();
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      store = (await import(path)).useCadStore.getState();
    store.setDocument(store.history.present);
  });
  await nativeReady(page);
  await expect(dialog.getByRole("alert")).toContainText("Project replaced");
  await expect(
    dialog.getByRole("button", { name: "Generate STL", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save or export", exact: true })
    .click();
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateDocument((doc: any) => ({
      ...doc,
      name: "Edited while choosing export",
    }));
  });
  await nativeReady(page);
  await expect(dialog.getByRole("alert")).toContainText("Project changed");
  await expect(
    dialog.getByRole("button", { name: "Save editable project", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("radio", { name: /Export for printing/ }).check();
  await expect(
    dialog.getByRole("button", { name: "Generate STL", exact: true }),
  ).toBeDisabled();
  expect(downloads).toEqual([]);
});

for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 640 }]) {
  test(`export actions remain visible above scrolling options at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await assembly(page);
    await nativeReady(page);
    await page.getByRole("button", { name: "Save or export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save or export", exact: true });
    await dialog.getByRole("radio", { name: /Export for printing/ }).check();
    const generate = dialog.getByRole("button", { name: "Generate STL", exact: true });
    const cancel = dialog.getByRole("button", { name: "Cancel export", exact: true });
    const bounds = await generate.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThan(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    const cancelBounds = await cancel.boundingBox();
    expect(cancelBounds).not.toBeNull();
    expect(cancelBounds!.y + cancelBounds!.height).toBeLessThanOrEqual(viewport.height);
    const mode = dialog.getByLabel("Output files");
    await expect(mode).toBeVisible();
    await dialog.getByText("Advanced STL options", { exact: true }).click();
    await expect(mode).toBeVisible();
    await expect(mode).toHaveValue("separate");
    await expect(dialog.getByRole("option", { name: /One file per part/ })).toHaveCount(1);
    await expect(dialog.getByRole("checkbox", { name: "Check each part for self-intersections" })).toBeChecked();
    await mode.selectOption("shells");
    await expect(dialog.getByRole("checkbox", { name: "Check self-intersections and overlaps between parts" })).toBeChecked();
    await mode.selectOption("separate");
    const footerBounds = await generate.boundingBox();
    // Scrolling either direction must leave the footer in the same position.
    for (const scrollTop of [0, 10000]) {
      await dialog.locator(".fabrication-dialog-content").evaluate((node, top) => { node.scrollTop = top; }, scrollTop);
      const current = await generate.boundingBox();
      expect(current!.y).toBeCloseTo(footerBounds!.y, 1);
      await expect(generate).toBeInViewport({ ratio: 1 });
      await expect(cancel).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: info.outputPath("export-footer.png") });
    const pending = page.waitForEvent("download");
    await generate.click();
    const zipPath = info.outputPath("parts.zip");
    await (await pending).saveAs(zipPath);
    const parts = unpack(await readFile(zipPath));
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(stlSignedVolume(part.data)).toBeCloseTo(2000, 5);
    await nativeReady(page);
  });
}
