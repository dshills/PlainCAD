import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { CURRENT_SCHEMA_VERSION, type CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

type State = { document: CadDocument; status: string; result?: RebuildResult };
async function state(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    return {
      document: s.history.present,
      status: s.rebuild.status,
      result: s.rebuild.result,
    };
  });
}
async function ready(page: Page, ids: string[], volumes: number[]) {
  await expect(async () => {
    const s = await state(page);
    expect(s.status).toBe("succeeded");
    expect(s.result?.documentId).toBe(s.document.id);
    expect(s.result?.meshes).toHaveLength(ids.length);
    expect(s.result?.metrics?.disposalFailures).toBe(0);
    for (const [i, id] of ids.entries()) {
      const mesh = s.result!.meshes.find((m) => m.bodyId === id)!;
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volumes[i], 4);
    }
  }).toPass({ timeout: 20000 });
}
function stlVolume(bytes: Buffer) {
  const n = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * n);
  let volume = 0;
  for (let t = 0; t < n; t++) {
    const p = Array.from({ length: 9 }, (_, i) =>
      bytes.readFloatLE(96 + t * 50 + i * 4),
    );
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}
async function fixture(page: Page, plane: "XY" | "XZ" | "YZ") {
  return page.evaluate(async (plane) => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      sketches = await import(kp),
      { detectProfiles } = await import(pp),
      { solveSketch } = await import(rp);
    let doc = ops.upsertParameter(ops.createEmptyDocument("Scoped holes"), {
      id: "drill",
      name: "drill",
      expression: "4mm",
      unit: "mm",
      value: 0,
    });
    const ids: string[] = [];
    for (const [i, name] of ["Near", "Raised", "Far"].entries()) {
      let sketch = sketches.addCornerRectangle(
        sketches.createSketchOnPlane(`${name} section`, {
          type: "offset",
          base: plane,
          offset: { expression: `${i === 1 ? 20 : 0}mm`, unit: "mm" },
        }),
        "20mm",
        "10mm",
      );
      const x = [0, 30, 100][i];
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
      const feature = ops.createExtrudeFeature({
        name,
        sketchId: sketch.id,
        profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
        operation: "newBody",
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      });
      doc = ops.upsertFeature(ops.upsertSketch(doc, sketch), feature);
      ids.push(`body:${feature.id}`);
    }
    let centerSketch = sketches.createSketchOnPlane("Pattern centers", {
      type: "origin",
      plane,
    });
    const centers: string[] = [];
    for (const x of [5, 35, 70]) {
      const added = sketches.addPoint(centerSketch, `${x}mm`, "5mm");
      centerSketch = added.sketch;
      centers.push(added.pointId);
    }
    doc = ops.upsertSketch(doc, centerSketch);
    const store = (await import(sp)).useCadStore.getState();
    store.setDocument(doc);
    store.select({ kind: "sketch", id: centerSketch.id, documentId: doc.id });
    return { ids, centers };
  }, plane);
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: explicit multi-body hole patterns validate all centers/targets, roll back failures and persist native geometry`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect.poll(async () => (await state(page)).status).toBe("succeeded");
    const { ids, centers } = await fixture(page, plane);
    await ready(page, ids, [2000, 2000, 2000]);
    await page
      .getByRole("button", { name: "Hole from selected sketch", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create hole",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Apply hole" }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Include hole target Near Body", { exact: true })
      .check();
    await dialog
      .getByLabel("Include hole target Raised Body", { exact: true })
      .check();
    for (const x of [5, 35])
      await dialog
        .getByLabel(`Hole center at ${x.toFixed(3)}, 5.000 mm`, { exact: true })
        .check();
    await dialog.getByLabel("Hole diameter", { exact: true }).fill("drill");
    await expect(dialog.getByRole("status", { name: "Hole preview status" })).toContainText("Native preview ready");
    await dialog.getByRole("button", { name: "Apply hole" }).click();
    await expect(dialog).not.toBeVisible();
    const volume = (diameter: number, depth = 10) =>
      2000 - Math.PI * (diameter / 2) ** 2 * depth;
    await ready(page, ids, [volume(4), volume(4), 2000]);
    let s = await state(page);
    const hole = s.document.features.find((f) => f.type === "hole")!;
    expect(hole).toMatchObject({
      targetBodyIds: ids.slice(0, 2),
      centerPointIds: centers.slice(0, 2),
    });
    // Plane orientation and the offset body's location survive independent drilling.
    const a = s.result!.meshes.find((m) => m.bodyId === ids[0])!,
      b = s.result!.meshes.find((m) => m.bodyId === ids[1])!;
    const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0,
      sign = plane === "XZ" ? -1 : 1;
    expect(
      Math.min(a.bounds.min[axis] * sign, a.bounds.max[axis] * sign),
    ).toBeCloseTo(0, 4);
    expect(
      Math.min(b.bounds.min[axis] * sign, b.bounds.max[axis] * sign),
    ).toBeCloseTo(20, 4);
    const scope = page.getByRole("group", {
      name: "Hole target scope",
      exact: true,
    });
    await scope.getByLabel("Include target Far Body", { exact: true }).check();
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    s = await state(page);
    expect(
      s.result!.errors.find((e) => e.sourceId === hole.id)?.message,
    ).toMatch(/Hole target 3.*removed no volume/);
    expect(
      s.result!.errors.find((e) => e.sourceId === hole.id)?.message,
    ).toContain(ids[2]);
    for (const mesh of s.result!.meshes)
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(2000, 4);
    expect(s.result!.metrics?.disposalFailures).toBe(0);
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    await scope
      .getByLabel("Include target Far Body", { exact: true })
      .uncheck();
    await ready(page, ids, [volume(4), volume(4), 2000]);
    const unusedCenter = page.getByLabel("Hole center at 70mm, 5mm", {
      exact: true,
    });
    await unusedCenter.check();
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    s = await state(page);
    expect(
      s.result!.errors.find((e) => e.sourceId === hole.id)?.message,
    ).toMatch(/Hole center 3.*removed no volume/);
    for (const mesh of s.result!.meshes)
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(2000, 4);
    await unusedCenter.uncheck();
    await ready(page, ids, [volume(4), volume(4), 2000]);
    await page
      .getByRole("combobox", { name: "Hole termination", exact: true })
      .selectOption("distance");
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    s = await state(page);
    expect(
      s.result!.errors.find((e) => e.sourceId === hole.id)?.message,
    ).toMatch(/Hole center 2.*removed no volume/);
    await page.getByLabel("Hole depth", { exact: true }).fill("25mm");
    await page.getByLabel("Hole depth", { exact: true }).press("Enter");
    await ready(page, ids, [volume(4), volume(4, 5), 2000]);
    await page
      .getByRole("combobox", { name: "Hole termination", exact: true })
      .selectOption("throughAll");
    await ready(page, ids, [volume(4), volume(4), 2000]);
    await page.getByLabel("Parameter drill expression").fill("6mm");
    await page.getByLabel("Parameter drill expression").press("Enter");
    await ready(page, ids, [volume(6), volume(6), 2000]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, ids, [volume(4), volume(4), 2000]);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, ids, [volume(6), volume(6), 2000]);
    let download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const projectPath = info.outputPath(`${plane}.pcaddoc`);
    await (await download).saveAs(projectPath);
    const saved = JSON.parse(
      await readFile(projectPath, "utf8"),
    ) as CadDocument;
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.features.find((f) => f.id === hole.id)).toMatchObject({
      targetBodyIds: ids.slice(0, 2),
      centerPointIds: centers.slice(0, 2),
    });
    await page
      .getByRole("button", {
        name: "Load parametric box template",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await state(page)).document.id)
      .not.toBe(saved.id);
    await page.locator('input[type="file"]').setInputFiles(projectPath);
    await ready(page, ids, [volume(6), volume(6), 2000]);
    await page.getByRole("button", { name: "Raised", exact: true }).click();
    download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export selected body", exact: true })
      .click();
    const stlPath = info.outputPath(`${plane}.stl`);
    await (await download).saveAs(stlPath);
    expect(stlVolume(await readFile(stlPath)) / volume(6)).toBeCloseTo(1, 2);
    expect(errors).toEqual([]);
  });
}
