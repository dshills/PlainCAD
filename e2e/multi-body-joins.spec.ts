import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
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
async function fixture(page: Page, mode: "extrude" | "revolve") {
  return page.evaluate(async (mode) => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      sketches = await import(kp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp);
    let doc = ops.upsertParameter(ops.createEmptyDocument("Multi body joins"), {
      id: "size",
      name: "size",
      expression: mode === "extrude" ? "40mm" : "25mm",
      value: 0,
      unit: "mm",
    });
    const ids: string[] = [];
    for (const [i, name] of ["First", "Middle", "Last", "Far"].entries()) {
      const x = mode === "extrude" ? [0, 20, 40, 100][i] : [0, 10, -20, 100][i];
      let sketch = sketches.addCornerRectangle(
        sketches.createXySketch(`${name} section`),
        "10mm",
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
    let sketch = sketches.addCornerRectangle(
      sketches.createXySketch("Bridge section"),
      "size",
      "10mm",
    );
    if (mode === "extrude")
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? { ...e, x: { ...e.x, expression: `(${e.x.expression}) + 5mm` } }
              : e,
          ]),
        ),
      };
    const common = {
      name: "Scoped join",
      sketchId: sketch.id,
      profileId: detectProfiles(
        solveSketch(sketch, {
          size: {
            value: mode === "extrude" ? 40 : 25,
            dimension: "length",
            unit: "mm",
          },
        }),
      ).profiles[0].id,
      operation: "join" as const,
      targetBodyIds: [ids[0], ids[2]],
    };
    const join =
      mode === "extrude"
        ? ops.createExtrudeFeature({
            ...common,
            direction: "positive",
            distance: { expression: "10mm", unit: "mm" },
          })
        : {
            ...common,
            id: "scoped-revolve",
            type: "revolve" as const,
            axis: { type: "origin" as const, axis: "Y" as const },
            angle: { expression: "360deg", unit: "deg" },
          };
    doc = ops.upsertFeature(ops.upsertSketch(doc, sketch), join);
    const store = (await import(sp)).useCadStore.getState();
    store.setDocument(doc);
    store.select({ kind: "feature", id: join.id, documentId: doc.id });
    return { ids, joinId: join.id };
  }, mode);
}
for (const mode of ["extrude", "revolve"] as const) {
  test(`${mode}: connected multi-body joins preserve identity, reject failed scopes, and survive save/open/STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect.poll(async () => (await state(page)).status).toBe("succeeded");
    const { ids, joinId } = await fixture(page, mode);
    const volume = (size: number) =>
      mode === "extrude"
        ? Math.max(50, 5 + size) * 100
        : Math.PI * size * size * 10;
    await ready(
      page,
      [ids[0], ids[1], ids[3]],
      [volume(mode === "extrude" ? 40 : 25), 1000, 1000],
    );
    const scope = page.getByRole("group", {
      name: "Join target scope",
      exact: true,
    });
    // Target order starts with two separated bodies, then a middle body.
    await scope
      .getByLabel("Include target Middle Body", { exact: true })
      .check();
    await ready(
      page,
      [ids[0], ids[3]],
      [volume(mode === "extrude" ? 40 : 25), 1000],
    );
    expect(
      (await state(page)).document.features.find((f) => f.id === joinId),
    ).toMatchObject({ targetBodyIds: [ids[0], ids[2], ids[1]] });
    await scope.getByLabel("Include target Far Body", { exact: true }).check();
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    let s = await state(page);
    expect(s.result!.meshes).toHaveLength(4);
    for (const mesh of s.result!.meshes)
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(1000, 4);
    expect(
      s.result!.errors.find((e) => e.sourceId === joinId)?.message,
    ).toContain("connected solids");
    expect(s.result!.metrics?.disposalFailures).toBe(0);
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    await scope
      .getByLabel("Include target Far Body", { exact: true })
      .uncheck();
    await ready(
      page,
      [ids[0], ids[3]],
      [volume(mode === "extrude" ? 40 : 25), 1000],
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(
      page,
      [ids[0], ids[3]],
      [volume(mode === "extrude" ? 40 : 25), 1000],
    );
    const next = mode === "extrude" ? 50 : 30;
    await page.getByLabel("Parameter size expression").fill(`${next}mm`);
    await page.getByLabel("Parameter size expression").press("Enter");
    await ready(page, [ids[0], ids[3]], [volume(next), 1000]);
    let download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const projectPath = info.outputPath(`${mode}.pcaddoc`);
    await (await download).saveAs(projectPath);
    const saved = JSON.parse(
      await readFile(projectPath, "utf8"),
    ) as CadDocument;
    expect(saved.features.find((f) => f.id === joinId)).toMatchObject({
      targetBodyIds: [ids[0], ids[2], ids[1]],
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
    await ready(page, [ids[0], ids[3]], [volume(next), 1000]);
    await page.getByRole("button", { name: "First", exact: true }).click();
    download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export selected body", exact: true })
      .click();
    const stlPath = info.outputPath(`${mode}.stl`);
    await (await download).saveAs(stlPath);
    expect(stlVolume(await readFile(stlPath)) / volume(next)).toBeCloseTo(1, 2);
    expect(errors).toEqual([]);
  });
}

test("native multi-target join rejects a contained tool and retains the original bodies", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).status).toBe("succeeded");
  const { ids, joinId } = await fixture(page, "extrude");
  await page.evaluate(
    async ({ ids, joinId }) => {
      const sp = "/src/state/useCadStore.ts";
      (await import(sp)).useCadStore
        .getState()
        .updateDocument((d: CadDocument) => {
          const first = d.features.find((f) => `body:${f.id}` === ids[0])!;
          if (first.type !== "extrude") throw new Error("Expected extrusion");
          return {
            ...d,
            parameters: {
              ...d.parameters,
              size: { ...d.parameters.size, expression: "5mm" },
            },
            features: d.features.map((f) =>
              f.id === joinId
                ? { ...f, targetBodyIds: ids.slice(0, 3) }
                : ids.slice(1, 3).includes(`body:${f.id}`)
                  ? {
                      ...f,
                      sketchId: first.sketchId,
                      profileId: first.profileId,
                    }
                  : f,
            ),
          };
        });
    },
    { ids, joinId },
  );
  await expect.poll(async () => (await state(page)).status).toBe("failed");
  const s = await state(page);
  expect(
    s.result!.errors.find((e) => e.sourceId === joinId)?.message,
  ).toContain("added no volume");
  expect(s.result!.meshes).toHaveLength(4);
  for (const mesh of s.result!.meshes) {
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(1000, 4);
  }
  expect(s.result!.metrics?.disposalFailures).toBe(0);
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
});
